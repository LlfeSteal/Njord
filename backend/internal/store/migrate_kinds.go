package store

import (
	"database/sql"
	"fmt"
	"strings"
)

// widenVersionKinds rebuilds the versions table of a base created before the
// 'provision' kind (DECISIONS n° 16): SQLite cannot alter a CHECK constraint.
// Foreign keys are switched off around the rebuild (outside the transaction,
// the pool holds a single connection) so that DROP TABLE does not cascade to
// plan_lines / realise_entries. Idempotent.
func widenVersionKinds(db *sql.DB) error {
	var ddl string
	if err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'versions'`).Scan(&ddl); err != nil {
		return err
	}
	if strings.Contains(ddl, "'provision'") {
		return nil
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	defer db.Exec(`PRAGMA foreign_keys = ON`)

	newDDL := strings.Replace(ddl, "CHECK (kind IN ('plan','realise'))", "CHECK (kind IN ('plan','realise','provision'))", 1)
	if newDDL == ddl {
		return fmt.Errorf("versions: contrainte kind introuvable dans %q", ddl)
	}
	newDDL = strings.Replace(newDDL, "versions", "versions_new", 1)

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	steps := []string{
		newDDL,
		`INSERT INTO versions_new SELECT * FROM versions`,
		`DROP TABLE versions`,
		`ALTER TABLE versions_new RENAME TO versions`,
		`CREATE UNIQUE INDEX IF NOT EXISTS versions_one_active ON versions(kind) WHERE statut = 'active'`,
	}
	for _, q := range steps {
		if _, err := tx.Exec(q); err != nil {
			return fmt.Errorf("versions (provision): %w", err)
		}
	}
	rows, err := tx.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	bad := rows.Next()
	rows.Close()
	if bad {
		return fmt.Errorf("versions (provision): clés étrangères incohérentes après reconstruction")
	}
	return tx.Commit()
}
