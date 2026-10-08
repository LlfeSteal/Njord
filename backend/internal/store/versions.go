package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"njord/internal/domain"
)

const versionCols = `id, kind, intitule, importee_le, importeur, statut, archivee_le, purgee_le,
	nb_lignes, nb_warn, nb_drop, periode_debut, periode_fin, source_format, filename, layout, montant_total_eur, date_effet`

func scanVersion(sc interface{ Scan(...any) error }) (domain.Version, error) {
	var v domain.Version
	var importee string
	var archivee, purgee sql.NullString
	var montant sql.NullFloat64
	err := sc.Scan(&v.ID, &v.Kind, &v.Intitule, &importee, &v.Importeur, &v.Statut, &archivee, &purgee,
		&v.NbLignes, &v.NbWarn, &v.NbDrop, &v.PeriodeDebut, &v.PeriodeFin, &v.SourceFormat, &v.Filename,
		&v.Layout, &montant, &v.DateEffet)
	if err != nil {
		return v, err
	}
	v.ImporteeLe = ParseTime(importee)
	v.ArchiveeLe = nullTime(archivee)
	v.PurgeeLe = nullTime(purgee)
	if montant.Valid {
		m := montant.Float64
		v.MontantTotalEur = &m
	}
	return v, nil
}

func objetType(kind domain.Kind) string { return string(kind) + "_version" }

func linesTable(kind domain.Kind) string {
	switch kind {
	case domain.KindPlan:
		return "plan_lines"
	case domain.KindProvision:
		return "provision_lines"
	}
	return "realise_entries"
}

// GetVersion returns a version of the given kind (ErrNotFound otherwise).
func (s *Store) GetVersion(ctx context.Context, kind domain.Kind, id string) (domain.Version, error) {
	return s.getVersion(ctx, s.db, kind, id)
}

func (s *Store) getVersion(ctx context.Context, ex Execer, kind domain.Kind, id string) (domain.Version, error) {
	v, err := scanVersion(ex.QueryRowContext(ctx, `SELECT `+versionCols+` FROM versions WHERE id = ? AND kind = ?`, id, kind))
	if errors.Is(err, sql.ErrNoRows) {
		return v, ErrNotFound
	}
	return v, err
}

// ActiveVersion returns the active version of kind, or nil.
func (s *Store) ActiveVersion(ctx context.Context, kind domain.Kind) (*domain.Version, error) {
	return s.activeVersion(ctx, s.db, kind)
}

func (s *Store) activeVersion(ctx context.Context, ex Execer, kind domain.Kind) (*domain.Version, error) {
	v, err := scanVersion(ex.QueryRowContext(ctx, `SELECT `+versionCols+` FROM versions WHERE kind = ? AND statut = 'active'`, kind))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ListVersions: active first, then archived (most recent import first), then purged (if requested).
func (s *Store) ListVersions(ctx context.Context, kind domain.Kind, includePurged bool) ([]domain.Version, error) {
	q := `SELECT ` + versionCols + ` FROM versions WHERE kind = ?`
	if !includePurged {
		q += ` AND statut <> 'purgee'`
	}
	q += ` ORDER BY CASE statut WHEN 'active' THEN 0 WHEN 'archivee' THEN 1 ELSE 2 END, importee_le DESC`
	rows, err := s.db.QueryContext(ctx, q, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Version{}
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// CreateVersion inserts v (ID, ImporteeLe and Statut are set here) and calls
// fill(tx, versionID) to insert its lines, all in one transaction.
// If another version is active: archiveActive=true archives it and v becomes
// active; archiveActive=false makes v born "archivee".
func (s *Store) CreateVersion(ctx context.Context, v *domain.Version, archiveActive bool, fill func(tx *sql.Tx, versionID string) error) error {
	return s.Tx(ctx, func(tx *sql.Tx) error {
		now := s.Now()
		v.ID = uuid.NewString()
		v.ImporteeLe = now
		v.ArchiveeLe, v.PurgeeLe = nil, nil
		if v.Importeur == "" {
			v.Importeur = "local"
		}
		active, err := s.activeVersion(ctx, tx, v.Kind)
		if err != nil {
			return err
		}
		v.Statut = domain.StatutActive
		if active != nil {
			if archiveActive {
				if err := s.setArchived(ctx, tx, active.ID, now); err != nil {
					return err
				}
				if err := s.Audit(ctx, tx, v.Importeur, "archive", objetType(v.Kind), active.ID,
					fmt.Sprintf("archivage automatique à l'import de %s", v.ID)); err != nil {
					return err
				}
			} else {
				v.Statut = domain.StatutArchivee
				v.ArchiveeLe = &now
			}
		}
		var archivee any
		if v.ArchiveeLe != nil {
			archivee = FormatTime(*v.ArchiveeLe)
		}
		var montant any
		if v.MontantTotalEur != nil {
			montant = *v.MontantTotalEur
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO versions(`+versionCols+`) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)`,
			v.ID, v.Kind, v.Intitule, FormatTime(now), v.Importeur, v.Statut, archivee,
			v.NbLignes, v.NbWarn, v.NbDrop, v.PeriodeDebut, v.PeriodeFin, v.SourceFormat, v.Filename, v.Layout, montant, v.DateEffet)
		if err != nil {
			return err
		}
		if fill != nil {
			if err := fill(tx, v.ID); err != nil {
				return err
			}
		}
		return s.Audit(ctx, tx, v.Importeur, "import", objetType(v.Kind), v.ID,
			fmt.Sprintf("statut=%s lignes=%d warn=%d drop=%d", v.Statut, v.NbLignes, v.NbWarn, v.NbDrop))
	})
}

func (s *Store) setArchived(ctx context.Context, ex Execer, id string, now time.Time) error {
	_, err := ex.ExecContext(ctx, `UPDATE versions SET statut = 'archivee', archivee_le = ? WHERE id = ?`, FormatTime(now), id)
	return err
}

// Archive soft-deletes a version (active or already archived: idempotent).
func (s *Store) Archive(ctx context.Context, kind domain.Kind, id, operateur string) (domain.Version, error) {
	var out domain.Version
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		v, err := s.getVersion(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		switch v.Statut {
		case domain.StatutPurgee:
			return Precondition("la version « %s » est purgée", v.Intitule)
		case domain.StatutActive:
			if err := s.setArchived(ctx, tx, id, s.Now()); err != nil {
				return err
			}
			if err := s.Audit(ctx, tx, operateur, "archive", objetType(kind), id, ""); err != nil {
				return err
			}
		}
		out, err = s.getVersion(ctx, tx, kind, id)
		return err
	})
	return out, err
}

// Reactivate makes an archived version active again, archiving the current active one.
func (s *Store) Reactivate(ctx context.Context, kind domain.Kind, id, operateur string) (domain.Version, error) {
	var out domain.Version
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		v, err := s.getVersion(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		if v.Statut == domain.StatutActive {
			out = v
			return nil
		}
		if v.Statut != domain.StatutArchivee {
			return Precondition("seule une version archivée peut être réactivée")
		}
		active, err := s.activeVersion(ctx, tx, kind)
		if err != nil {
			return err
		}
		now := s.Now()
		if active != nil {
			if err := s.setArchived(ctx, tx, active.ID, now); err != nil {
				return err
			}
			if err := s.Audit(ctx, tx, operateur, "archive", objetType(kind), active.ID,
				fmt.Sprintf("archivage automatique à la réactivation de %s", id)); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE versions SET statut = 'active', archivee_le = NULL WHERE id = ?`, id); err != nil {
			return err
		}
		if err := s.Audit(ctx, tx, operateur, "reactivate", objetType(kind), id, ""); err != nil {
			return err
		}
		out, err = s.getVersion(ctx, tx, kind, id)
		return err
	})
	return out, err
}

// Purge hard-deletes the lines of an archived version (archived for at least
// Settings.PurgeDelaiJours days, confirmed by its exact title). The version row
// is kept as a tombstone with statut "purgee". Référentiels are never deleted.
func (s *Store) Purge(ctx context.Context, kind domain.Kind, id, confirmIntitule, operateur string) (domain.Version, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return domain.Version{}, err
	}
	var out domain.Version
	err = s.Tx(ctx, func(tx *sql.Tx) error {
		v, err := s.getVersion(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		if v.Statut != domain.StatutArchivee || v.ArchiveeLe == nil {
			return Precondition("seule une version archivée peut être purgée")
		}
		now := s.Now()
		limit := now.AddDate(0, 0, -settings.PurgeDelaiJours)
		if !v.ArchiveeLe.Before(limit) {
			return Precondition("la version doit être archivée depuis plus de %d jours (purge possible après le %s)",
				settings.PurgeDelaiJours, v.ArchiveeLe.AddDate(0, 0, settings.PurgeDelaiJours).Format("2006-01-02"))
		}
		if confirmIntitule != v.Intitule {
			return Precondition("confirmation invalide : saisissez exactement l'intitulé de la version")
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM `+linesTable(kind)+` WHERE version_id = ?`, id)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		if _, err := tx.ExecContext(ctx, `UPDATE versions SET statut = 'purgee', purgee_le = ? WHERE id = ?`, FormatTime(now), id); err != nil {
			return err
		}
		if err := s.Audit(ctx, tx, operateur, "purge", objetType(kind), id, fmt.Sprintf("%d lignes supprimées", n)); err != nil {
			return err
		}
		out, err = s.getVersion(ctx, tx, kind, id)
		return err
	})
	return out, err
}

// SetDateEffet changes the date d'effet of a plan version (DECISIONS n° 13):
// "YYYY-MM-DD", refused on a purged version.
func (s *Store) SetDateEffet(ctx context.Context, id, date, operateur string) (domain.Version, error) {
	var out domain.Version
	if _, err := time.Parse("2006-01-02", date); err != nil || len(date) != 10 {
		return out, Precondition("date d'effet invalide « %s » (format attendu AAAA-MM-JJ)", date)
	}
	err := s.Tx(ctx, func(tx *sql.Tx) error {
		v, err := s.getVersion(ctx, tx, domain.KindPlan, id)
		if err != nil {
			return err
		}
		if v.Statut == domain.StatutPurgee {
			return Precondition("la version « %s » est purgée", v.Intitule)
		}
		if v.DateEffet != date {
			if _, err := tx.ExecContext(ctx, `UPDATE versions SET date_effet = ? WHERE id = ?`, date, id); err != nil {
				return err
			}
			if err := s.Audit(ctx, tx, operateur, "date_effet", objetType(domain.KindPlan), id,
				fmt.Sprintf("%s → %s", v.DateEffet, date)); err != nil {
				return err
			}
		}
		out, err = s.getVersion(ctx, tx, domain.KindPlan, id)
		return err
	})
	return out, err
}
