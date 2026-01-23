package main

import (
	"database/sql"
	"fmt"
	"strings"
)

type SchemaTable struct {
	name    string
	primary *SchemaColumn
	columns []*SchemaColumn
}

type SchemaColumn struct {
	name      string
	typ       string
	def       string
	isPrimary bool
}

func NewSchemaTable(name string) *SchemaTable {
	return &SchemaTable{
		name: name,
	}
}

func (t *SchemaTable) SetPrimary(name, typ, defaults string) {
	t.primary = &SchemaColumn{
		name:      name,
		typ:       typ,
		def:       defaults,
		isPrimary: true,
	}
}

func (t *SchemaTable) AddColumn(name, typ, defaults string) {
	t.columns = append(t.columns, &SchemaColumn{
		name: name,
		typ:  typ,
		def:  defaults,
	})
}

func (c *SchemaColumn) getDefinition() string {
	parts := []string{c.typ}

	if c.isPrimary {
		parts = append(parts, "PRIMARY KEY")
	}

	if c.def != "" {
		parts = append(parts, c.def)
	}

	return strings.Join(parts, " ")
}

func (t *SchemaTable) getCreateSQL() string {
	columns := make([]string, 0, len(t.columns)+1)

	columns = append(columns, fmt.Sprintf("`%s` %s", t.primary.name, t.primary.getDefinition()))

	for _, column := range t.columns {
		columns = append(columns, fmt.Sprintf("`%s` %s", column.name, column.getDefinition()))
	}

	return fmt.Sprintf("CREATE TABLE `%s` (%s);", t.name, strings.Join(columns, ", "))
}

func (t *SchemaTable) Apply(db *sql.DB) error {
	var tableName string

	err := db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t.name).Scan(&tableName)
	if err == sql.ErrNoRows {
		_, err = db.Exec(t.getCreateSQL())

		return err
	}

	if err != nil {
		return err
	}

	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(`%s`)", t.name))
	if err != nil {
		return err
	}

	defer rows.Close()

	exists := make(map[string]bool)

	for rows.Next() {
		var (
			cid     int
			name    string
			typ     string
			notNull int
			pk      int
			def     sql.NullString
		)

		err = rows.Scan(&cid, &name, &typ, &notNull, &def, &pk)
		if err != nil {
			return err
		}

		exists[name] = true
	}

	err = rows.Err()
	if err != nil {
		return err
	}

	if t.primary == nil {
		t.SetPrimary("id", "INTEGER", "AUTOINCREMENT")
	}

	columns := make([]*SchemaColumn, 0, len(t.columns)+1)

	columns = append(columns, t.primary)
	columns = append(columns, t.columns...)

	for _, column := range columns {
		if exists[column.name] {
			continue
		}

		alter := fmt.Sprintf("ALTER TABLE `%s` ADD COLUMN `%s` %s;", t.name, column.name, column.getDefinition())

		_, err = db.Exec(alter)
		if err != nil {
			return err
		}
	}

	return nil
}
