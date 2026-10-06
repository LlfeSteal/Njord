package realise

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
	"njord/internal/xlsxutil"
)

// Service implements the réalisé use cases on top of the store.
type Service struct{ st *store.Store }

func NewService(st *store.Store) *Service { return &Service{st: st} }

// DefaultIntitule: file name without directory nor extension.
func DefaultIntitule(filename string) string {
	base := filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if strings.TrimSpace(base) == "" || base == "." {
		return "Réalisé"
	}
	return base
}

func buildReport(res *ParseResult, filename, intitule string) domain.ImportReport {
	m := res.MontantTotalEur
	return domain.ImportReport{
		Kind:            domain.KindRealise,
		Intitule:        intitule,
		Filename:        filename,
		SourceFormat:    res.SourceFormat,
		SheetName:       res.SheetName,
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

func cleanIntitule(intitule, filename string) string {
	if s := strings.TrimSpace(intitule); s != "" {
		return s
	}
	return DefaultIntitule(filename)
}

// Preview parses the file and returns the report; nothing is written.
func (s *Service) Preview(ctx context.Context, data []byte, filename, intitule string) (*domain.ImportReport, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename, cleanIntitule(intitule, filename))
	if rep.ActiveVersion, err = s.st.ActiveVersion(ctx, domain.KindRealise); err != nil {
		return nil, err
	}
	return &rep, nil
}

const insertEntry = `INSERT INTO realise_entries(version_id, row_num, entite, activite, sous_activite, trigramme,
	tg, tg_libelle, wp, wp_libelle, description_depenses, categorie, type, categorie_fnp, employe_fournisseur,
	nom_prenom, matricule, fpc, cea, quantite, total_eur, date_depense, periode_comptable, compte_comptable, num_facture,
	num_commande, num_ligne, lot_ifrs15, nom_ressource, fournisseur, code_article, mois_comptable,
	statut_parsing, motif_rejet) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

// Import parses the file and stores it as a new version (with every line,
// dropped ones included). archiveActive=false makes the version born archived
// when another one is active.
func (s *Service) Import(ctx context.Context, data []byte, filename, intitule, importeur string, archiveActive bool) (*domain.ImportResult, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	intitule = cleanIntitule(intitule, filename)
	rep := buildReport(res, filename, intitule)
	if rep.ActiveVersion, err = s.st.ActiveVersion(ctx, domain.KindRealise); err != nil {
		return nil, err
	}
	m := res.MontantTotalEur
	v := domain.Version{
		Kind:            domain.KindRealise,
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
		stmt, err := tx.PrepareContext(ctx, insertEntry)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, e := range res.Entries {
			var numLigne any
			if e.NumLigne != nil {
				numLigne = *e.NumLigne
			}
			if _, err := stmt.ExecContext(ctx, versionID, e.RowNum, e.Entite, e.Activite, e.SousActivite, e.Trigramme,
				e.TG, e.TGLibelle, e.WP, e.WPLibelle, e.DescriptionDepenses, e.Categorie, e.Type, e.CategorieFNP,
				e.EmployeFournisseur, e.NomPrenom, e.Matricule, e.FPC, e.CEA, e.Quantite, e.TotalEur, e.DateDepense,
				e.PeriodeComptable, e.CompteComptable, e.NumFacture, e.NumCommande, numLigne, e.LotIFRS15,
				e.NomRessource, e.Fournisseur, e.CodeArticle, e.MoisComptable, e.StatutParsing, e.MotifRejet); err != nil {
				return fmt.Errorf("insertion ligne %d: %w", e.RowNum, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &domain.ImportResult{Version: v, Report: rep}, nil
}

// ---------------------------------------------------------------------------
// Consultation

// Filter holds the entries query parameters (docs/API.md, Réalisé : écritures).
// Multi-valued exact filters match any of their values.
type Filter struct {
	Entite, Activite, Trigramme, TG, WP, Categorie, Type, Lot, Statut []string
	DateFrom, DateTo                                                  string // sur date_depense, inclus
	MontantMin, MontantMax                                            *float64
	Q                                                                 string
	SearchDescription                                                 bool
	MaskSensitive                                                     bool
	Sort                                                              string // date_depense | total_eur | tg | row_num
	Desc                                                              bool
}

// SortFields lists the accepted sort keys.
var SortFields = []string{"row_num", "date_depense", "total_eur", "tg"}

const entryCols = `id, version_id, row_num, entite, activite, sous_activite, trigramme, tg, tg_libelle, wp,
	wp_libelle, description_depenses, categorie, type, categorie_fnp, employe_fournisseur, nom_prenom, matricule, fpc, cea,
	quantite, total_eur, date_depense, periode_comptable, compte_comptable, num_facture, num_commande, num_ligne,
	lot_ifrs15, nom_ressource, fournisseur, code_article, mois_comptable, statut_parsing, motif_rejet`

func scanEntry(rows *sql.Rows) (domain.RealiseEntry, error) {
	var e domain.RealiseEntry
	var numLigne sql.NullInt64
	err := rows.Scan(&e.ID, &e.VersionID, &e.RowNum, &e.Entite, &e.Activite, &e.SousActivite, &e.Trigramme,
		&e.TG, &e.TGLibelle, &e.WP, &e.WPLibelle, &e.DescriptionDepenses, &e.Categorie, &e.Type, &e.CategorieFNP,
		&e.EmployeFournisseur, &e.NomPrenom, &e.Matricule, &e.FPC, &e.CEA, &e.Quantite, &e.TotalEur, &e.DateDepense,
		&e.PeriodeComptable, &e.CompteComptable, &e.NumFacture, &e.NumCommande, &numLigne, &e.LotIFRS15,
		&e.NomRessource, &e.Fournisseur, &e.CodeArticle, &e.MoisComptable, &e.StatutParsing, &e.MotifRejet)
	if numLigne.Valid {
		n := int(numLigne.Int64)
		e.NumLigne = &n
	}
	return e, err
}

// Mask blanks the sensitive fields of e.
func Mask(e *domain.RealiseEntry) {
	e.EmployeFournisseur = ""
	e.NomPrenom = ""
	e.Matricule = ""
	e.NumFacture = ""
	e.NumCommande = ""
	e.DescriptionDepenses = ""
	e.NomRessource = ""
	e.Fournisseur = ""
}

// fold lowers and strips accents for the full-text search.
func fold(s string) string { return strings.ToLower(xlsxutil.StripAccents(s)) }

// query returns the filtered, sorted (and masked if requested) entries of a
// version. Exact filters are applied in SQL, the accent-insensitive search
// and the sort in Go (a version holds a few thousand lines at most).
func (s *Service) query(ctx context.Context, versionID string, f Filter) ([]domain.RealiseEntry, error) {
	if _, err := s.st.GetVersion(ctx, domain.KindRealise, versionID); err != nil {
		return nil, err
	}
	where := []string{"version_id = ?"}
	args := []any{versionID}
	in := func(col string, vals []string) {
		if len(vals) == 0 {
			return
		}
		ph := strings.TrimSuffix(strings.Repeat("?,", len(vals)), ",")
		where = append(where, col+" IN ("+ph+")")
		for _, v := range vals {
			args = append(args, v)
		}
	}
	in("entite", f.Entite)
	in("activite", f.Activite)
	in("trigramme", f.Trigramme)
	in("tg", f.TG)
	in("wp", f.WP)
	in("categorie", f.Categorie)
	in("type", f.Type)
	in("lot_ifrs15", f.Lot)
	in("statut_parsing", f.Statut)
	if f.DateFrom != "" {
		where = append(where, "date_depense <> '' AND date_depense >= ?")
		args = append(args, f.DateFrom)
	}
	if f.DateTo != "" {
		where = append(where, "date_depense <> '' AND date_depense <= ?")
		args = append(args, f.DateTo)
	}
	if f.MontantMin != nil {
		where = append(where, "total_eur >= ?")
		args = append(args, *f.MontantMin)
	}
	if f.MontantMax != nil {
		where = append(where, "total_eur <= ?")
		args = append(args, *f.MontantMax)
	}
	rows, err := s.st.DB().QueryContext(ctx,
		`SELECT `+entryCols+` FROM realise_entries WHERE `+strings.Join(where, " AND ")+` ORDER BY row_num, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	q := fold(strings.TrimSpace(f.Q))
	out := []domain.RealiseEntry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		if q != "" && !strings.Contains(fold(e.TG), q) && !strings.Contains(fold(e.TGLibelle), q) &&
			!strings.Contains(fold(e.NomPrenom), q) &&
			!(f.SearchDescription && strings.Contains(fold(e.DescriptionDepenses), q)) {
			continue
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortEntries(out, f.Sort, f.Desc)
	if f.MaskSensitive {
		for i := range out {
			Mask(&out[i])
		}
	}
	return out, nil
}

func sortEntries(es []domain.RealiseEntry, field string, desc bool) {
	less := func(a, b *domain.RealiseEntry) int {
		switch field {
		case "date_depense":
			return strings.Compare(a.DateDepense, b.DateDepense)
		case "total_eur":
			switch {
			case a.TotalEur < b.TotalEur:
				return -1
			case a.TotalEur > b.TotalEur:
				return 1
			}
			return 0
		case "tg":
			return strings.Compare(a.TG, b.TG)
		}
		return 0
	}
	sort.SliceStable(es, func(i, j int) bool {
		c := less(&es[i], &es[j])
		if desc {
			c = -c
		}
		if c == 0 { // départage stable : ligne Excel croissante
			c = es[i].RowNum - es[j].RowNum
			if field == "row_num" && desc {
				c = -c
			}
		}
		return c < 0
	})
}

// Entries returns one page of the filtered entries with the totals computed
// on the whole filter.
func (s *Service) Entries(ctx context.Context, versionID string, f Filter, limit, offset int) (*domain.RealiseEntriesPage, error) {
	all, err := s.query(ctx, versionID, f)
	if err != nil {
		return nil, err
	}
	page := &domain.RealiseEntriesPage{
		Items:  []domain.RealiseEntry{},
		Total:  len(all),
		Totals: domain.RealiseEntryTotals{ParCategorie: map[string]int{}},
	}
	for _, e := range all {
		page.Totals.Quantite += e.Quantite
		page.Totals.TotalEur += e.TotalEur
		page.Totals.ParCategorie[e.Categorie]++
	}
	page.Totals.TotalEur = math.Round(page.Totals.TotalEur*100) / 100
	page.Totals.Quantite = math.Round(page.Totals.Quantite*1e6) / 1e6
	if offset < len(all) {
		end := offset + limit
		if end > len(all) {
			end = len(all)
		}
		page.Items = all[offset:end]
	}
	return page, nil
}

// AllEntries returns every filtered entry (CSV export).
func (s *Service) AllEntries(ctx context.Context, versionID string, f Filter) ([]domain.RealiseEntry, error) {
	return s.query(ctx, versionID, f)
}

// facetColumns: facet name → column.
var facetColumns = [][2]string{
	{"entite", "entite"}, {"activite", "activite"}, {"trigramme", "trigramme"}, {"tg", "tg"}, {"wp", "wp"},
	{"categorie", "categorie"}, {"type", "type"}, {"lot", "lot_ifrs15"}, {"statut", "statut_parsing"},
}

// Facets returns the distinct non-empty values of the filterable columns.
func (s *Service) Facets(ctx context.Context, versionID string) (domain.Facets, error) {
	if _, err := s.st.GetVersion(ctx, domain.KindRealise, versionID); err != nil {
		return nil, err
	}
	out := domain.Facets{}
	for _, fc := range facetColumns {
		rows, err := s.st.DB().QueryContext(ctx, `SELECT DISTINCT `+fc[1]+` FROM realise_entries
			WHERE version_id = ? AND `+fc[1]+` <> '' ORDER BY `+fc[1], versionID)
		if err != nil {
			return nil, err
		}
		vals := []string{}
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				return nil, err
			}
			vals = append(vals, v)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		out[fc[0]] = vals
	}
	return out, nil
}
