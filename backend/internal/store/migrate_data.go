package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"njord/internal/names"
)

// dataMigrations[i] brings a base from user_version i to i+1. Each runs once,
// in a transaction, after the DDL and before schemaIndexes.
var dataMigrations = []func(tx *sql.Tx) error{
	identiteNomPrenom,
	dateEffetPlan,
}

func migrateData(db *sql.DB) error {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return err
	}
	for ; v < len(dataMigrations); v++ {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if err := dataMigrations[v](tx); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration de données %d: %w", v+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, v+1)); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// identiteNomPrenom (DECISIONS n° 8): a person is identified by NOM + Prénom
// only. Drops codes/matricules and aliases, recomputes nom_prenom on plan lines
// and réalisé entries, re-keys personnes on names.Key (records without a
// readable name are deleted, homonyms merged into the oldest) and relinks the
// plan lines by key. Parsing statuses only change on the next reimport.
func identiteNomPrenom(tx *sql.Tx) error {
	for _, q := range []string{
		`DROP TABLE IF EXISTS personne_alias`,
		`DROP TABLE IF EXISTS personne_matricules`,
		`DROP INDEX IF EXISTS personnes_nom`,
	} {
		if _, err := tx.Exec(q); err != nil {
			return err
		}
	}

	// nom_prenom des lignes de plan et des écritures réalisées.
	recompute := func(sel, upd string, parse func(s string) string) error {
		type row struct {
			id int64
			np string
		}
		rows, err := tx.Query(sel)
		if err != nil {
			return err
		}
		var todo []row
		for rows.Next() {
			var id int64
			var src, cur string
			if err := rows.Scan(&id, &src, &cur); err != nil {
				rows.Close()
				return err
			}
			if np := parse(src); np != cur {
				todo = append(todo, row{id, np})
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, r := range todo {
			if _, err := tx.Exec(upd, r.np, r.id); err != nil {
				return err
			}
		}
		return nil
	}
	if err := recompute(`SELECT id, libelle, nom_prenom FROM plan_lines`, `UPDATE plan_lines SET nom_prenom = ? WHERE id = ?`,
		func(libelle string) string {
			person, _ := names.SplitLibelle(libelle, nil)
			if np, st := names.ParseNomPrenom(person); st == names.NomPrenomOK {
				return np.String()
			}
			return ""
		}); err != nil {
		return err
	}
	if err := recompute(`SELECT id, employe_fournisseur, nom_prenom FROM realise_entries`, `UPDATE realise_entries SET nom_prenom = ? WHERE id = ?`,
		func(s string) string {
			if np, ok := names.ParseRealise(s); ok {
				return np.String()
			}
			return ""
		}); err != nil {
		return err
	}

	// Personnes : clé NOM + Prénom, homonymes fusionnés dans la plus ancienne.
	type personne struct {
		id, display, statut string
		squad               sql.NullString
	}
	rows, err := tx.Query(`SELECT id, display_name, statut, squad_id FROM personnes ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	var ps []personne
	for rows.Next() {
		var p personne
		if err := rows.Scan(&p.id, &p.display, &p.statut, &p.squad); err != nil {
			rows.Close()
			return err
		}
		ps = append(ps, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	byKey := map[string]string{}
	for _, p := range ps {
		np, st := names.ParseNomPrenom(p.display)
		key := names.Key(np)
		if st != names.NomPrenomOK || key == "" {
			if _, err := tx.Exec(`DELETE FROM personnes WHERE id = ?`, p.id); err != nil {
				return err
			}
			continue
		}
		into, dup := byKey[key]
		if !dup {
			byKey[key] = p.id
			if _, err := tx.Exec(`UPDATE personnes SET display_name = ?, nom_normalise = ? WHERE id = ?`, np.String(), key, p.id); err != nil {
				return err
			}
			continue
		}
		for _, q := range []struct {
			sql  string
			args []any
		}{
			{`UPDATE personnes SET statut = 'validee' WHERE id = ? AND ? = 'validee'`, []any{into, p.statut}},
			{`UPDATE personnes SET squad_id = ? WHERE id = ? AND squad_id IS NULL`, []any{p.squad, into}},
			{`DELETE FROM personnes WHERE id = ?`, []any{p.id}},
		} {
			if _, err := tx.Exec(q.sql, q.args...); err != nil {
				return err
			}
		}
	}

	// Rattachement des lignes de plan par clé (fiche brouillon créée au besoin).
	type line struct {
		id    int64
		np    string
		squad sql.NullString
	}
	rows, err = tx.Query(`SELECT id, nom_prenom, squad_id FROM plan_lines ORDER BY version_id, row_num`)
	if err != nil {
		return err
	}
	var ls []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.id, &l.np, &l.squad); err != nil {
			rows.Close()
			return err
		}
		ls = append(ls, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	now := FormatTime(time.Now().UTC())
	for _, l := range ls {
		var pid any
		if key := names.KeyOf(l.np); key != "" {
			id, ok := byKey[key]
			if !ok {
				id = uuid.NewString()
				if _, err := tx.Exec(`INSERT INTO personnes(id, display_name, nom_normalise, statut, squad_id, created_at) VALUES (?,?,?,'brouillon',?,?)`,
					id, l.np, key, l.squad, now); err != nil {
					return err
				}
				byKey[key] = id
			}
			pid = id
		}
		if _, err := tx.Exec(`UPDATE plan_lines SET personne_id = ? WHERE id = ?`, pid, l.id); err != nil {
			return err
		}
	}
	return nil
}

// dateEffetPlan (DECISIONS n° 13): a plan version replaces the previous ones
// from its date d'effet; existing versions get their first planned day.
func dateEffetPlan(tx *sql.Tx) error {
	_, err := tx.Exec(`UPDATE versions SET date_effet = periode_debut WHERE kind = 'plan' AND date_effet = ''`)
	return err
}
