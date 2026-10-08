package provision

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
)

// Service implements the provisions use cases on top of the store.
type Service struct{ st *store.Store }

func NewService(st *store.Store) *Service { return &Service{st: st} }

// DefaultIntitule: file name without directory nor extension.
func DefaultIntitule(filename string) string {
	base := filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if strings.TrimSpace(base) == "" || base == "." {
		return "Provisions"
	}
	return base
}

func cleanIntitule(intitule, filename string) string {
	if s := strings.TrimSpace(intitule); s != "" {
		return s
	}
	return DefaultIntitule(filename)
}

func buildReport(res *ParseResult, filename, intitule string) domain.ImportReport {
	m := res.MontantTotalEur
	return domain.ImportReport{
		Kind:            domain.KindProvision,
		Intitule:        intitule,
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
	}
}

// Preview parses the file and returns the report; nothing is written.
func (s *Service) Preview(ctx context.Context, data []byte, filename, intitule string) (*domain.ImportReport, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename, cleanIntitule(intitule, filename))
	if rep.ActiveVersion, err = s.st.ActiveVersion(ctx, domain.KindProvision); err != nil {
		return nil, err
	}
	return &rep, nil
}

const insertLine = `INSERT INTO provision_lines(version_id, row_num, ct, libelle, montant, unite, ligne_cout,
	type_depense, date_debut, date_fin, groupe, statut_parsing, motif_rejet) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`

// Import parses the file and stores it as a new version (with every line,
// dropped ones included). archiveActive=false makes the version born archived
// when another one is active. The store journals the import (audit_log).
func (s *Service) Import(ctx context.Context, data []byte, filename, intitule, importeur string, archiveActive bool) (*domain.ImportResult, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	intitule = cleanIntitule(intitule, filename)
	rep := buildReport(res, filename, intitule)
	if rep.ActiveVersion, err = s.st.ActiveVersion(ctx, domain.KindProvision); err != nil {
		return nil, err
	}
	m := res.MontantTotalEur
	v := domain.Version{
		Kind:            domain.KindProvision,
		Intitule:        intitule,
		Importeur:       importeur,
		NbLignes:        res.OK + res.Warn,
		NbWarn:          res.Warn,
		NbDrop:          res.Drop,
		PeriodeDebut:    res.PeriodeDebut,
		PeriodeFin:      res.PeriodeFin,
		SourceFormat:    res.SourceFormat,
		Filename:        filename,
		MontantTotalEur: &m,
	}
	err = s.st.CreateVersion(ctx, &v, archiveActive, func(tx *sql.Tx, versionID string) error {
		stmt, err := tx.PrepareContext(ctx, insertLine)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, l := range res.Lines {
			if _, err := stmt.ExecContext(ctx, versionID, l.RowNum, l.CT, l.Libelle, l.Montant, l.Unite, l.LigneCout,
				l.TypeDepense, l.DateDebut, l.DateFin, l.Groupe, l.StatutParsing, l.MotifRejet); err != nil {
				return fmt.Errorf("insertion ligne %d: %w", l.RowNum, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &domain.ImportResult{Version: v, Report: rep}, nil
}
