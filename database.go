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

	table := NewSchemaTable("folders")

	table.SetPrimary("id", "INTEGER", "AUTOINCREMENT")

	table.AddColumn("name", "TEXT", "")
	table.AddColumn("sort_order", "REAL", "DEFAULT 0")
	table.AddColumn("is_expanded", "INTEGER", "DEFAULT 1")
	table.AddColumn("version", "TEXT", "NOT NULL DEFAULT 'initial'")
	table.AddColumn("updated_at", "INTEGER", "")
	table.AddColumn("created_at", "INTEGER", "")

	err = table.Apply(db)
	if err != nil {
		return nil, err
	}

	table = NewSchemaTable("scratches")

	table.SetPrimary("id", "INTEGER", "AUTOINCREMENT")

	table.AddColumn("folder_id", "INTEGER", "DEFAULT 0")
	table.AddColumn("sort_order", "REAL", "DEFAULT 0")
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

	// Migrate sort_order for existing records to ensure correct dragging behavior
	db.Exec("UPDATE folders SET sort_order = id * 1024 WHERE sort_order = 0")
	db.Exec("UPDATE scratches SET sort_order = id * 1024 WHERE sort_order = 0")

	return &Database{db}, nil
}

func (d *Database) Find(ctx context.Context, id int64) (*Scratch, error) {
	var (
		sc        Scratch
		tags      string
		sortOrder float64
	)

	err := d.QueryRowContext(ctx, "SELECT id, folder_id, sort_order, title, body, LENGTH(CAST(body AS BLOB)) as size, tags, version, updated_at, created_at FROM scratches WHERE id = ? LIMIT 1", id).Scan(&sc.ID, &sc.FolderID, &sortOrder, &sc.Title, &sc.Body, &sc.Size, &tags, &sc.Version, &sc.UpdatedAt, &sc.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}

		return nil, err
	}

	sc.SortOrder = int64(sortOrder)
	sc.SetTags(tags)

	return &sc, nil
}

func (d *Database) FindAll(ctx context.Context) ([]Scratch, error) {
	rows, err := d.QueryContext(ctx, "SELECT id, folder_id, sort_order, title, LENGTH(CAST(body AS BLOB)) as size, tags, version, updated_at, created_at FROM scratches ORDER BY sort_order ASC, created_at DESC")
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	scratches := make([]Scratch, 0)

	for rows.Next() {
		var (
			sc        Scratch
			tags      string
			sortOrder float64
		)

		err = rows.Scan(&sc.ID, &sc.FolderID, &sortOrder, &sc.Title, &sc.Size, &tags, &sc.Version, &sc.UpdatedAt, &sc.CreatedAt)
		if err != nil {
			return nil, err
		}

		sc.SortOrder = int64(sortOrder)
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

	if sc.SortOrder == 0 {
		sc.SortOrder = now
	}

	return d.QueryRow("INSERT INTO scratches (folder_id, sort_order, title, body, tags, version, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id", sc.FolderID, sc.SortOrder, sc.Title, sc.Body, strings.Join(sc.Tags, ","), sc.Version, sc.UpdatedAt, sc.CreatedAt).Scan(&sc.ID)
}

func (d *Database) Update(id int64, version string, req *ScratchUpdateRequest) (string, bool, error) {
	var (
		fields       []string
		args         []any
		needsCleanup bool
	)

	if req.FolderID != nil {
		fields = append(fields, "folder_id = ?")
		args = append(args, *req.FolderID)
	}

	if req.SortOrder != nil {
		fields = append(fields, "sort_order = ?")
		args = append(args, *req.SortOrder)

		if *req.SortOrder != float64(int64(*req.SortOrder)) {
			needsCleanup = true
		}
	}

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
		return version, false, nil
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
		return "", false, err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return "", false, err
	}

	if rowsAffected == 0 {
		return "", false, ErrVersionMismatch
	}

	if needsCleanup {
		err = d.CleanupSortOrders(context.Background())
		if err != nil {
			return "", false, err
		}
	}

	return newVersion, needsCleanup, nil
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

func (d *Database) CreateFolder(folder *Folder) error {
	now := time.Now().Unix()

	folder.Version = hash()
	folder.UpdatedAt = now
	folder.CreatedAt = now

	if folder.SortOrder == 0 {
		folder.SortOrder = now
	}

	folder.IsExpanded = true

	return d.QueryRow("INSERT INTO folders (name, sort_order, is_expanded, version, updated_at, created_at) VALUES (?, ?, 1, ?, ?, ?) RETURNING id", folder.Name, folder.SortOrder, folder.Version, folder.UpdatedAt, folder.CreatedAt).Scan(&folder.ID)
}

func (d *Database) FindAllFolders(ctx context.Context) ([]Folder, error) {
	rows, err := d.QueryContext(ctx, "SELECT id, sort_order, is_expanded, name, version, updated_at, created_at FROM folders ORDER BY sort_order ASC, name ASC")
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	folders := make([]Folder, 0)

	for rows.Next() {
		var (
			f          Folder
			isExpanded int
			sortOrder  float64
		)

		err = rows.Scan(&f.ID, &sortOrder, &isExpanded, &f.Name, &f.Version, &f.UpdatedAt, &f.CreatedAt)
		if err != nil {
			return nil, err
		}

		f.SortOrder = int64(sortOrder)
		f.IsExpanded = isExpanded == 1

		folders = append(folders, f)
	}

	return folders, rows.Err()
}

func (d *Database) UpdateFolder(id int64, version string, req *FolderUpdateRequest) (string, bool, error) {
	var (
		fields       []string
		args         []any
		needsCleanup bool
	)

	if req.Name != nil {
		fields = append(fields, "name = ?")
		args = append(args, *req.Name)
	}

	if req.SortOrder != nil {
		fields = append(fields, "sort_order = ?")
		args = append(args, *req.SortOrder)

		if *req.SortOrder != float64(int64(*req.SortOrder)) {
			needsCleanup = true
		}
	}

	if req.IsExpanded != nil {
		fields = append(fields, "is_expanded = ?")

		if *req.IsExpanded {
			args = append(args, 1)
		} else {
			args = append(args, 0)
		}
	}

	if len(fields) == 0 {
		return version, false, nil
	}

	newVersion := hash()
	now := time.Now().Unix()

	fields = append(fields, "version = ?")
	args = append(args, newVersion)
	fields = append(fields, "updated_at = ?")
	args = append(args, now)

	args = append(args, id, version)

	query := fmt.Sprintf("UPDATE folders SET %s WHERE id = ? AND version = ?", strings.Join(fields, ", "))

	result, err := d.Exec(query, args...)
	if err != nil {
		return "", false, err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return "", false, err
	}

	if rowsAffected == 0 {
		return "", false, ErrVersionMismatch
	}

	if needsCleanup {
		err = d.CleanupSortOrders(context.Background())
		if err != nil {
			return "", false, err
		}
	}

	return newVersion, needsCleanup, nil
}

func (d *Database) DeleteFolder(id int64, version string) error {
	result, err := d.Exec("DELETE FROM folders WHERE id = ? AND version = ?", id, version)
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

	_, err = d.Exec("UPDATE scratches SET folder_id = 0 WHERE folder_id = ?", id)
	return err
}

func (d *Database) CleanupSortOrders(ctx context.Context) error {
	rows, err := d.QueryContext(ctx, "SELECT id FROM folders ORDER BY sort_order ASC, created_at DESC")
	if err != nil {
		return err
	}

	var folderIDs []int64

	for rows.Next() {
		var id int64

		err = rows.Scan(&id)
		if err != nil {
			rows.Close()

			return err
		}

		folderIDs = append(folderIDs, id)
	}

	rows.Close()

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}

	defer tx.Rollback()

	for i, id := range folderIDs {
		_, err := tx.ExecContext(ctx, "UPDATE folders SET sort_order = ? WHERE id = ?", float64(i+1)*1024, id)
		if err != nil {
			return err
		}
	}

	rows, err = d.QueryContext(ctx, "SELECT id FROM scratches ORDER BY folder_id ASC, sort_order ASC, created_at DESC")
	if err != nil {
		return err
	}

	var scratchIDs []int64

	for rows.Next() {
		var id int64

		err = rows.Scan(&id)
		if err != nil {
			rows.Close()

			return err
		}

		scratchIDs = append(scratchIDs, id)
	}

	rows.Close()

	for i, id := range scratchIDs {
		_, err := tx.ExecContext(ctx, "UPDATE scratches SET sort_order = ? WHERE id = ?", float64(i+1)*1024, id)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func hash() string {
	b := make([]byte, 4)

	rand.Read(b)

	return hex.EncodeToString(b)
}
