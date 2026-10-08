package provision

import (
	"context"
	"database/sql"
	"math"
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
	"njord/internal/xlsxutil"
)

// LineFilter holds the filters of GET /provision/versions/:id/lines(.csv)
// (docs/API.md, Provisions : lignes). Multi-valued exact filters match any of
// their values; a groupe also matches its sub-groups ("A" → "A > B").
type LineFilter struct {
	CT, LigneCout, Groupe, Statut []string
	Q                             string // CT / libellé / groupe, insensible casse et accents
	Sort                          string // row_num | ct | montant | date_debut
	Desc                          bool
}

// SortFields lists the accepted sort keys.
var SortFields = []string{"row_num", "ct", "montant", "date_debut"}

const lineCols = `id, version_id, row_num, ct, libelle, montant, unite, ligne_cout, type_depense,
	date_debut, date_fin, groupe, statut_parsing, motif_rejet`

func scanLine(rows *sql.Rows) (domain.ProvisionLine, error) {
	var l domain.ProvisionLine
	err := rows.Scan(&l.ID, &l.VersionID, &l.RowNum, &l.CT, &l.Libelle, &l.Montant, &l.Unite, &l.LigneCout,
		&l.TypeDepense, &l.DateDebut, &l.DateFin, &l.Groupe, &l.StatutParsing, &l.MotifRejet)
	return l, err
}

// fold lowers and strips accents for the full-text search.
func fold(s string) string { return strings.ToLower(xlsxutil.StripAccents(s)) }

// QueryLines returns the lines of a version matching f, sorted (no
// pagination). Exact filters are applied in SQL, the accent-insensitive
// search and the sort in Go (a version holds a few hundred lines at most).
func QueryLines(ctx context.Context, ex store.Execer, versionID string, f LineFilter) ([]domain.ProvisionLine, error) {
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
	in("ct", f.CT)
	in("ligne_cout", f.LigneCout)
	in("statut_parsing", f.Statut)
	if len(f.Groupe) > 0 {
		var ors []string
		for _, g := range f.Groupe {
			ors = append(ors, "groupe = ? OR instr(groupe, ?) = 1")
			args = append(args, g, g+" > ")
		}
		where = append(where, "("+strings.Join(ors, " OR ")+")")
	}
	rows, err := ex.QueryContext(ctx,
		`SELECT `+lineCols+` FROM provision_lines WHERE `+strings.Join(where, " AND ")+` ORDER BY row_num, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	needle := fold(strings.TrimSpace(f.Q))
	out := []domain.ProvisionLine{}
	for rows.Next() {
		l, err := scanLine(rows)
		if err != nil {
			return nil, err
		}
		if needle != "" && !strings.Contains(fold(l.CT+"\x00"+l.Libelle+"\x00"+l.Groupe), needle) {
			continue
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortLines(out, f.Sort, f.Desc)
	return out, nil
}

func sortLines(ls []domain.ProvisionLine, by string, desc bool) {
	less := func(a, b *domain.ProvisionLine) int {
		switch by {
		case "ct":
			return strings.Compare(a.CT, b.CT)
		case "montant":
			switch {
			case a.Montant < b.Montant:
				return -1
			case a.Montant > b.Montant:
				return 1
			}
			return 0
		case "date_debut":
			return strings.Compare(a.DateDebut, b.DateDebut)
		}
		return a.RowNum - b.RowNum
	}
	sort.SliceStable(ls, func(i, j int) bool {
		c := less(&ls[i], &ls[j])
		if desc {
			c = -c
		}
		if c != 0 {
			return c < 0
		}
		return ls[i].RowNum < ls[j].RowNum // départage stable : ligne Excel croissante
	})
}

// query checks the version then returns its filtered lines.
func (s *Service) query(ctx context.Context, versionID string, f LineFilter) ([]domain.ProvisionLine, error) {
	if _, err := s.st.GetVersion(ctx, domain.KindProvision, versionID); err != nil {
		return nil, err
	}
	return QueryLines(ctx, s.st.DB(), versionID, f)
}

// Lines returns one page of the filtered lines; totals.montant is the sum
// over the whole filter (dropped lines included when the filter keeps them,
// as for the plan lines).
func (s *Service) Lines(ctx context.Context, versionID string, f LineFilter, limit, offset int) (*domain.ProvisionLinesPage, error) {
	all, err := s.query(ctx, versionID, f)
	if err != nil {
		return nil, err
	}
	page := &domain.ProvisionLinesPage{Items: []domain.ProvisionLine{}, Total: len(all)}
	for _, l := range all {
		page.Totals.Montant += l.Montant
	}
	page.Totals.Montant = math.Round(page.Totals.Montant*100) / 100
	if offset < len(all) {
		end := offset + limit
		if end > len(all) {
			end = len(all)
		}
		page.Items = all[offset:end]
	}
	return page, nil
}

// AllLines returns every filtered line (CSV export).
func (s *Service) AllLines(ctx context.Context, versionID string, f LineFilter) ([]domain.ProvisionLine, error) {
	return s.query(ctx, versionID, f)
}

// facetColumns: facet name → column.
var facetColumns = [][2]string{
	{"ct", "ct"}, {"ligne_cout", "ligne_cout"}, {"groupe", "groupe"}, {"statut", "statut_parsing"},
}

// Facets returns the distinct non-empty values of the filterable columns.
func (s *Service) Facets(ctx context.Context, versionID string) (domain.Facets, error) {
	if _, err := s.st.GetVersion(ctx, domain.KindProvision, versionID); err != nil {
		return nil, err
	}
	out := domain.Facets{}
	for _, fc := range facetColumns {
		rows, err := s.st.DB().QueryContext(ctx, `SELECT DISTINCT `+fc[1]+` FROM provision_lines
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
