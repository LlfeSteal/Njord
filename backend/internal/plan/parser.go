package plan

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"

	"njord/internal/domain"
	"njord/internal/xlsxutil"
)

// ParseError is a blocking import error (nothing is written). Code is one of
// "sheet_not_found", "header_invalid", "file_invalid".
type ParseError struct {
	Code string
	Msg  string
}

func (e *ParseError) Error() string { return e.Msg }

// ParsedLine is a plan line plus the raw Excel group path it belongs to.
type ParsedLine struct {
	domain.PlanLine
	// GroupPath: groups Excel ouverts (externe → interne), ex. ["Squad Alpha — Plateforme", "Alpha Core Team"].
	GroupPath []string
}

// Squad returns the raw name of the innermost Excel group ("" if none).
func (l *ParsedLine) Squad() string {
	if len(l.GroupPath) == 0 {
		return ""
	}
	return l.GroupPath[len(l.GroupPath)-1]
}

// ParseResult is the outcome of Parse.
type ParseResult struct {
	Sheet        string
	HeaderRow    int
	SourceFormat string
	Lines        []ParsedLine
	Total        int // lignes de données (ok + warn + drop)
	OK           int
	Warn         int
	Drop         int
	PeriodeDebut string
	PeriodeFin   string
	Layout       string // A | B | mixte | ""
	PctInactifs  float64
	Issues       []domain.ParseIssue // toutes (le rapport tronque)
	MotifsCount  map[string]int      // par catégorie de motif
}

// Expected header (NormHeader form), in order, at the head of the header row.
var expectedHeader = [][]string{
	{"tache ou sous projet"},
	{"ressource"},
	{"libelle"},
	{"type d affectation"},
	{"ligne de cout"},
	{"charge totale"},
	{"pps"},
	{"pourcentage"},
	{"unite"},
	{"calcul de la duree"},
	{"date de debut", "date debut"},
	{"date de fin", "date fin"},
}

var expectedLabels = []string{
	"Tâche ou sous-projet", "Ressource", "Libellé", "Type d'affectation", "Ligne de coût",
	"Charge totale", ".PPS", "Pourcentage", "Unité", "Calcul de la durée", "Date début", "Date fin",
}

func headerMatches(row []string) bool {
	if len(row) < len(expectedHeader) {
		return false
	}
	for i, alts := range expectedHeader {
		ok := false
		for _, a := range alts {
			if row[i] == a {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

// looseHeader: at least 4 of the expected column names somewhere in the row
// (used only to tell "en-tête non conforme" from "onglet introuvable").
func looseHeader(row []string) bool {
	n := 0
	for _, alts := range expectedHeader {
		for _, a := range alts {
			if xlsxutil.IndexOf(row, a) >= 0 {
				n++
				break
			}
		}
	}
	return n >= 4
}

// AllowedPct are the Pourcentage values of SPEC §8 règle 3 (strict : toute autre
// valeur → warn, ligne conservée).
var AllowedPct = map[int]bool{20: true, 30: true, 40: true, 50: true, 70: true, 80: true, 100: true}

// PctAllowed implements §8 règle 3.
func PctAllowed(p int) bool { return AllowedPct[p] }

var layoutBKeywords = []string{"OEUVRE", "CAPACITE", "MISSION", "PROVISION", "ACHATS", "STOCK"}

// Motif categories (keys of MotifsCount).
const (
	motifLayout      = "layout inconnu"
	motifCTVide      = "CT vide"
	motifRessVide    = "ressource vide"
	motifChargeNeg   = "charge totale négative"
	motifChargeNum   = "charge totale non numérique"
	motifDateDebut   = "date de début non convertible"
	motifDateFin     = "date de fin non convertible"
	motifPct         = "pourcentage hors valeurs autorisées"
	motifPctNum      = "pourcentage non numérique"
	motifPPS         = "PPS non numérique"
	motifDates       = "date de fin antérieure à la date de début"
	motifDoublon     = "doublon (CT, ressource, période)"
	motifRessInconnu = "ressource de format inconnu"
)

type issue struct {
	statut domain.ParsingStatut
	cat    string
	text   string
}

type lineIssues []issue

func (li *lineIssues) add(st domain.ParsingStatut, cat, text string) {
	if text == "" {
		text = cat
	}
	*li = append(*li, issue{st, cat, text})
}

func (li lineIssues) statut() domain.ParsingStatut {
	s := domain.ParsingOK
	for _, i := range li {
		if i.statut == domain.ParsingDrop {
			return domain.ParsingDrop
		}
		if i.statut == domain.ParsingWarn {
			s = domain.ParsingWarn
		}
	}
	return s
}

func (li lineIssues) motif() string {
	parts := make([]string, 0, len(li))
	for _, i := range li {
		parts = append(parts, i.text)
	}
	return strings.Join(parts, " ; ")
}

var (
	reInactif  = regexp.MustCompile(`(?i)^\s*\[\s*inactif\s*\]\s*`)
	reInternal = regexp.MustCompile(`^[A-Z0-9_]{1,12}$`)
)

// NormalizeRessource strips the [inactif] prefix and classifies the code
// (SPEC §4.2 + DECISIONS): internal | external | unknown.
func NormalizeRessource(raw string) (code string, inactive bool, kind string) {
	code = strings.TrimSpace(raw)
	if loc := reInactif.FindStringIndex(code); loc != nil {
		inactive = true
		code = strings.TrimSpace(code[loc[1]:])
	}
	switch {
	case code == "":
		kind = "unknown"
	case strings.HasPrefix(strings.ToUpper(code), "2GI_") || strings.HasPrefix(strings.ToUpper(code), "RES_EXT_") || len([]rune(code)) > 12:
		kind = "external"
	case reInternal.MatchString(code):
		kind = "internal"
	default:
		kind = "unknown"
	}
	return
}

func detectLayout(v3 string) string {
	v3 = strings.TrimSpace(v3)
	if strings.EqualFold(v3, "Standard") {
		return "A"
	}
	if v3 != "" && v3 == strings.ToUpper(v3) {
		up := strings.ToUpper(xlsxutil.StripAccents(v3))
		for _, k := range layoutBKeywords {
			if strings.Contains(up, k) {
				return "B"
			}
		}
	}
	return ""
}

// group tracks an open Excel group (squad) while scanning rows.
type group struct {
	name   string
	somme  *float64
	cum    float64
	nLines int
}

// Parse reads a plan de charge workbook (format spec or démo). It is pure:
// no database access. Blocking errors are *ParseError.
func Parse(data []byte) (*ParseResult, error) {
	t, err := xlsxutil.FindTable(data, []string{"Plan de charge"}, 20, headerMatches)
	if err != nil {
		if !errors.Is(err, xlsxutil.ErrSheetNotFound) {
			return nil, &ParseError{"file_invalid", "fichier Excel illisible : vérifiez qu'il s'agit bien d'un classeur .xlsx"}
		}
		return nil, diagnoseHeader(data)
	}
	norm := make([]string, len(t.Header))
	for i, h := range t.Header {
		norm[i] = xlsxutil.NormHeader(h)
	}
	idxQte := xlsxutil.IndexOf(norm, "quantite affectee")
	idxTaux := xlsxutil.IndexOf(norm, "taux fixe")
	idxDepuis := xlsxutil.IndexOf(norm, "depuis")
	idxPendant := xlsxutil.IndexOf(norm, "pendant")

	res := &ParseResult{Sheet: t.Sheet, HeaderRow: t.HeaderRow, SourceFormat: domain.FormatSpec, MotifsCount: map[string]int{}}
	if idxQte >= 0 || idxTaux >= 0 || idxDepuis >= 0 || idxPendant >= 0 || !strings.EqualFold(strings.TrimSpace(t.Sheet), "Plan de charge") {
		res.SourceFormat = domain.FormatDemo
	}

	var stack []*group
	var issues []lineIssues

	for k, row := range t.Rows {
		rowNum := t.RowNums[k]
		first := xlsxutil.Cell(row, 0)
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
			v, err := xlsxutil.ParseNumber(xlsxutil.Cell(row, 5))
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
			// Ligne de groupe. Un groupe sans Somme qui a déjà reçu des lignes
			// est remplacé (frère) ; sinon le nouveau groupe est imbriqué.
			for len(stack) > 0 {
				top := stack[len(stack)-1]
				if top.somme == nil && top.nLines > 0 {
					stack = stack[:len(stack)-1]
					continue
				}
				break
			}
			stack = append(stack, &group{name: strings.Join(strings.Fields(first), " ")})
			continue
		}

		// Ligne de données.
		pl, li := parseDataRow(row, rowNum, idxQte, idxTaux, idxDepuis, idxPendant)
		path := make([]string, len(stack))
		for i, g := range stack {
			path[i] = g.name
			g.nLines++
			g.cum += pl.ChargeTotale
		}
		pl.Groupe = strings.Join(path, " > ")
		res.Lines = append(res.Lines, ParsedLine{PlanLine: pl, GroupPath: path})
		issues = append(issues, li)
		stack = closeGroups(stack)
	}

	// Règle 6 : doublons (CT, Ressource, date_debut, date_fin) parmi les lignes non rejetées.
	type key struct{ ct, res, d1, d2 string }
	seen := map[key][]int{}
	for i, l := range res.Lines {
		if issues[i].statut() == domain.ParsingDrop {
			continue
		}
		k := key{l.CT, l.Ressource, l.DateDebut, l.DateFin}
		seen[k] = append(seen[k], i)
	}
	for _, idxs := range seen {
		if len(idxs) < 2 {
			continue
		}
		for _, i := range idxs {
			others := []string{}
			for _, j := range idxs {
				if j != i {
					others = append(others, fmt.Sprint(res.Lines[j].RowNum))
				}
			}
			issues[i].add(domain.ParsingWarn, motifDoublon,
				fmt.Sprintf("doublon (CT, ressource, période) avec la ligne %s : agrégation implicite", strings.Join(others, ", ")))
		}
	}

	// Statuts, compteurs, période, layout, inactifs.
	layouts := map[string]bool{}
	ress := map[string]bool{}
	for i := range res.Lines {
		l := &res.Lines[i]
		l.StatutParsing = issues[i].statut()
		l.MotifRejet = issues[i].motif()
		res.Total++
		if l.Layout != "" {
			layouts[l.Layout] = true
		}
		switch l.StatutParsing {
		case domain.ParsingOK:
			res.OK++
		case domain.ParsingWarn:
			res.Warn++
		case domain.ParsingDrop:
			res.Drop++
		}
		for _, is := range issues[i] {
			res.MotifsCount[is.cat]++
		}
		if l.StatutParsing != domain.ParsingOK {
			res.Issues = append(res.Issues, domain.ParseIssue{RowNum: l.RowNum, Statut: l.StatutParsing, Motif: l.MotifRejet})
		}
		if l.StatutParsing == domain.ParsingDrop {
			continue
		}
		if l.DateDebut != "" && (res.PeriodeDebut == "" || l.DateDebut < res.PeriodeDebut) {
			res.PeriodeDebut = l.DateDebut
		}
		if l.DateFin != "" && l.DateFin > res.PeriodeFin {
			res.PeriodeFin = l.DateFin
		}
		ress[l.Ressource] = ress[l.Ressource] || l.Inactive
	}
	switch {
	case layouts["A"] && layouts["B"]:
		res.Layout = "mixte"
	case layouts["A"]:
		res.Layout = "A"
	case layouts["B"]:
		res.Layout = "B"
	}
	if len(ress) > 0 {
		n := 0
		for _, in := range ress {
			if in {
				n++
			}
		}
		res.PctInactifs = math.Round(float64(n)*10000/float64(len(ress))) / 100
	}
	return res, nil
}

// closeGroups drops every open group whose cumulated charge reached its Somme
// (±0.01), together with the groups nested in it.
func closeGroups(stack []*group) []*group {
	for i, g := range stack {
		if g.somme != nil && g.cum >= *g.somme-0.01 {
			return stack[:i]
		}
	}
	return stack
}

func diagnoseHeader(data []byte) error {
	hasSheet := false
	if f, err := excelize.OpenReader(bytes.NewReader(data)); err == nil {
		for _, s := range f.GetSheetList() {
			if strings.EqualFold(strings.TrimSpace(s), "Plan de charge") {
				hasSheet = true
			}
		}
		f.Close()
	}
	_, err := xlsxutil.FindTable(data, []string{"Plan de charge"}, 20, looseHeader)
	if hasSheet || err == nil {
		return &ParseError{"header_invalid", "en-tête non conforme : les 12 colonnes attendues doivent figurer dans l'ordre en tête de ligne (" +
			strings.Join(expectedLabels, ", ") + ") ; aucune ligne importée"}
	}
	return &ParseError{"sheet_not_found", "onglet « Plan de charge » introuvable (aucun onglet ne contient l'en-tête attendu)"}
}

func parseDataRow(row []string, rowNum, idxQte, idxTaux, idxDepuis, idxPendant int) (domain.PlanLine, lineIssues) {
	var li lineIssues
	pl := domain.PlanLine{RowNum: rowNum}
	layout := detectLayout(xlsxutil.Cell(row, 3))
	pl.Layout = layout

	// Positions des colonnes 4..11 selon le layout (B = décalage d'une position).
	shift := 0
	if layout == "B" {
		shift = -1
	}
	at := func(specPos int) string { return xlsxutil.Cell(row, specPos+shift) }

	pl.CT = xlsxutil.Cell(row, 0)
	code, inactive, kind := NormalizeRessource(xlsxutil.Cell(row, 1))
	pl.Ressource, pl.Inactive, pl.RessourceKind = code, inactive, kind
	pl.Libelle = strings.Join(strings.Fields(xlsxutil.Cell(row, 2)), " ")
	if layout != "B" {
		pl.TypeAffectation = xlsxutil.Cell(row, 3)
	}
	pl.LigneCout = at(4)
	pl.Unite = at(8)
	pl.CalculDuree = at(9)
	if layout != "B" {
		if idxQte >= 0 {
			if v, err := xlsxutil.ParseNumber(xlsxutil.Cell(row, idxQte)); err == nil {
				pl.QuantiteAffectee = &v
			}
		}
		pl.TauxFixe = xlsxutil.Cell(row, idxTaux)
		pl.Depuis = xlsxutil.Cell(row, idxDepuis)
		pl.Pendant = xlsxutil.Cell(row, idxPendant)
	}

	if layout == "" {
		li.add(domain.ParsingDrop, motifLayout, fmt.Sprintf("layout inconnu (colonne 4 = « %s »)", xlsxutil.Cell(row, 3)))
	}
	if pl.CT == "" {
		li.add(domain.ParsingDrop, motifCTVide, "")
	}
	if pl.Ressource == "" {
		li.add(domain.ParsingDrop, motifRessVide, "")
	}

	if v, err := xlsxutil.ParseNumber(at(5)); err == nil {
		pl.ChargeTotale = v
		if v < 0 {
			li.add(domain.ParsingDrop, motifChargeNeg, fmt.Sprintf("charge totale négative (%s h)", formatNum(v)))
		}
	} else if layout != "" {
		li.add(domain.ParsingDrop, motifChargeNum, fmt.Sprintf("charge totale non numérique (« %s »)", at(5)))
	}
	if v, err := xlsxutil.ParseNumber(at(6)); err == nil {
		pl.PPS = v
	} else if layout != "" {
		li.add(domain.ParsingWarn, motifPPS, "PPS absent ou non numérique (0 retenu)")
	}
	if v, err := xlsxutil.ParseNumber(at(7)); err == nil {
		pl.Pourcentage = int(math.Round(v))
		if !PctAllowed(pl.Pourcentage) && layout != "" {
			li.add(domain.ParsingWarn, motifPct, fmt.Sprintf("pourcentage %s hors valeurs autorisées (20, 30, 40, 50, 70, 80, 100)", formatNum(v)))
		}
	} else if layout != "" {
		li.add(domain.ParsingWarn, motifPctNum, fmt.Sprintf("pourcentage non numérique (« %s »)", at(7)))
	}
	d1, err1 := xlsxutil.ParseDate(at(10))
	d2, err2 := xlsxutil.ParseDate(at(11))
	if err1 == nil {
		pl.DateDebut = d1
	} else if layout != "" {
		li.add(domain.ParsingDrop, motifDateDebut, fmt.Sprintf("date de début non convertible (« %s »)", at(10)))
	}
	if err2 == nil {
		pl.DateFin = d2
	} else if layout != "" {
		li.add(domain.ParsingDrop, motifDateFin, fmt.Sprintf("date de fin non convertible (« %s »)", at(11)))
	}
	if err1 == nil && err2 == nil && d2 < d1 {
		li.add(domain.ParsingWarn, motifDates, "")
	}
	if pl.Ressource != "" && kind == "unknown" {
		li.add(domain.ParsingWarn, motifRessInconnu, "")
	}
	return pl, li
}

func formatNum(v float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".")
}
