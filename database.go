package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const DatabasePath = "scratch.db"

type Database struct {
	*sql.DB
}

func ConnectToDatabase() (*Database, error) {
	dsn := fmt.Sprintf("%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", DatabasePath)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}

	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(16)
	db.SetConnMaxLifetime(time.Hour)

	table := NewSchemaTable("scratches")

	table.SetPrimary("id", "INTEGER", "AUTOINCREMENT")
	table.AddColumn("title", "TEXT", "")
	table.AddColumn("body", "TEXT", "")
	table.AddColumn("tags", "TEXT", "")
	table.AddColumn("version", "TEXT", "NOT NULL DEFAULT 'initial'")
	table.AddColumn("updated_at", "INTEGER", "")
	table.AddColumn("created_at", "INTEGER", "")

	err = table.Apply(db)
	if err != nil {
		return nil, err
	}

	return &Database{db}, nil
}

func (d *Database) Find(ctx context.Context, id int64) (*Scratch, error) {
	var (
		sc   Scratch
		tags string
	)

	err := d.QueryRowContext(ctx, "SELECT id, title, body, LENGTH(CAST(body AS BLOB)) as size, tags, version, updated_at, created_at FROM scratches WHERE id = ? LIMIT 1", id).Scan(&sc.ID, &sc.Title, &sc.Body, &sc.Size, &tags, &sc.Version, &sc.UpdatedAt, &sc.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}

		return nil, err
	}

	sc.SetTags(tags)

	return &sc, nil
}

func (d *Database) FindAll(ctx context.Context) ([]Scratch, error) {
	rows, err := d.QueryContext(ctx, "SELECT id, title, LENGTH(CAST(body AS BLOB)) as size, tags, version, updated_at, created_at FROM scratches ORDER BY created_at DESC")
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	scratches := make([]Scratch, 0)

	for rows.Next() {
		var (
			sc   Scratch
			tags string
		)

		err = rows.Scan(&sc.ID, &sc.Title, &sc.Size, &tags, &sc.Version, &sc.UpdatedAt, &sc.CreatedAt)
		if err != nil {
			return nil, err
		}

		sc.SetTags(tags)

		scratches = append(scratches, sc)
	}

	err = rows.Err()
	if err != nil {
		return nil, err
	}

	return scratches, nil
}

func (d *Database) Create(sc *Scratch) error {
	now := time.Now().Unix()

	sc.Version = hash()
	sc.UpdatedAt = now
	sc.CreatedAt = now

	return d.QueryRow("INSERT INTO scratches (title, body, tags, version, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id", sc.Title, sc.Body, strings.Join(sc.Tags, ","), sc.Version, sc.UpdatedAt, sc.CreatedAt).Scan(&sc.ID)
}

func (d *Database) Update(id int64, version string, req *ScratchUpdateRequest) (string, error) {
	var (
		fields []string
		args   []any
	)

	if req.Title != nil {
		fields = append(fields, "title = ?")
		args = append(args, *req.Title)
	}

	if req.Body != nil {
		fields = append(fields, "body = ?")
		args = append(args, *req.Body)
	}

	if req.Tags != nil {
		fields = append(fields, "tags = ?")
		args = append(args, strings.Join(*req.Tags, ","))
	}

	if len(fields) == 0 {
		return version, nil
	}

	newVersion := hash()

	fields = append(fields, "version = ?")
	args = append(args, newVersion)

	fields = append(fields, "updated_at = ?")
	args = append(args, time.Now().Unix())

	args = append(args, id, version)

	query := fmt.Sprintf("UPDATE scratches SET %s WHERE id = ? AND version = ?", strings.Join(fields, ", "))

	result, err := d.Exec(query, args...)
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

func (d *Database) Delete(id int64, version string) error {
	result, err := d.Exec("DELETE FROM scratches WHERE id = ? AND version = ?", id, version)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rowsAffected == 0 {
		return ErrVersionMismatch
	}

	return nil
}

func hash() string {
	b := make([]byte, 4)

	rand.Read(b)

	return hex.EncodeToString(b)
}
