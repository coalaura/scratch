package main

import (
	"context"
	"database/sql"
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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS scratches (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT,
		body TEXT,
		tags TEXT,
		updated_at INTEGER,
		created_at INTEGER
	)`)
	if err != nil {
		return nil, err
	}

	return &Database{db}, nil
}

func (d *Database) Find(ctx context.Context, id string) (*Scratch, error) {
	var (
		sc   Scratch
		tags string
	)

	err := d.QueryRowContext(ctx, "SELECT id, title, body, tags, updated_at, created_at FROM scratches WHERE id = ? LIMIT 1", id).Scan(&sc.ID, &sc.Title, &sc.Body, &tags, &sc.UpdatedAt, &sc.CreatedAt)
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
	rows, err := d.QueryContext(ctx, "SELECT id, title, body, tags, updated_at, created_at FROM scratches ORDER BY created_at DESC")
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

		err := rows.Scan(&sc.ID, &sc.Title, &sc.Body, &tags, &sc.UpdatedAt, &sc.CreatedAt)
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

	sc.UpdatedAt = now
	sc.CreatedAt = now

	err := d.QueryRow("INSERT INTO scratches (title, body, tags, updated_at, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id", sc.Title, sc.Body, strings.Join(sc.Tags, ","), sc.UpdatedAt, sc.CreatedAt).Scan(&sc.ID)
	if err != nil {
		return err
	}

	return nil
}

func (d *Database) Delete(id string) error {
	_, err := d.Exec("DELETE FROM scratches WHERE id = ?", id)
	if err != nil {
		return err
	}

	return nil
}

func (d *Database) Update(id string, sc *Scratch) error {
	sc.UpdatedAt = time.Now().Unix()

	_, err := d.Exec("UPDATE scratches SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?", sc.Title, sc.Body, strings.Join(sc.Tags, ","), sc.UpdatedAt, sc.ID)
	if err != nil {
		return err
	}

	return nil
}
