package enveloppe

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"time"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Service implements the envelope entry use cases (DECISIONS n° 27) on top of the store.
type Service struct{ st *store.Store }

func NewService(st *store.Store) *Service { return &Service{st: st} }

// row is one stored envelope.
type row struct {
	categorie, categorieLibelle string
	domain.Enveloppe
}

const (
	qRow    = `SELECT categorie, categorie_libelle, date_debut, date_fin, montant FROM enveloppes WHERE ct = ?`
	qCodes  = `SELECT categorie, categorie_libelle FROM enveloppes WHERE categorie <> '' ORDER BY categorie, ct`
	qUpsert = `INSERT INTO enveloppes(ct, categorie, categorie_libelle, date_debut, date_fin, montant) VALUES (?,?,?,?,?,?)
		ON CONFLICT(ct) DO UPDATE SET categorie = excluded.categorie, categorie_libelle = excluded.categorie_libelle,
			date_debut = excluded.date_debut, date_fin = excluded.date_fin, montant = excluded.montant`
)

// validate checks the CT and the input (400 on error) and returns the row to store,
// without its category code.
func validate(ct string, in domain.EnveloppeInput) (row, error) {
	if ct == "" {
		return row{}, httpx.BadRequest("CT vide")
	}
	debut, err := isoDate("date_debut", in.DateDebut)
	if err != nil {
		return row{}, err
	}
	fin, err := isoDate("date_fin", in.DateFin)
	if err != nil {
		return row{}, err
	}
	if fin < debut {
		return row{}, httpx.BadRequest("date_fin antérieure à date_debut")
	}
	if in.Montant == nil {
		return row{}, httpx.BadRequest("montant requis")
	}
	m := *in.Montant
	if math.IsNaN(m) || math.IsInf(m, 0) || m < 0 {
		return row{}, httpx.BadRequest("montant invalide (nombre ≥ 0 attendu)")
	}
	return row{categorieLibelle: strings.TrimSpace(in.Categorie),
		Enveloppe: domain.Enveloppe{DateDebut: debut, DateFin: fin, Montant: m}}, nil
}

// isoDate accepts only a valid YYYY-MM-DD date.
func isoDate(field, s string) (string, error) {
	s = strings.TrimSpace(s)
	if _, err := time.Parse(time.DateOnly, s); err != nil || len(s) != len(time.DateOnly) {
		return "", httpx.BadRequest("champ « " + field + " » : date AAAA-MM-JJ attendue")
	}
	return s, nil
}

// labelKey: clé de rapprochement des libellés de catégorie (casse et espaces ignorés).
func labelKey(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }

// categoryCode returns the code inherited from the old import of an envelope
// having the same category label, ” when none (or for an empty label).
func categoryCode(ctx context.Context, tx *sql.Tx, libelle string) (string, error) {
	key := labelKey(libelle)
	if key == "" {
		return "", nil
	}
	rows, err := tx.QueryContext(ctx, qCodes)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var code, lib string
		if err := rows.Scan(&code, &lib); err != nil {
			return "", err
		}
		if labelKey(lib) == key {
			return code, nil
		}
	}
	return "", rows.Err()
}

// Put creates or replaces the envelope of ct and returns its EnveloppeCT.
// Audit create / update with the changed field names only (never amounts);
// nothing is written when nothing changes.
func (s *Service) Put(ctx context.Context, ct string, in domain.EnveloppeInput, operateur string) (domain.EnveloppeCT, error) {
	var out domain.EnveloppeCT
	ct = strings.TrimSpace(ct)
	nw, err := validate(ct, in)
	if err != nil {
		return out, err
	}
	err = s.st.Tx(ctx, func(tx *sql.Tx) error {
		var old row
		err := tx.QueryRowContext(ctx, qRow, ct).Scan(&old.categorie, &old.categorieLibelle, &old.DateDebut, &old.DateFin, &old.Montant)
		exists := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if nw.categorie, err = categoryCode(ctx, tx, nw.categorieLibelle); err != nil {
			return err
		}
		changed := []string{}
		if !exists || old.DateDebut != nw.DateDebut {
			changed = append(changed, "date_debut")
		}
		if !exists || old.DateFin != nw.DateFin {
			changed = append(changed, "date_fin")
		}
		if !exists || old.Montant != nw.Montant {
			changed = append(changed, "montant")
		}
		if (!exists && nw.categorieLibelle != "") ||
			(exists && (old.categorieLibelle != nw.categorieLibelle || old.categorie != nw.categorie)) {
			changed = append(changed, "categorie")
		}
		if len(changed) > 0 {
			if _, err := tx.ExecContext(ctx, qUpsert, ct, nw.categorie, nw.categorieLibelle, nw.DateDebut, nw.DateFin, nw.Montant); err != nil {
				return err
			}
			action := "update"
			if !exists {
				action = "create"
			}
			// Jamais les montants dans le journal.
			if err := s.st.Audit(ctx, tx, operateur, action, "enveloppe", ct, "champs : "+strings.Join(changed, ", ")); err != nil {
				return err
			}
		}
		out, err = getCT(ctx, tx, ct)
		return err
	})
	return out, err
}

// Delete removes the envelope of ct (store.ErrNotFound when it has none).
func (s *Service) Delete(ctx context.Context, ct, operateur string) error {
	ct = strings.TrimSpace(ct)
	if ct == "" {
		return httpx.BadRequest("CT vide")
	}
	return s.st.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM enveloppes WHERE ct = ?`, ct)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n == 0 {
			return store.ErrNotFound
		}
		return s.st.Audit(ctx, tx, operateur, "delete", "enveloppe", ct, "")
	})
}
