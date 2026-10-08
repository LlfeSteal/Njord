// Package provision manages the life cycle of the "provisions" imports
// (DECISIONS n° 16): parsing of the Planisware « Dépenses prévues » export,
// import as a version, consultation of the lines (filters, totals, CSV).
// A provision is an available, non-committed budget of a CT.
package provision

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/xuri/excelize/v2"

	"njord/internal/domain"
	"njord/internal/xlsxutil"
)

// Codes of the blocking import errors (HTTP 422).
const (
	CodeSheetNotFound = "sheet_not_found"
	CodeHeaderInvalid = "header_invalid"
	CodeFileInvalid   = "file_invalid"
)

// ParseError is a blocking import error (nothing is written).
type ParseError struct {
	Code string
	Msg  string
}

func (e *ParseError) Error() string { return e.Msg }

// MaxIssues bounds ParseResult.Issues (the report detail).
const MaxIssues = 500

// preferredSheets: onglets examinés en premier (puis tous les autres).
var preferredSheets = []string{"Provisions", "Style par défaut"}

// ParseResult is the outcome of Parse. Lines holds every data line, including
// the dropped ones (statut_parsing = drop), in file order.
type ParseResult struct {
	Sheet           string
	HeaderRow       int    // 1-based
	SourceFormat    string // domain.FormatProvisions
	Lines           []domain.ProvisionLine
	Total           int // lignes de données (ok + warn + drop)
	OK, Warn, Drop  int
	PeriodeDebut    string              // plus petite date des lignes acceptées
	PeriodeFin      string              // plus grande date des lignes acceptées
	MontantTotalEur float64             // Σ montants des lignes acceptées (ok + warn)
	Issues          []domain.ParseIssue // tronqué à MaxIssues
	MotifsCount     map[string]int      // motif générique → nb de lignes
}

// column describes one header of the export: a field key, its accepted
// normalized labels (xlsxutil.NormHeader) and its display label.
type column struct {
	field    string
	names    []string
	label    string
	required bool
}

// columns of the « Dépenses prévues » export. Columns are located by name;
// the optional ones may be absent.
var columns = []column{
	{"ct", []string{"tache ou sous projet"}, "Tâche ou sous-projet", true},
	{"libelle", []string{"libelle"}, "Libellé", false},
	{"quantite", []string{"quantite"}, "Quantité", true},
	{"unite", []string{"unite"}, "Unité", false},
	{"ligne_cout", []string{"ligne de cout"}, "Ligne de coût", true},
	{"type_depense", []string{"type de depense"}, "Type de dépense", true},
	{"date_debut", []string{"date de debut", "date debut"}, "Date de début", false},
	{"date_fin", []string{"date de fin", "date fin"}, "Date de fin", false},
	{"calcul_duree", []string{"calcul de la duree"}, "Calcul de la durée", false},
	{"depuis", []string{"depuis"}, "Depuis", false},
	{"pendant", []string{"pendant"}, "Pendant", false},
	{"pps", []string{"pps"}, ".PPS", true},
}

// headerIndex maps every present column to its position; ok=false if a
// required column is missing.
func headerIndex(row []string) (map[string]int, bool) {
	idx := map[string]int{}
	ok := true
	for _, c := range columns {
		if i := xlsxutil.IndexOf(row, c.names...); i >= 0 {
			idx[c.field] = i
		} else if c.required {
			ok = false
		}
	}
	return idx, ok
}

func headerMatches(row []string) bool { _, ok := headerIndex(row); return ok }

// countKnown: number of export columns present in row (diagnostic only).
func countKnown(row []string) int {
	n := 0
	for _, c := range columns {
		if xlsxutil.IndexOf(row, c.names...) >= 0 {
			n++
		}
	}
	return n
}

func requiredLabels() []string {
	var out []string
	for _, c := range columns {
		if c.required {
			out = append(out, c.label)
		}
	}
	return out
}

// Motif categories (keys of MotifsCount).
const (
	motifCTVide     = "CT vide"
	motifMontantNum = "montant non numérique"
	motifUnite      = "unité différente de EURO"
	motifDateDebut  = "date de début illisible"
	motifDateFin    = "date de fin illisible"
	motifNegatif    = "montant négatif"
	motifDoublon    = "doublon (CT, libellé, ligne de coût, date, montant)"
)

// issue is one parsing problem of a line: cat = generic motif (counted in
// MotifsCount), text = readable detail stored in motif_rejet.
type issue struct {
	drop bool
	cat  string
	text string
}

// group tracks an open Excel group (projet / sous-projet) while scanning rows.
type group struct {
	name   string
	somme  *float64
	cum    float64
	nLines int
}

// Parse reads a « Dépenses prévues » workbook. It is pure: no database
// access. Blocking errors are *ParseError.
func Parse(data []byte) (*ParseResult, error) {
	t, err := xlsxutil.FindTable(data, preferredSheets, 20, headerMatches)
	if err != nil {
		if !errors.Is(err, xlsxutil.ErrSheetNotFound) {
			return nil, &ParseError{CodeFileInvalid, "fichier Excel illisible : vérifiez qu'il s'agit bien d'un classeur .xlsx"}
		}
		return nil, diagnoseHeader(data)
	}
	norm := make([]string, len(t.Header))
	for i, h := range t.Header {
		norm[i] = xlsxutil.NormHeader(h)
	}
	idx, _ := headerIndex(norm)
	get := func(row []string, field string) string {
		i, ok := idx[field]
		if !ok {
			return ""
		}
		return xlsxutil.Cell(row, i)
	}
	_, hasUnite := idx["unite"]

	res := &ParseResult{
		Sheet:        t.Sheet,
		HeaderRow:    t.HeaderRow,
		SourceFormat: domain.FormatProvisions,
		Lines:        []domain.ProvisionLine{},
		Issues:       []domain.ParseIssue{},
		MotifsCount:  map[string]int{},
	}

	type dupKey struct {
		ct, libelle, ligneCout, date string
		montant                      int64 // centimes
	}
	seen := map[dupKey]int{}
	var stack []*group
	var montant float64

	for k, row := range t.Rows {
		rowNum := t.RowNums[k]
		first := xlsxutil.Cell(row, idx["ct"])
		nonEmpty := 0
		for i := range row {
			if xlsxutil.Cell(row, i) != "" {
				nonEmpty++
			}
		}
		if nonEmpty == 0 {
			continue
		}
		if strings.EqualFold(first, "Somme") {
			// Total du groupe : colonne Quantité, à défaut .PPS.
			v, err := xlsxutil.ParseNumber(get(row, "quantite"))
			if err != nil {
				v, err = xlsxutil.ParseNumber(get(row, "pps"))
			}
			if err == nil {
				for i := len(stack) - 1; i >= 0; i-- {
					if stack[i].somme == nil {
						stack[i].somme = &v
						break
					}
				}
				stack = closeGroups(stack)
			}
			continue
		}
		if first != "" && nonEmpty == 1 {
			// Ligne de groupe. Les groupes déjà complets (cumul ≥ Somme) sont
			// fermés ; un groupe sans Somme qui a déjà reçu des lignes est
			// remplacé (frère) ; sinon le nouveau groupe est imbriqué.
			for len(stack) > 0 {
				top := stack[len(stack)-1]
				if (top.somme == nil && top.nLines > 0) || (top.somme != nil && top.cum >= *top.somme-0.01) {
					stack = stack[:len(stack)-1]
					continue
				}
				break
			}
			stack = append(stack, &group{name: strings.Join(strings.Fields(first), " ")})
			continue
		}

		// Ligne de données.
		l := domain.ProvisionLine{
			RowNum:      rowNum,
			CT:          first,
			Libelle:     strings.Join(strings.Fields(get(row, "libelle")), " "),
			Unite:       get(row, "unite"),
			LigneCout:   get(row, "ligne_cout"),
			TypeDepense: get(row, "type_depense"),
		}
		var iss []issue
		warn := func(cat, text string) { iss = append(iss, issue{false, cat, text}) }
		drop := func(cat, text string) { iss = append(iss, issue{true, cat, text}) }

		if l.CT == "" {
			drop(motifCTVide, motifCTVide)
		}
		numeric := true
		if v, err := xlsxutil.ParseNumber(get(row, "pps")); err == nil {
			l.Montant = v
		} else if v, err := xlsxutil.ParseNumber(get(row, "quantite")); err == nil {
			l.Montant = v
		} else {
			numeric = false
			drop(motifMontantNum, fmt.Sprintf("montant non numérique (.PPS « %s », Quantité « %s »)",
				get(row, "pps"), get(row, "quantite")))
		}
		if numeric && l.Montant < 0 {
			warn(motifNegatif, fmt.Sprintf("montant négatif (%s €)", formatNum(l.Montant)))
		}
		if hasUnite && !isEuro(l.Unite) {
			u := "vide"
			if l.Unite != "" {
				u = "« " + l.Unite + " »"
			}
			warn(motifUnite, fmt.Sprintf("unité %s au lieu de EURO (montant retenu tel quel)", u))
		}
		if s := get(row, "date_debut"); s != "" {
			if d, err := xlsxutil.ParseDate(s); err == nil {
				l.DateDebut = d
			} else {
				warn(motifDateDebut, fmt.Sprintf("date de début illisible (« %s »)", s))
			}
		}
		if s := get(row, "date_fin"); s != "" {
			if d, err := xlsxutil.ParseDate(s); err == nil {
				l.DateFin = d
			} else {
				warn(motifDateFin, fmt.Sprintf("date de fin illisible (« %s »)", s))
			}
		}

		dropped := false
		for _, is := range iss {
			dropped = dropped || is.drop
		}
		if !dropped {
			key := dupKey{l.CT, l.Libelle, l.LigneCout, l.DateDebut, int64(math.Round(l.Montant * 100))}
			if prev, ok := seen[key]; ok {
				warn(motifDoublon, fmt.Sprintf("doublon (CT, libellé, ligne de coût, date, montant) de la ligne %d", prev))
			} else {
				seen[key] = rowNum
			}
		}

		// Groupes : le montant s'ajoute à tous les groupes ouverts.
		path := make([]string, len(stack))
		for i, g := range stack {
			path[i] = g.name
			g.nLines++
			g.cum += l.Montant
		}
		l.Groupe = strings.Join(path, " > ")
		stack = closeGroups(stack)

		// Statut et motifs.
		res.Total++
		switch {
		case dropped:
			l.StatutParsing = domain.ParsingDrop
			res.Drop++
		case len(iss) > 0:
			l.StatutParsing = domain.ParsingWarn
			res.Warn++
		default:
			l.StatutParsing = domain.ParsingOK
			res.OK++
		}
		if len(iss) > 0 {
			texts := make([]string, len(iss))
			for i, is := range iss {
				texts[i] = is.text
				res.MotifsCount[is.cat]++
			}
			l.MotifRejet = strings.Join(texts, " ; ")
			if len(res.Issues) < MaxIssues {
				res.Issues = append(res.Issues, domain.ParseIssue{RowNum: rowNum, Statut: l.StatutParsing, Motif: l.MotifRejet})
			}
		}
		if !dropped {
			montant += l.Montant
			for _, d := range []string{l.DateDebut, l.DateFin} {
				if d == "" {
					continue
				}
				if res.PeriodeDebut == "" || d < res.PeriodeDebut {
					res.PeriodeDebut = d
				}
				if d > res.PeriodeFin {
					res.PeriodeFin = d
				}
			}
		}
		res.Lines = append(res.Lines, l)
	}
	res.MontantTotalEur = math.Round(montant*100) / 100
	return res, nil
}

// closeGroups drops every open group whose cumulated amount equals its Somme
// (±0.01), together with the groups nested in it. Unlike the plan (charges
// ≥ 0), a provision may be negative (avoir) : a group only closes when its
// total is reached exactly; an overshoot is closed by the next group row.
func closeGroups(stack []*group) []*group {
	for i, g := range stack {
		if g.somme != nil && math.Abs(g.cum-*g.somme) <= 0.01 {
			return stack[:i]
		}
	}
	return stack
}

// isEuro accepts EURO / EUR / € (case and accent insensitive).
func isEuro(u string) bool {
	switch xlsxutil.NormHeader(u) {
	case "euro", "euros", "eur":
		return true
	}
	return strings.TrimSpace(u) == "€"
}

func diagnoseHeader(data []byte) error {
	hasSheet := false
	if f, err := excelize.OpenReader(bytes.NewReader(data)); err == nil {
		for _, s := range f.GetSheetList() {
			if strings.EqualFold(strings.TrimSpace(s), "Provisions") {
				hasSheet = true
			}
		}
		f.Close()
	}
	// En-tête approchant (≥ 4 colonnes connues, ex. un plan de charge) → header_invalid.
	best := 0
	var bestRow []string
	_, _ = xlsxutil.FindTable(data, preferredSheets, 20, func(r []string) bool {
		if n := countKnown(r); n > best {
			best, bestRow = n, append([]string(nil), r...)
		}
		return false
	})
	if best >= 4 {
		var miss []string
		for _, c := range columns {
			if c.required && xlsxutil.IndexOf(bestRow, c.names...) < 0 {
				miss = append(miss, c.label)
			}
		}
		return &ParseError{CodeHeaderInvalid, fmt.Sprintf(
			"en-tête non conforme : ce fichier n'est pas un export « Dépenses prévues » (colonnes manquantes : %s ; obligatoires : %s) ; aucune ligne importée",
			strings.Join(miss, ", "), strings.Join(requiredLabels(), ", "))}
	}
	if hasSheet {
		return &ParseError{CodeHeaderInvalid,
			"en-tête non conforme : aucune ligne d'en-tête reconnue dans les 20 premières lignes de l'onglet « Provisions » (colonnes obligatoires : " +
				strings.Join(requiredLabels(), ", ") + ")"}
	}
	return &ParseError{CodeSheetNotFound, "onglet des provisions introuvable (aucun onglet ne contient l'en-tête « Dépenses prévues » attendu)"}
}

func formatNum(v float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".")
}
