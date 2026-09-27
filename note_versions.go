package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

type NoteVersion struct {
	ID        int64    `json:"id"`
	Label     string   `json:"label"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
}

type NoteVersionRequest struct {
	Label   string `json:"label"`
	Version string `json:"version"`
}

type NoteRestoreRequest struct {
	Version string `json:"version"`
}

var ErrDuplicateVersion = errors.New("version label already exists")

func (d *Database) ListNoteVersions(ctx context.Context, noteID int64) ([]NoteVersion, error) {
	rows, err := d.QueryContext(ctx, "SELECT id, label, title, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC, id DESC", noteID)
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	versions := make([]NoteVersion, 0)

	for rows.Next() {
		var version NoteVersion

		err = rows.Scan(&version.ID, &version.Label, &version.Title, &version.CreatedAt)
		if err != nil {
			return nil, err
		}

		versions = append(versions, version)
	}

	return versions, rows.Err()
}

func (d *Database) FindNoteVersion(ctx context.Context, noteID, versionID int64) (*NoteVersion, error) {
	var (
		version NoteVersion
		tags    string
	)

	row := d.QueryRowContext(ctx, "SELECT id, label, title, body, tags, created_at FROM note_versions WHERE note_id = ? AND id = ?", noteID, versionID)

	err := row.Scan(&version.ID, &version.Label, &version.Title, &version.Body, &tags, &version.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	version.Tags = splitNoteTags(tags)

	return &version, nil
}

func (d *Database) TagNoteVersion(ctx context.Context, noteID int64, label, currentVersion string) (*NoteVersion, error) {
	version := &NoteVersion{Label: label, CreatedAt: time.Now().Unix()}

	row := d.QueryRowContext(ctx,
		"INSERT INTO note_versions (note_id, label, title, body, tags, created_at) SELECT id, ?, title, body, tags, ? FROM scratches WHERE id = ? AND version = ? ON CONFLICT(note_id, label) DO NOTHING RETURNING id, title",
		label, version.CreatedAt, noteID, currentVersion,
	)

	err := row.Scan(&version.ID, &version.Title)
	if errors.Is(err, sql.ErrNoRows) {
		var actualVersion string

		lookupErr := d.QueryRowContext(ctx, "SELECT version FROM scratches WHERE id = ?", noteID).Scan(&actualVersion)
		if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
			return nil, lookupErr
		}

		if actualVersion == currentVersion {
			return nil, ErrDuplicateVersion
		}

		return nil, ErrVersionMismatch
	}

	return version, err
}

func (d *Database) DeleteNoteVersion(ctx context.Context, noteID, versionID int64) error {
	result, err := d.ExecContext(ctx, "DELETE FROM note_versions WHERE note_id = ? AND id = ?", noteID, versionID)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func (d *Database) RestoreNoteVersion(ctx context.Context, noteID, versionID int64, currentVersion string) (string, error) {
	newVersion := hash()

	result, err := d.ExecContext(ctx,
		"UPDATE scratches SET title = note_versions.title, body = note_versions.body, tags = note_versions.tags, version = ?, updated_at = ? FROM note_versions WHERE scratches.id = ? AND scratches.version = ? AND note_versions.note_id = scratches.id AND note_versions.id = ?",
		newVersion, time.Now().Unix(), noteID, currentVersion, versionID,
	)

	if err != nil {
		return "", err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return "", err
	}

	if rowsAffected == 0 {
		return "", ErrVersionMismatch
	}

	return newVersion, nil
}

func HandleNoteVersions(w http.ResponseWriter, r *http.Request) {
	noteID, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	note, err := database.Find(r.Context(), noteID)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to get note")

		log.Warnf("failed to get note: %v\n", err)

		return
	}

	if note == nil {
		abort(w, http.StatusNotFound, "note not found")

		return
	}

	versions, err := database.ListNoteVersions(r.Context(), noteID)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to list versions")

		log.Warnf("failed to list versions: %v\n", err)

		return
	}

	okay(w, versions)
}

func HandleNoteVersion(w http.ResponseWriter, r *http.Request) {
	noteID, versionID, ok := parseNoteVersionIDs(r)
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	version, err := database.FindNoteVersion(r.Context(), noteID, versionID)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to get version")

		log.Warnf("failed to get version: %v\n", err)

		return
	}

	if version == nil {
		abort(w, http.StatusNotFound, "version not found")

		return
	}

	okay(w, version)
}

func HandleTagNoteVersion(w http.ResponseWriter, r *http.Request) {
	noteID, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var request NoteVersionRequest

	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		return
	}

	request.Label = strings.TrimSpace(request.Label)

	if request.Version == "" || request.Label == "" || len(request.Label) > 80 {
		abort(w, http.StatusBadRequest, "version and label (up to 80 characters) required")

		return
	}

	version, err := database.TagNoteVersion(r.Context(), noteID, request.Label, request.Version)
	if errors.Is(err, ErrDuplicateVersion) || errors.Is(err, ErrVersionMismatch) {
		abort(w, http.StatusConflict, err.Error())

		return
	}

	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to tag version")

		log.Warnf("failed to tag version: %v\n", err)

		return
	}

	okay(w, version)
}

func HandleDeleteNoteVersion(w http.ResponseWriter, r *http.Request) {
	noteID, versionID, ok := parseNoteVersionIDs(r)
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	err := database.DeleteNoteVersion(r.Context(), noteID, versionID)
	if errors.Is(err, sql.ErrNoRows) {
		abort(w, http.StatusNotFound, "version not found")

		return
	}

	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to delete version")

		log.Warnf("failed to delete version: %v\n", err)

		return
	}

	okay(w, nil)
}

func HandleRestoreNoteVersion(w http.ResponseWriter, r *http.Request) {
	noteID, versionID, ok := parseNoteVersionIDs(r)
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var request NoteRestoreRequest

	err := json.NewDecoder(r.Body).Decode(&request)
	if err != nil || request.Version == "" {
		abort(w, http.StatusBadRequest, "version required")

		return
	}

	version, err := database.FindNoteVersion(r.Context(), noteID, versionID)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to get version")

		log.Warnf("failed to get version: %v\n", err)

		return
	}

	if version == nil {
		abort(w, http.StatusNotFound, "version not found")

		return
	}

	newVersion, err := database.RestoreNoteVersion(r.Context(), noteID, versionID, request.Version)
	if errors.Is(err, ErrVersionMismatch) {
		abort(w, http.StatusConflict, "version mismatch")

		return
	}

	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to restore version")

		log.Warnf("failed to restore version: %v\n", err)

		return
	}

	okay(w, map[string]string{"version": newVersion})
}

func parseNoteVersionIDs(r *http.Request) (int64, int64, bool) {
	noteID, noteOK := parseID(r, "id")
	versionID, versionOK := parseID(r, "versionID")

	return noteID, versionID, noteOK && versionOK
}

func splitNoteTags(raw string) []string {
	tags := make([]string, 0)

	for tag := range strings.SplitSeq(raw, ",") {
		tag = strings.TrimSpace(tag)

		if tag != "" {
			tags = append(tags, tag)
		}
	}

	return tags
}
