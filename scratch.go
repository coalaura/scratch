package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type Scratch struct {
	ID        int64    `json:"id"`
	FolderID  int64    `json:"folder_id"`
	SortOrder float64  `json:"sort_order"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags"`
	Version   string   `json:"version"`
	UpdatedAt int64    `json:"updated_at"`
	CreatedAt int64    `json:"created_at"`

	Size int64 `json:"size"`
}

type ScratchUpdateRequest struct {
	Version string `json:"version"`

	FolderID  *int64    `json:"folder_id"`
	SortOrder *float64  `json:"sort_order"`
	Title     *string   `json:"title"`
	Body      *string   `json:"body"`
	Tags      *[]string `json:"tags"`
}

type ScratchDeleteRequest struct {
	Version string `json:"version"`
}

type Folder struct {
	ID        int64   `json:"id"`
	SortOrder float64 `json:"sort_order"`
	Name      string  `json:"name"`
	Version   string  `json:"version"`
	UpdatedAt int64   `json:"updated_at"`
	CreatedAt int64   `json:"created_at"`
}

type FolderUpdateRequest struct {
	Version   string   `json:"version"`
	Name      *string  `json:"name"`
	SortOrder *float64 `json:"sort_order"`
}

type FolderDeleteRequest struct {
	Version string `json:"version"`
}

var ErrVersionMismatch = errors.New("version mismatch")

func (sc *Scratch) SetTags(tags string) {
	sc.Tags = sc.Tags[:0]

	for tag := range strings.SplitSeq(tags, ",") {
		tag = strings.TrimSpace(tag)

		if tag != "" {
			sc.Tags = append(sc.Tags, tag)
		}
	}
}

func HandleList(w http.ResponseWriter, r *http.Request) {
	scratches, err := database.FindAll(r.Context())
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to list")

		log.Warnf("failed to find all: %v\n", err)

		return
	}

	okay(w, scratches)
}

func HandleGet(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	scratch, err := database.Find(r.Context(), id)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to get")

		log.Warnf("failed to get: %v\n", err)

		return
	}

	if scratch == nil {
		abort(w, http.StatusNotFound, "")

		return
	}

	okay(w, scratch)
}

func HandleCreate(w http.ResponseWriter, r *http.Request) {
	var scratch Scratch

	err := json.NewDecoder(r.Body).Decode(&scratch)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	err = database.Create(&scratch)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to create")

		log.Warnf("failed to create: %v\n", err)

		return
	}

	okay(w, map[string]any{
		"id":         scratch.ID,
		"version":    scratch.Version,
		"sort_order": scratch.SortOrder,
	})
}

func HandleUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var req ScratchUpdateRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	if req.Version == "" {
		abort(w, http.StatusBadRequest, "version required")

		return
	}

	newVersion, err := database.Update(id, req.Version, &req)
	if err != nil {
		if errors.Is(err, ErrVersionMismatch) {
			abort(w, http.StatusConflict, "version mismatch")

			return
		}

		abort(w, http.StatusInternalServerError, "failed to update")

		log.Warnf("failed to update: %v\n", err)

		return
	}

	okay(w, map[string]any{
		"version": newVersion,
	})
}

func HandleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var req ScratchDeleteRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	if req.Version == "" {
		abort(w, http.StatusBadRequest, "version required")

		return
	}

	err = database.Delete(id, req.Version)
	if err != nil {
		if errors.Is(err, ErrVersionMismatch) {
			abort(w, http.StatusConflict, "version mismatch")

			return
		}

		abort(w, http.StatusInternalServerError, "failed to delete")

		log.Warnf("failed to delete: %v\n", err)

		return
	}

	okay(w, nil)
}

func HandleFolderList(w http.ResponseWriter, r *http.Request) {
	folders, err := database.FindAllFolders(r.Context())
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to list folders")

		log.Warnf("failed to find all folders: %v\n", err)

		return
	}

	okay(w, folders)
}

func HandleFolderCreate(w http.ResponseWriter, r *http.Request) {
	var folder Folder

	err := json.NewDecoder(r.Body).Decode(&folder)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	err = database.CreateFolder(&folder)
	if err != nil {
		abort(w, http.StatusInternalServerError, "failed to create folder")

		log.Warnf("failed to create folder: %v\n", err)

		return
	}

	okay(w, map[string]any{
		"id":         folder.ID,
		"version":    folder.Version,
		"sort_order": folder.SortOrder,
	})
}

func HandleFolderUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var req FolderUpdateRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	if req.Version == "" {
		abort(w, http.StatusBadRequest, "version required")

		return
	}

	newVersion, err := database.UpdateFolder(id, req.Version, &req)
	if err != nil {
		if errors.Is(err, ErrVersionMismatch) {
			abort(w, http.StatusConflict, "version mismatch")

			return
		}

		abort(w, http.StatusInternalServerError, "failed to update folder")

		log.Warnf("failed to update folder: %v\n", err)

		return
	}

	okay(w, map[string]any{
		"version": newVersion,
	})
}

func HandleFolderDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r, "id")
	if !ok {
		abort(w, http.StatusBadRequest, "invalid id")

		return
	}

	var req FolderDeleteRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		abort(w, http.StatusBadRequest, "bad request")

		log.Warnf("bad request: %v\n", err)

		return
	}

	if req.Version == "" {
		abort(w, http.StatusBadRequest, "version required")

		return
	}

	err = database.DeleteFolder(id, req.Version)
	if err != nil {
		if errors.Is(err, ErrVersionMismatch) {
			abort(w, http.StatusConflict, "version mismatch")

			return
		}

		abort(w, http.StatusInternalServerError, "failed to delete folder")

		log.Warnf("failed to delete folder: %v\n", err)

		return
	}

	okay(w, nil)
}

func parseID(r *http.Request, name string) (int64, bool) {
	raw := chi.URLParam(r, name)
	if raw == "" {
		return 0, false
	}

	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}

	return id, true
}
