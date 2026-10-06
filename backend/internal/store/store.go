// Package store owns the SQLite database: schema, generic version life cycle
// (import / archive / reactivate / purge), settings and audit log.
// Modules access their own tables through Store.DB() with plain SQL.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"njord/internal/domain"
)

// ErrNotFound is returned when a requested object does not exist.
var ErrNotFound = errors.New("introuvable")

// PreconditionError is a functional refusal (HTTP 409/422) with a readable message.
type PreconditionError struct{ Msg string }

func (e *PreconditionError) Error() string { return e.Msg }

// Precondition builds a PreconditionError.
func Precondition(format string, a ...any) error {
	return &PreconditionError{Msg: fmt.Sprintf(format, a...)}
}

type Store struct {
	db *sql.DB
	// Now is the clock used for every timestamp (overridable in tests).
	Now func() time.Time
}

// Open opens (and migrates) the database at path. Use ":memory:" for tests.
func Open(path string) (*Store, error) {
	dsn := "file::memory:?cache=shared"
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
		dsn = "file:" + path
	}
	dsn += sep(dsn) + "_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite: a single connection serialises writers and keeps ":memory:" alive.
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migration: %w", err)
	}
	return &Store{db: db, Now: func() time.Time { return time.Now().UTC() }}, nil
}

// addedColumns: colonnes ajoutées après la première version du schéma ; une base
// existante les reçoit par ALTER TABLE (CREATE TABLE IF NOT EXISTS ne les crée pas).
var addedColumns = []struct{ table, column, def string }{
	{"plan_lines", "nom_prenom", "TEXT NOT NULL DEFAULT ''"},
	{"realise_entries", "nom_prenom", "TEXT NOT NULL DEFAULT ''"},
}

// migrate applies the schema, adds the columns missing from an older base, runs
// the data migrations not yet applied (PRAGMA user_version) then the indexes.
func migrate(db *sql.DB) error {
	if _, err := db.Exec(schema); err != nil {
		return err
	}
	for _, c := range addedColumns {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, c.table, c.column).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, c.table, c.column, c.def)); err != nil {
				return err
			}
		}
	}
	if err := migrateData(db); err != nil {
		return err
	}
	_, err := db.Exec(schemaIndexes)
	return err
}

// OpenMemory opens a fresh private in-memory database (tests).
func OpenMemory() (*Store, error) {
	db, err := sql.Open("sqlite", "file::memory:?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, Now: func() time.Time { return time.Now().UTC() }}, nil
}

func sep(dsn string) string {
	for _, c := range dsn {
		if c == '?' {
			return "&"
		}
	}
	return "?"
}

func (s *Store) DB() *sql.DB  { return s.db }
func (s *Store) Close() error { return s.db.Close() }

// Tx runs fn in a transaction.
func (s *Store) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Execer is satisfied by *sql.DB and *sql.Tx.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// FormatTime / ParseTime: timestamps are stored as RFC3339 UTC strings.
func FormatTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func ParseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

func nullTime(ns sql.NullString) *time.Time {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	t := ParseTime(ns.String)
	return &t
}

// ---------------------------------------------------------------------------
// Audit

// Audit appends an entry to the journal. Never put sensitive data in details.
func (s *Store) Audit(ctx context.Context, ex Execer, operateur, action, objetType, objetID, details string) error {
	if ex == nil {
		ex = s.db
	}
	if operateur == "" {
		operateur = "local"
	}
	_, err := ex.ExecContext(ctx,
		`INSERT INTO audit_log(at, operateur, action, objet_type, objet_id, details) VALUES (?,?,?,?,?,?)`,
		FormatTime(s.Now()), operateur, action, objetType, objetID, details)
	return err
}

// ListAudit returns the most recent entries first. objetType "" = all.
func (s *Store) ListAudit(ctx context.Context, objetType string, limit int) ([]domain.AuditEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	q := `SELECT id, at, operateur, action, objet_type, objet_id, details FROM audit_log`
	args := []any{}
	if objetType != "" {
		q += ` WHERE objet_type = ?`
		args = append(args, objetType)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.AuditEntry{}
	for rows.Next() {
		var e domain.AuditEntry
		var at string
		if err := rows.Scan(&e.ID, &at, &e.Operateur, &e.Action, &e.ObjetType, &e.ObjetID, &e.Details); err != nil {
			return nil, err
		}
		e.At = ParseTime(at)
		out = append(out, e)
	}
	return out, rows.Err()
}
