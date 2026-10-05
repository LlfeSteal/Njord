// Package realise manages the life cycle of the "réalisé" imports (SPEC_realise):
// parsing of the Excel export, import as a version, consultation of the
// entries (filters, totals, CSV). No enrichment is done here (see analyse).
package realise

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

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

// FormatError is a blocking parsing error: nothing can be imported.
type FormatError struct {
	Code string
	Msg  string
}

func (e *FormatError) Error() string { return e.Msg }

// MaxIssues bounds ParseResult.Issues (the report detail).
const MaxIssues = 500

// ParseResult is the outcome of Parse. Entries holds every data line,
// including the dropped ones (statut_parsing = drop), in file order.
type ParseResult struct {
	SourceFormat    string // domain.FormatSpec | domain.FormatDemo
	SheetName       string
	HeaderRow       int // 1-based
	Entries         []domain.RealiseEntry
	Total           int // lignes de données considérées (ok + warn + drop)
	OK, Warn, Drop  int
	PeriodeDebut    string              // min DATE DEPENSE des lignes acceptées
	PeriodeFin      string              // max DATE DEPENSE des lignes acceptées
	MontantTotalEur float64             // Σ TOTAL EN € des lignes acceptées (ok + warn)
	Issues          []domain.ParseIssue // tronqué à MaxIssues
	MotifsCount     map[string]int      // motif générique → nb de lignes
}

// Enumerations of SPEC_realise §3 (compared after xlsxutil.NormHeader).
var (
	TypesConnus = []string{
		"MAIN D'OEUVRE SUR SITE", "CAPACITE SUR SITE", "FRAIS DE MISSION", "FRAIS ACHATS MATIERE",
		"FRAIS ACHATS PRESTATIONS", "AUTRES PRESTATIONS", "IMMOBILISATIONS", "NON STOCKABLE", "MATIERE",
		"PRESTATION", "FNP AUTOMATIQUES", "FNP MANUELLES", "OD PRESTATION", "OD AUTRES DEPENSES",
		"OD FRAIS DE MISSION",
		// Types référencés par la classification budgétaire (SPEC_analyse §3.3).
		"FRAIS ACHATS CAPACITE SUR SITE", "PROVISIONS POUR ALEAS", "STOCKAGE",
	}
	CategoriesConnues = []string{
		"MAIN D'OEUVRE", "PRESTATION", "MATIERE", "IMMOBILISATIONS", "FRAIS DE MISSION", "AUTRES DEPENSES",
	}
	typeSet      = normSet(TypesConnus)
	categorieSet = normSet(CategoriesConnues)
)

func normSet(vals []string) map[string]bool {
	m := make(map[string]bool, len(vals))
	for _, v := range vals {
		m[xlsxutil.NormHeader(v)] = true
	}
	return m
}

// column describes one expected header: a field key and its accepted
// normalized labels (xlsxutil.NormHeader).
type column struct {
	field string
	names []string
}

// specColumns: the 25 columns of SPEC_realise §3, in order.
var specColumns = []column{
	{"entite", []string{"entite"}},
	{"activite", []string{"activite"}},
	{"sous_activite", []string{"sous activite"}},
	{"trigramme", []string{"trigramme"}},
	{"tg", []string{"tg"}},
	{"tg_libelle", []string{"tg libelle"}},
	{"wp", []string{"wp"}},
	{"wp_libelle", []string{"wp libelle"}},
	{"description_depenses", []string{"description depenses", "description depense"}},
	{"categorie", []string{"categorie"}},
	{"type", []string{"type"}},
	{"categorie_fnp", []string{"categorie depenses pour fnp automatiques", "categorie depense pour fnp automatiques"}},
	{"employe_fournisseur", []string{"employe fournisseur"}},
	{"matricule", []string{"matricule"}},
	{"fpc", []string{"fpc"}},
	{"cea", []string{"cea"}},
	{"quantite", []string{"quantite"}},
	{"total_eur", []string{"total en", "total en eur", "total eur"}},
	{"date_depense", []string{"date depense"}},
	{"periode_comptable", []string{"periode comptable"}},
	{"compte_comptable", []string{"compte comptable"}},
	{"num_facture", []string{"n facture", "no facture", "num facture", "numero facture"}},
	{"num_commande", []string{"n commande", "no commande", "num commande", "numero commande"}},
	{"num_ligne", []string{"n ligne", "no ligne", "num ligne", "numero ligne"}},
	{"lot_ifrs15", []string{"lot de programme ifrs15", "lot de programme ifrs 15"}},
}

// demoColumns: the 16 columns of the demo export (test_data_demo), any order.
var demoColumns = []column{
	{"date_comptable", []string{"date comptable"}},
	{"mois_comptable", []string{"mois annee comptable"}},
	{"date_depense", []string{"date de depense"}},
	{"wp", []string{"wp code et description"}},
	{"tache", []string{"tache code et description"}},
	{"cout_k", []string{"cout detaille", "cout detaille k", "cout detaille keur", "cout detaille k eur"}},
	{"quantite", []string{"quantite"}},
	{"code_article", []string{"code article"}},
	{"description_depenses", []string{"description de depense"}},
	{"num_commande", []string{"numero commande"}},
	{"fournisseur", []string{"fournisseur"}},
	{"num_facture", []string{"numero facture"}},
	{"nom_ressource", []string{"nom ressource"}},
	{"categorie", []string{"categorie de depense"}},
	{"type", []string{"type de depense"}},
	{"categorie_fnp", []string{"categorie de depense des fnp"}},
}

func inNames(h string, names []string) bool {
	for _, n := range names {
		if h == n {
			return true
		}
	}
	return false
}

// matchSpec: the 25 spec columns in order at the start of the row (extra
// trailing columns tolerated).
func matchSpec(row []string) bool {
	if len(row) < len(specColumns) {
		return false
	}
	for i, c := range specColumns {
		if !inNames(row[i], c.names) {
			return false
		}
	}
	return true
}

// demoIndex maps every demo column to its position; ok=false if one is missing.
func demoIndex(row []string) (map[string]int, bool) {
	idx := map[string]int{}
	for _, c := range demoColumns {
		i := xlsxutil.IndexOf(row, c.names...)
		if i < 0 {
			return nil, false
		}
		idx[c.field] = i
	}
	return idx, true
}

func matchDemo(row []string) bool { _, ok := demoIndex(row); return ok }

// missingColumns lists the expected labels absent from row (for header_invalid).
func missingColumns(row []string, cols []column, ordered bool) []string {
	var miss []string
	for i, c := range cols {
		if ordered {
			if i >= len(row) || !inNames(row[i], c.names) {
				miss = append(miss, c.names[0])
			}
		} else if xlsxutil.IndexOf(row, c.names...) < 0 {
			miss = append(miss, c.names[0])
		}
	}
	return miss
}

func countKnown(row []string, cols []column) int {
	n := 0
	for _, c := range cols {
		if xlsxutil.IndexOf(row, c.names...) >= 0 {
			n++
		}
	}
	return n
}

// locate finds the data table or returns a *FormatError.
func locate(data []byte) (*xlsxutil.Table, string, map[string]int, error) {
	preferred := []string{"Réalisé", "Realise", "Réalise", "Realisé"}
	t, err := xlsxutil.FindTable(data, preferred, 20, func(r []string) bool { return matchSpec(r) || matchDemo(r) })
	if err == nil {
		norm := normRow(t.Header)
		if matchSpec(norm) {
			idx := map[string]int{}
			for i, c := range specColumns {
				idx[c.field] = i
			}
			return t, domain.FormatSpec, idx, nil
		}
		idx, _ := demoIndex(norm)
		return t, domain.FormatDemo, idx, nil
	}
	if !errors.Is(err, xlsxutil.ErrSheetNotFound) {
		return nil, "", nil, &FormatError{CodeFileInvalid, "fichier illisible : un classeur Excel .xlsx est attendu"}
	}
	// Diagnostic: an approximate header (≥ 5 known labels) → header_invalid.
	best := 0
	var bestRow []string
	_, _ = xlsxutil.FindTable(data, preferred, 20, func(r []string) bool {
		if n := max(countKnown(r, specColumns), countKnown(r, demoColumns)); n > best {
			best, bestRow = n, append([]string(nil), r...)
		}
		return false
	})
	if best >= 5 {
		missSpec := missingColumns(bestRow, specColumns, true)
		missDemo := missingColumns(bestRow, demoColumns, false)
		miss, format := missSpec, "25 colonnes de la spécification, dans l'ordre"
		if countKnown(bestRow, demoColumns) > countKnown(bestRow, specColumns) {
			miss, format = missDemo, "16 colonnes de l'export démo"
		}
		return nil, "", nil, &FormatError{CodeHeaderInvalid, fmt.Sprintf(
			"en-tête non conforme (%s attendues) : colonnes manquantes ou mal placées : %s", format, strings.Join(miss, ", "))}
	}
	if hasSheet(data, preferred) {
		return nil, "", nil, &FormatError{CodeHeaderInvalid,
			"en-tête non conforme : aucune ligne d'en-tête reconnue dans les 20 premières lignes de l'onglet « Réalisé »"}
	}
	return nil, "", nil, &FormatError{CodeSheetNotFound,
		"onglet « Réalisé » introuvable (aucun onglet ne contient l'en-tête attendu)"}
}

// hasSheet tells whether one of the names is a sheet of the workbook.
func hasSheet(data []byte, names []string) bool {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return false
	}
	defer f.Close()
	for _, s := range f.GetSheetList() {
		for _, n := range names {
			if strings.EqualFold(strings.TrimSpace(s), n) {
				return true
			}
		}
	}
	return false
}

func normRow(r []string) []string {
	out := make([]string, len(r))
	for i, c := range r {
		out[i] = xlsxutil.NormHeader(c)
	}
	return out
}

// issue is one parsing problem of a line: key = generic motif (counted in
// MotifsCount), text = readable detail stored in motif_rejet.
type issue struct {
	drop bool
	key  string
	text string
}

// Parse reads a réalisé workbook (spec or demo format). It is pure: nothing
// is written. Blocking errors are *FormatError.
func Parse(data []byte) (*ParseResult, error) {
	t, format, idx, err := locate(data)
	if err != nil {
		return nil, err
	}
	res := &ParseResult{
		SourceFormat: format,
		SheetName:    t.Sheet,
		HeaderRow:    t.HeaderRow,
		Entries:      []domain.RealiseEntry{},
		Issues:       []domain.ParseIssue{},
		MotifsCount:  map[string]int{},
	}
	get := func(row []string, field string) string {
		i, ok := idx[field]
		if !ok {
			return ""
		}
		return xlsxutil.NullDash(xlsxutil.Cell(row, i))
	}

	type dupKey struct{ fac, cmd, ligne, tg, date string }
	seen := map[dupKey]int{}
	var montant float64

	for k, row := range t.Rows {
		if isBlank(row) || isTotalRow(row) {
			continue
		}
		rowNum := t.RowNums[k]
		e := domain.RealiseEntry{RowNum: rowNum}
		var iss []issue
		warn := func(key, text string) { iss = append(iss, issue{false, key, text}) }
		drop := func(key, text string) { iss = append(iss, issue{true, key, text}) }

		var rawTotal string
		if format == domain.FormatSpec {
			e.Entite = get(row, "entite")
			e.Activite = get(row, "activite")
			e.SousActivite = get(row, "sous_activite")
			e.Trigramme = get(row, "trigramme")
			e.TG = get(row, "tg")
			e.TGLibelle = get(row, "tg_libelle")
			e.WP = get(row, "wp")
			e.WPLibelle = get(row, "wp_libelle")
			e.DescriptionDepenses = get(row, "description_depenses")
			e.Categorie = get(row, "categorie")
			e.Type = get(row, "type")
			e.CategorieFNP = get(row, "categorie_fnp")
			e.EmployeFournisseur = get(row, "employe_fournisseur")
			e.Matricule = get(row, "matricule")
			e.FPC = get(row, "fpc")
			e.CEA = get(row, "cea")
			e.CompteComptable = get(row, "compte_comptable")
			e.NumFacture = get(row, "num_facture")
			e.NumCommande = get(row, "num_commande")
			e.LotIFRS15 = get(row, "lot_ifrs15")
			rawTotal = get(row, "total_eur")
			if rawTotal == "" {
				drop("TOTAL EN € vide", "TOTAL EN € vide")
			} else if v, err := xlsxutil.ParseNumber(rawTotal); err != nil {
				drop("TOTAL EN € non numérique", "TOTAL EN € non numérique")
			} else {
				e.TotalEur = v
			}
			if s := get(row, "num_ligne"); s != "" {
				if v, err := xlsxutil.ParseNumber(s); err == nil && v == math.Trunc(v) {
					n := int(v)
					e.NumLigne = &n
				} else {
					warn("n° LIGNE non entier", "n° LIGNE non entier (ignoré)")
				}
			}
		} else {
			full := get(row, "tache")
			if full != "" {
				e.TG, e.TGLibelle = xlsxutil.CodeAndLabel(full)
			}
			if w := get(row, "wp"); w != "" {
				e.WP, e.WPLibelle = xlsxutil.CodeAndLabel(w)
			}
			e.DescriptionDepenses = get(row, "description_depenses")
			e.Categorie = get(row, "categorie")
			e.Type = get(row, "type")
			e.CategorieFNP = get(row, "categorie_fnp")
			e.NomRessource = get(row, "nom_ressource")
			e.Fournisseur = get(row, "fournisseur")
			e.EmployeFournisseur = e.NomRessource
			if e.EmployeFournisseur == "" {
				e.EmployeFournisseur = e.Fournisseur
			}
			e.NumFacture = get(row, "num_facture")
			e.NumCommande = get(row, "num_commande")
			e.CodeArticle = get(row, "code_article")
			if m := get(row, "mois_comptable"); m != "" {
				if d, err := xlsxutil.ParseDate(m); err == nil {
					e.MoisComptable = d
				} else {
					e.MoisComptable = m
				}
			}
			rawTotal = get(row, "cout_k")
			if rawTotal == "" {
				drop("TOTAL EN € vide", "Coût détaillé (TOTAL EN €) vide")
			} else if v, err := xlsxutil.ParseNumber(rawTotal); err != nil {
				drop("TOTAL EN € non numérique", "Coût détaillé (TOTAL EN €) non numérique")
			} else {
				e.TotalEur = math.Round(v*1000*100) / 100 // k€ → €, au centime
			}
		}

		// Champs communs : quantité, dates.
		if q := get(row, "quantite"); q != "" {
			if v, err := xlsxutil.ParseNumber(q); err == nil {
				e.Quantite = v
			} else {
				warn("QUANTITE non numérique", "QUANTITE non numérique (0 retenu)")
			}
		}
		perField := "periode_comptable"
		if format == domain.FormatDemo {
			perField = "date_comptable"
		}
		var dDep, dPer time.Time
		if s := get(row, "date_depense"); s == "" {
			drop("DATE DEPENSE vide", "DATE DEPENSE vide")
		} else if d, err := xlsxutil.ParseDate(s); err != nil {
			drop("DATE DEPENSE non convertible", "DATE DEPENSE non convertible")
		} else {
			e.DateDepense = d
			dDep, _ = time.Parse("2006-01-02", d)
		}
		if s := get(row, perField); s != "" {
			if d, err := xlsxutil.ParseDate(s); err != nil {
				warn("PERIODE COMPTABLE non convertible", "PERIODE COMPTABLE non convertible")
			} else {
				e.PeriodeComptable = d
				dPer, _ = time.Parse("2006-01-02", d)
			}
		}

		// Contrôles §7.
		if e.TG == "" {
			drop("TG vide", "TG vide")
		}
		if e.Type == "" {
			warn("TYPE vide", "TYPE vide")
		} else if !typeSet[xlsxutil.NormHeader(e.Type)] {
			warn("TYPE hors énuméré", fmt.Sprintf("TYPE hors énuméré « %s »", e.Type))
		}
		if e.Categorie == "" {
			warn("CATEGORIE vide", "CATEGORIE vide")
		} else if !categorieSet[xlsxutil.NormHeader(e.Categorie)] {
			warn("CATEGORIE hors énuméré", fmt.Sprintf("CATEGORIE hors énuméré « %s »", e.Categorie))
		}
		if !dDep.IsZero() && !dPer.IsZero() && dPer.Before(dDep.AddDate(0, 0, -7)) {
			warn("clôture anormale", fmt.Sprintf("clôture anormale : période comptable %s antérieure de plus de 7 j à la date de dépense %s",
				e.PeriodeComptable, e.DateDepense))
		}

		dropped := false
		for _, is := range iss {
			dropped = dropped || is.drop
		}
		if !dropped && (e.NumFacture != "" || e.NumCommande != "") {
			ligne := ""
			if e.NumLigne != nil {
				ligne = strconv.Itoa(*e.NumLigne)
			}
			key := dupKey{e.NumFacture, e.NumCommande, ligne, e.TG, e.DateDepense}
			if first, ok := seen[key]; ok {
				warn("doublon", fmt.Sprintf("doublon (N° FACTURE, n° COMMANDE, n° LIGNE, TG, DATE DEPENSE) de la ligne %d", first))
			} else {
				seen[key] = rowNum
			}
		}

		// Statut et motifs.
		res.Total++
		switch {
		case dropped:
			e.StatutParsing = domain.ParsingDrop
			res.Drop++
		case len(iss) > 0:
			e.StatutParsing = domain.ParsingWarn
			res.Warn++
		default:
			e.StatutParsing = domain.ParsingOK
			res.OK++
		}
		if len(iss) > 0 {
			texts := make([]string, len(iss))
			for i, is := range iss {
				texts[i] = is.text
				res.MotifsCount[is.key]++
			}
			e.MotifRejet = strings.Join(texts, " ; ")
			if len(res.Issues) < MaxIssues {
				res.Issues = append(res.Issues, domain.ParseIssue{RowNum: rowNum, Statut: e.StatutParsing, Motif: e.MotifRejet})
			}
		}
		if !dropped {
			montant += e.TotalEur
			if res.PeriodeDebut == "" || e.DateDepense < res.PeriodeDebut {
				res.PeriodeDebut = e.DateDepense
			}
			if e.DateDepense > res.PeriodeFin {
				res.PeriodeFin = e.DateDepense
			}
		}
		res.Entries = append(res.Entries, e)
	}
	if res.Total == 0 {
		return nil, &FormatError{CodeFileInvalid, "aucune écriture trouvée sous l'en-tête"}
	}
	res.MontantTotalEur = math.Round(montant*100) / 100
	return res, nil
}

func isBlank(row []string) bool {
	for _, c := range row {
		if xlsxutil.NullDash(c) != "" {
			return false
		}
	}
	return true
}

// isTotalRow detects the "Totaux" line of the demo export.
func isTotalRow(row []string) bool {
	switch xlsxutil.NormHeader(xlsxutil.Cell(row, 0)) {
	case "totaux", "total", "total general":
		return true
	}
	return false
}

// SortedMotifs returns the motif keys by decreasing count (for logs/tests).
func (r *ParseResult) SortedMotifs() []string {
	keys := make([]string, 0, len(r.MotifsCount))
	for k := range r.MotifsCount {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if r.MotifsCount[keys[i]] != r.MotifsCount[keys[j]] {
			return r.MotifsCount[keys[i]] > r.MotifsCount[keys[j]]
		}
		return keys[i] < keys[j]
	})
	return keys
}
