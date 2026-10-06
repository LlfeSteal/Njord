package plan

import (
	"context"
	"database/sql"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
	"njord/internal/xlsxutil"
)

// LineFilter holds the filters of GET /plan/versions/:id/lines(.csv).
type LineFilter struct {
	CT, NomPrenom, LigneCout, Statut, SquadID string
	Inactive                                  *bool // nil = tous
	DateFrom, DateTo                          string
	Q                                         string // plein-texte libellé / nom_prenom / CT
	Sort                                      string
	Desc                                      bool
}

var sortColumns = map[string]bool{"row_num": true, "ct": true, "nom_prenom": true, "charge_totale": true, "pps": true, "date_debut": true}

func filterFromQuery(c *gin.Context) (LineFilter, error) {
	f := LineFilter{
		CT:        strings.TrimSpace(c.Query("ct")),
		NomPrenom: strings.TrimSpace(c.Query("nom_prenom")),
		LigneCout: strings.TrimSpace(c.Query("ligne_cout")),
		Statut:    strings.TrimSpace(c.Query("statut")),
		SquadID:   strings.TrimSpace(c.Query("squad_id")),
		Q:         strings.TrimSpace(c.Query("q")),
		Sort:      c.DefaultQuery("sort", "row_num"),
		Desc:      strings.EqualFold(c.Query("order"), "desc"),
	}
	if v, ok := c.GetQuery("inactive"); ok && strings.TrimSpace(v) != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return f, httpx.BadRequest("paramètre inactive invalide (true|false)")
		}
		f.Inactive = &b
	}
	if f.Statut != "" && f.Statut != "ok" && f.Statut != "warn" && f.Statut != "drop" {
		return f, httpx.BadRequest("paramètre statut invalide (ok|warn|drop)")
	}
	if f.Sort == "" {
		f.Sort = "row_num"
	}
	if !sortColumns[f.Sort] {
		return f, httpx.BadRequest("paramètre sort invalide")
	}
	var err error
	if v := strings.TrimSpace(c.Query("date_from")); v != "" {
		if f.DateFrom, err = xlsxutil.ParseDate(v); err != nil {
			return f, httpx.BadRequest("date_from invalide (YYYY-MM-DD)")
		}
	}
	if v := strings.TrimSpace(c.Query("date_to")); v != "" {
		if f.DateTo, err = xlsxutil.ParseDate(v); err != nil {
			return f, httpx.BadRequest("date_to invalide (YYYY-MM-DD)")
		}
	}
	return f, nil
}

const lineCols = `id, version_id, row_num, layout, ct, ressource, libelle, nom_prenom, type_affectation, ligne_cout,
	charge_totale, pps, pourcentage, unite, calcul_duree, date_debut, date_fin, quantite_affectee, taux_fixe,
	depuis, pendant, statut_parsing, motif_rejet, ressource_kind, inactive, personne_id, squad_id, groupe`

func scanLine(rows *sql.Rows) (domain.PlanLine, error) {
	var l domain.PlanLine
	var qte sql.NullFloat64
	var pid, sid sql.NullString
	err := rows.Scan(&l.ID, &l.VersionID, &l.RowNum, &l.Layout, &l.CT, &l.Ressource, &l.Libelle, &l.NomPrenom, &l.TypeAffectation,
		&l.LigneCout, &l.ChargeTotale, &l.PPS, &l.Pourcentage, &l.Unite, &l.CalculDuree, &l.DateDebut, &l.DateFin,
		&qte, &l.TauxFixe, &l.Depuis, &l.Pendant, &l.StatutParsing, &l.MotifRejet, &l.RessourceKind, &l.Inactive,
		&pid, &sid, &l.Groupe)
	if qte.Valid {
		v := qte.Float64
		l.QuantiteAffectee = &v
	}
	if pid.Valid {
		v := pid.String
		l.PersonneID = &v
	}
	if sid.Valid {
		v := sid.String
		l.SquadID = &v
	}
	return l, err
}

// foldText: lower case without accents, for case/accent-insensitive search.
func foldText(s string) string { return strings.ToLower(xlsxutil.StripAccents(s)) }

// QueryLines returns the lines of a version matching f, sorted (no pagination).
func QueryLines(ctx context.Context, ex store.Execer, versionID string, f LineFilter) ([]domain.PlanLine, error) {
	q := `SELECT ` + lineCols + ` FROM plan_lines WHERE version_id = ?`
	args := []any{versionID}
	add := func(cond string, v any) {
		q += ` AND ` + cond
		args = append(args, v)
	}
	if f.CT != "" {
		add(`ct = ?`, f.CT)
	}
	if f.NomPrenom != "" {
		add(`nom_prenom = ?`, f.NomPrenom)
	}
	if f.LigneCout != "" {
		add(`ligne_cout = ?`, f.LigneCout)
	}
	if f.Statut != "" {
		add(`statut_parsing = ?`, f.Statut)
	}
	if f.SquadID != "" {
		add(`squad_id = ?`, f.SquadID)
	}
	if f.Inactive != nil {
		add(`inactive = ?`, *f.Inactive)
	}
	if f.DateFrom != "" {
		add(`date_fin <> '' AND date_fin >= ?`, f.DateFrom)
	}
	if f.DateTo != "" {
		add(`date_debut <> '' AND date_debut <= ?`, f.DateTo)
	}
	rows, err := ex.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	needle := foldText(f.Q)
	out := []domain.PlanLine{}
	for rows.Next() {
		l, err := scanLine(rows)
		if err != nil {
			return nil, err
		}
		if needle != "" && !strings.Contains(foldText(l.Libelle+"\x00"+l.NomPrenom+"\x00"+l.CT), needle) {
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

func sortLines(ls []domain.PlanLine, by string, desc bool) {
	less := func(a, b *domain.PlanLine) int {
		switch by {
		case "ct":
			return strings.Compare(a.CT, b.CT)
		case "nom_prenom":
			return strings.Compare(a.NomPrenom, b.NomPrenom)
		case "charge_totale":
			return cmpFloat(a.ChargeTotale, b.ChargeTotale)
		case "pps":
			return cmpFloat(a.PPS, b.PPS)
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
		return ls[i].RowNum < ls[j].RowNum
	})
}

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// Facets returns the distinct values of the filterable columns of a version.
func Facets(ctx context.Context, ex store.Execer, versionID string) (domain.Facets, error) {
	out := domain.Facets{}
	for facet, col := range map[string]string{
		"ct": "ct", "nom_prenom": "nom_prenom", "ligne_cout": "ligne_cout", "squad_id": "squad_id", "statut": "statut_parsing",
	} {
		rows, err := ex.QueryContext(ctx, `SELECT DISTINCT `+col+` FROM plan_lines WHERE version_id = ? AND `+col+` IS NOT NULL AND `+col+` <> '' ORDER BY 1`, versionID)
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
		out[facet] = vals
	}
	return out, nil
}
