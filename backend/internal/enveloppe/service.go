package enveloppe

import (
	"context"
	"database/sql"
	"fmt"

	"njord/internal/domain"
	"njord/internal/store"
)

// Service implements the envelope import use cases on top of the store.
type Service struct{ st *store.Store }

func NewService(st *store.Store) *Service { return &Service{st: st} }

func buildReport(res *ParseResult, filename string) domain.ImportReport {
	m := res.MontantTotalEur
	return domain.ImportReport{
		Kind:            domain.KindEnveloppe,
		Filename:        filename,
		SourceFormat:    res.SourceFormat,
		SheetName:       res.Sheet,
		HeaderRow:       res.HeaderRow,
		Total:           res.Total,
		OK:              res.OK,
		Warn:            res.Warn,
		Drop:            res.Drop,
		PeriodeDebut:    res.PeriodeDebut,
		PeriodeFin:      res.PeriodeFin,
		MontantTotalEur: &m,
		Issues:          res.Issues,
		MotifsCount:     res.MotifsCount,
		ActiveVersion:   nil, // pas de versions (DECISIONS n° 18)
	}
}

// Preview parses the file and returns the report; nothing is written. Un
// fichier sans enveloppe valide est montré (refusé seulement à l'import).
func (s *Service) Preview(ctx context.Context, data []byte, filename string) (*domain.ImportReport, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename)
	return &rep, nil
}

const insertEnveloppe = `INSERT INTO enveloppes(ct, categorie, categorie_libelle, date_debut, date_fin, montant) VALUES (?,?,?,?,?,?)`

// Import parses the file and replaces every envelope in one transaction,
// together with enveloppes_import and the audit entry. A file without any
// valid envelope is refused (*ParseError, 422).
func (s *Service) Import(ctx context.Context, data []byte, filename, operateur string) (*domain.ImportReport, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	n := len(res.Enveloppes)
	if n == 0 {
		return nil, &ParseError{CodeNoEnveloppe, fmt.Sprintf(
			"aucune enveloppe valide dans le fichier (%d ligne(s) rejetée(s)) ; les enveloppes actuelles sont conservées", res.Drop)}
	}
	if operateur == "" {
		operateur = "local"
	}
	err = s.st.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM enveloppes`); err != nil {
			return err
		}
		stmt, err := tx.PrepareContext(ctx, insertEnveloppe)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, l := range res.Enveloppes {
			if _, err := stmt.ExecContext(ctx, l.CT, l.Categorie, l.CategorieLibelle, l.DateDebut, l.DateFin, l.Montant); err != nil {
				return fmt.Errorf("insertion enveloppe ligne %d: %w", l.RowNum, err)
			}
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO enveloppes_import(id, filename, importe_le, operateur, nb_enveloppes) VALUES (1,?,?,?,?)
			ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, importe_le = excluded.importe_le,
				operateur = excluded.operateur, nb_enveloppes = excluded.nb_enveloppes`,
			filename, store.FormatTime(s.st.Now()), operateur, n); err != nil {
			return err
		}
		// Jamais les montants dans le journal.
		return s.st.Audit(ctx, tx, operateur, "import", "enveloppe", filename, fmt.Sprintf("%d enveloppes", n))
	})
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename)
	return &rep, nil
}
