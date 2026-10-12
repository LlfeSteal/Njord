package enveloppe

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
	CodeNoEnveloppe   = "no_valid_rows" // import refusé : aucune enveloppe valide
)

// ParseError is a blocking import error (nothing is written).
type ParseError struct {
	Code string
	Msg  string
}

func (e *ParseError) Error() string { return e.Msg }

// MaxIssues bounds ParseResult.Issues (the report detail).
const MaxIssues = 500

// SourceFormat of the « CàT par CT » export (ImportReport.SourceFormat).
const SourceFormat = "cat_par_ct"

// sheetName: onglet examiné en premier (puis tous les autres).
const sheetName = "Activité sans archive"

// Ligne : une enveloppe acceptée (ok ou warn) du fichier.
type Ligne struct {
	RowNum           int
	CT               string
	Descriptif       string
	Categorie        string // code de la ligne de catégorie au-dessus, '' si aucune
	CategorieLibelle string
	domain.Enveloppe
}

// Categorie : une ligne de catégorie (code …00 sans date).
type Categorie struct {
	RowNum  int
	Code    string
	Libelle string
}

// ParseResult is the outcome of Parse. Enveloppes holds the accepted lines
// only (ok + warn), in file order: les lignes rejetées ne sont pas stockées.
type ParseResult struct {
	Sheet           string
	HeaderRow       int // 1-based
	SourceFormat    string
	Enveloppes      []Ligne
	Categories      []Categorie
	Total           int // lignes de données (hors lignes vides et catégories)
	OK, Warn, Drop  int
	PeriodeDebut    string              // plus petite date de début acceptée
	PeriodeFin      string              // plus grande date de fin acceptée
	MontantTotalEur float64             // Σ montants acceptés
	Issues          []domain.ParseIssue // tronqué à MaxIssues
	MotifsCount     map[string]int      // motif → nb de lignes
}

// column describes one header of the export: a field key, its accepted
// normalized labels (xlsxutil.NormHeader) and its display label.
type column struct {
	field    string
	names    []string
	label    string
	required bool
}

// columns lues de l'export ; les autres (Calendrier, Prévision pour solde,
// Coût encouru, Bloc note) sont ignorées. Repérage par nom, pas par position.
var columns = []column{
	{"ct", []string{"nom"}, "Nom", true},
	{"descriptif", []string{"descriptif"}, "Descriptif", false},
	{"date_debut", []string{"date de debut controles de mouvement", "date de debut"}, "Date de début Contrôles de mouvement", true},
	{"date_fin", []string{"date de fin controles de mouvement", "date de fin"}, "Date de fin Contrôles de mouvement", true},
	{"montant", []string{"cout previsionnel"}, "Coût prévisionnel", true},
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

// Motifs (DECISIONS n° 18), clés de MotifsCount.
const (
	motifPeriode   = "Période manquante"
	motifDate      = "Date invalide"
	motifFinDebut  = "Fin avant début"
	motifMontant   = "Montant invalide"
	motifDoublon   = "CT en double"
	motifHorsCateg = "Hors catégorie"
)

// issue is one parsing problem of a line: cat = motif (counted in
// MotifsCount), text = readable detail.
type issue struct {
	drop bool
	cat  string
	text string
}

// Parse reads a « CàT par CT » workbook. It is pure: no database access.
// Blocking errors are *ParseError.
func Parse(data []byte) (*ParseResult, error) {
	t, err := xlsxutil.FindTable(data, []string{sheetName}, 20, headerMatches)
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

	res := &ParseResult{
		Sheet:        t.Sheet,
		HeaderRow:    t.HeaderRow,
		SourceFormat: SourceFormat,
		Enveloppes:   []Ligne{},
		Categories:   []Categorie{},
		Issues:       []domain.ParseIssue{},
		MotifsCount:  map[string]int{},
	}
	var categ Categorie      // catégorie courante (Code '' avant la première)
	seen := map[string]int{} // CT accepté → ligne
	var montant float64

	for k, row := range t.Rows {
		rowNum := t.RowNums[k]
		ct := get(row, "ct")
		if ct == "" {
			continue // ligne vide ou sans CT : ignorée, non comptée
		}
		descriptif := strings.Join(strings.Fields(get(row, "descriptif")), " ")
		sDebut, sFin := get(row, "date_debut"), get(row, "date_fin")
		if strings.HasSuffix(ct, "00") && sDebut == "" && sFin == "" {
			// Ligne de catégorie : appliquée aux lignes suivantes.
			res.Categories = append(res.Categories, Categorie{RowNum: rowNum, Code: ct, Libelle: descriptif})
			categ = res.Categories[len(res.Categories)-1]
			continue
		}

		l := Ligne{RowNum: rowNum, CT: ct, Descriptif: descriptif, Categorie: categ.Code, CategorieLibelle: categ.Libelle}
		var iss []issue
		drop := func(cat, text string) { iss = append(iss, issue{true, cat, text}) }

		// Période : les deux dates sont obligatoires.
		switch {
		case sDebut == "" && sFin == "":
			drop(motifPeriode, "Période manquante (dates de début et de fin vides)")
		case sDebut == "":
			drop(motifPeriode, "Période manquante (date de début vide)")
		case sFin == "":
			drop(motifPeriode, "Période manquante (date de fin vide)")
		default:
			d1, err1 := xlsxutil.ParseDate(sDebut)
			d2, err2 := xlsxutil.ParseDate(sFin)
			switch {
			case err1 != nil:
				drop(motifDate, fmt.Sprintf("Date invalide (début « %s »)", sDebut))
			case err2 != nil:
				drop(motifDate, fmt.Sprintf("Date invalide (fin « %s »)", sFin))
			case d2 < d1:
				drop(motifFinDebut, fmt.Sprintf("Fin avant début (%s < %s)", d2, d1))
			default:
				l.DateDebut, l.DateFin = d1, d2
			}
		}
		// Montant : Coût prévisionnel ≥ 0 (0 accepté).
		sMontant := get(row, "montant")
		if v, err := xlsxutil.ParseNumber(sMontant); err != nil {
			drop(motifMontant, fmt.Sprintf("Montant invalide (« %s »)", sMontant))
		} else if v < 0 {
			drop(motifMontant, fmt.Sprintf("Montant invalide (%s € négatif)", formatNum(v)))
		} else {
			l.Montant = v
		}
		if len(iss) == 0 {
			if prev, ok := seen[ct]; ok {
				drop(motifDoublon, fmt.Sprintf("CT en double (déjà importé ligne %d)", prev))
			}
		}
		dropped := len(iss) > 0
		if !dropped && l.Categorie == "" {
			iss = append(iss, issue{false, motifHorsCateg, "Hors catégorie (aucune ligne de catégorie au-dessus)"})
		}

		// Statut et motifs.
		res.Total++
		statut := domain.ParsingOK
		switch {
		case dropped:
			statut = domain.ParsingDrop
			res.Drop++
		case len(iss) > 0:
			statut = domain.ParsingWarn
			res.Warn++
		default:
			res.OK++
		}
		if len(iss) > 0 {
			texts := make([]string, len(iss))
			for i, is := range iss {
				texts[i] = is.text
				res.MotifsCount[is.cat]++
			}
			if len(res.Issues) < MaxIssues {
				res.Issues = append(res.Issues, domain.ParseIssue{RowNum: rowNum, Statut: statut, Motif: strings.Join(texts, " ; ")})
			}
		}
		if dropped {
			continue
		}
		seen[ct] = rowNum
		montant += l.Montant
		if res.PeriodeDebut == "" || l.DateDebut < res.PeriodeDebut {
			res.PeriodeDebut = l.DateDebut
		}
		if l.DateFin > res.PeriodeFin {
			res.PeriodeFin = l.DateFin
		}
		res.Enveloppes = append(res.Enveloppes, l)
	}
	res.MontantTotalEur = math.Round(montant*100) / 100
	return res, nil
}

func diagnoseHeader(data []byte) error {
	hasSheet := false
	if f, err := excelize.OpenReader(bytes.NewReader(data)); err == nil {
		for _, s := range f.GetSheetList() {
			if strings.EqualFold(strings.TrimSpace(s), sheetName) {
				hasSheet = true
			}
		}
		f.Close()
	}
	// En-tête approchant (≥ 2 colonnes connues) → header_invalid avec les colonnes manquantes.
	best := 0
	var bestRow []string
	_, _ = xlsxutil.FindTable(data, []string{sheetName}, 20, func(r []string) bool {
		if n := countKnown(r); n > best {
			best, bestRow = n, append([]string(nil), r...)
		}
		return false
	})
	if best >= 2 {
		var miss []string
		for _, c := range columns {
			if c.required && xlsxutil.IndexOf(bestRow, c.names...) < 0 {
				miss = append(miss, c.label)
			}
		}
		return &ParseError{CodeHeaderInvalid, fmt.Sprintf(
			"en-tête non conforme : ce fichier n'est pas un export « CàT par CT » (colonnes manquantes : %s ; obligatoires : %s) ; aucune enveloppe importée",
			strings.Join(miss, ", "), strings.Join(requiredLabels(), ", "))}
	}
	if hasSheet {
		return &ParseError{CodeHeaderInvalid,
			"en-tête non conforme : aucune ligne d'en-tête reconnue dans les 20 premières lignes de l'onglet « " + sheetName + " » (colonnes obligatoires : " +
				strings.Join(requiredLabels(), ", ") + ")"}
	}
	return &ParseError{CodeSheetNotFound, "onglet des enveloppes introuvable (aucun onglet ne contient l'en-tête « CàT par CT » attendu)"}
}

func formatNum(v float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", v), "0"), ".")
}
