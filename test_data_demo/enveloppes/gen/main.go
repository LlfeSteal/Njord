// gen écrit le classeur de démo des enveloppes par CT (demo_cat.xlsx) au format
// de l'export « CàT par CT » (DECISIONS n° 18), à partir de demo_enveloppes.csv :
//
//	categorie;categorie_libelle;ct;libelle;date_debut;date_fin;montant
//
// Mise en page copiée de l'export réel (sans aucune de ses données) : feuille
// « Activité sans archive », bandeau en ligne 1 (date d'extraction en TEXTE
// jj/mm/aa, « Tableau », « Utilisateur <login> », fusionnés A1:C1, D1:F1, G1:I1),
// ligne 2 vide, en-tête en ligne 3, puis par catégorie une ligne en gras (code en
// …00, sans dates, F/G/H = Σ des enfants) suivie de ses CT (niveau de plan 1,
// dates en numéros de série avec un format date, F = H − G, G = 0). Un CT sans
// dates dans le CSV est écrit sans dates et à 0 (ligne « A NE PAS UTILISER »).
//
// Lancement, depuis backend/ (module Go qui fournit excelize) :
//
//	cd backend && go run ../test_data_demo/enveloppes/gen/main.go
//
// Options : -csv et -out (défaut : à côté de ce fichier source, dossier parent).
package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

const (
	sheet      = "Activité sans archive"
	exportDate = "12/10/26" // A1 : date d'extraction, en texte comme dans l'export réel
	user       = "Utilisateur ext-demo.test"
)

var header = []any{
	"Nom", "Descriptif", "Calendrier",
	"Date de début Contrôles de mouvement", "Date de fin Contrôles de mouvement",
	"Prévision pour solde", "Coût encouru", "Coût prévisionnel", "Bloc note",
}

type child struct {
	ct, libelle string
	debut, fin  time.Time // zéro = sans date
	montant     float64
	sansPeriode bool
}

type categorie struct {
	code, libelle string
	enfants       []child
}

func (c categorie) total() float64 {
	s := 0.0
	for _, e := range c.enfants {
		s += e.montant
	}
	return s
}

var epoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

func serial(t time.Time) int { return int(t.Sub(epoch).Hours() / 24) }

func readCSV(path string) ([]categorie, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.Comma = ';'
	recs, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(recs) < 2 {
		return nil, fmt.Errorf("%s : aucune ligne", path)
	}
	col := map[string]int{}
	for i, h := range recs[0] {
		col[strings.TrimPrefix(strings.TrimSpace(h), "\ufeff")] = i
	}
	for _, k := range []string{"categorie", "categorie_libelle", "ct", "libelle", "date_debut", "date_fin", "montant"} {
		if _, ok := col[k]; !ok {
			return nil, fmt.Errorf("%s : colonne %q absente", path, k)
		}
	}
	var cats []categorie
	idx := map[string]int{}
	for n, rec := range recs[1:] {
		get := func(k string) string { return strings.TrimSpace(rec[col[k]]) }
		line := n + 2
		code := get("categorie")
		if !strings.HasSuffix(code, "00") {
			return nil, fmt.Errorf("%s:%d : catégorie %q ne finit pas par 00", path, line, code)
		}
		m, err := strconv.ParseFloat(strings.ReplaceAll(get("montant"), ",", "."), 64)
		if err != nil {
			return nil, fmt.Errorf("%s:%d : montant invalide", path, line)
		}
		c := child{ct: get("ct"), libelle: get("libelle"), montant: m}
		if get("date_debut") == "" || get("date_fin") == "" {
			c.sansPeriode = true
		} else {
			if c.debut, err = time.Parse("2006-01-02", get("date_debut")); err != nil {
				return nil, fmt.Errorf("%s:%d : date_debut : %v", path, line, err)
			}
			if c.fin, err = time.Parse("2006-01-02", get("date_fin")); err != nil {
				return nil, fmt.Errorf("%s:%d : date_fin : %v", path, line, err)
			}
		}
		i, ok := idx[code]
		if !ok {
			i = len(cats)
			idx[code] = i
			cats = append(cats, categorie{code: code, libelle: get("categorie_libelle")})
		}
		cats[i].enfants = append(cats[i].enfants, c)
	}
	return cats, nil
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "gen :", err)
		os.Exit(1)
	}
}

func main() {
	_, src, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filepath.Dir(src)) // test_data_demo/enveloppes
	csvPath := flag.String("csv", filepath.Join(dir, "demo_enveloppes.csv"), "CSV source")
	out := flag.String("out", filepath.Join(dir, "demo_cat.xlsx"), "classeur écrit")
	flag.Parse()

	cats, err := readCSV(*csvPath)
	must(err)

	f := excelize.NewFile()
	defer f.Close()
	must(f.SetSheetName("Sheet1", sheet))

	fmtDate := "dd/mm/y;;"
	fmtMoney := `#,##0 "€";- #,##0 "€";`
	border := []excelize.Border{
		{Type: "left", Color: "000000"}, {Type: "right", Color: "000000"},
		{Type: "top", Color: "000000"}, {Type: "bottom", Color: "000000"},
	}
	thin := []excelize.Border{
		{Type: "left", Color: "000000", Style: 1}, {Type: "right", Color: "000000", Style: 1},
		{Type: "top", Color: "000000", Style: 1}, {Type: "bottom", Color: "000000", Style: 1},
	}
	align := &excelize.Alignment{Vertical: "center", WrapText: true}
	fill := func(c string) excelize.Fill { return excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{c}} }
	catFont := &excelize.Font{Bold: true, Size: 9, Family: "Arial", Color: "645130"}
	rowFont := &excelize.Font{Size: 8, Family: "Tahoma", Color: "000000"}
	style := func(s *excelize.Style) int {
		id, err := f.NewStyle(s)
		must(err)
		return id
	}
	sMeta := style(&excelize.Style{Font: &excelize.Font{Size: 11, Family: "Calibri"}})
	sHead := style(&excelize.Style{Font: &excelize.Font{Size: 8, Family: "Tahoma"}, Fill: fill("F0F0F0"), Border: thin})
	sCat := style(&excelize.Style{Font: catFont, Fill: fill("DBDBDB"), Border: border, Alignment: align})
	sCatDate := style(&excelize.Style{Font: catFont, Fill: fill("DBDBDB"), Border: border, Alignment: align, CustomNumFmt: &fmtDate})
	sCatMoney := style(&excelize.Style{Font: catFont, Fill: fill("DBDBDB"), Border: border, Alignment: align, CustomNumFmt: &fmtMoney})
	sRow := style(&excelize.Style{Font: rowFont, Fill: fill("FFFFFF"), Border: border, Alignment: align})
	sCode := style(&excelize.Style{Font: rowFont, Fill: fill("F5F5F5"), Border: border, Alignment: align})
	sDate := style(&excelize.Style{Font: rowFont, Fill: fill("F5F5F5"), Border: border, Alignment: align, CustomNumFmt: &fmtDate})
	sMoney := style(&excelize.Style{Font: rowFont, Fill: fill("F5F5F5"), Border: border, Alignment: align, CustomNumFmt: &fmtMoney})

	cell := func(c, r int) string {
		name, _ := excelize.CoordinatesToCellName(c, r)
		return name
	}
	set := func(r int, vals []any) { must(f.SetSheetRow(sheet, cell(1, r), &vals)) }

	// Bandeau (ligne 1), ligne 2 vide, en-tête (ligne 3).
	set(1, []any{exportDate, "", "", "Tableau", "", "", user, "", ""})
	must(f.SetCellStyle(sheet, "A1", "I1", sMeta))
	for _, m := range [][2]string{{"A1", "C1"}, {"D1", "F1"}, {"G1", "I1"}} {
		must(f.MergeCell(sheet, m[0], m[1]))
	}
	set(3, header)
	must(f.SetCellStyle(sheet, "A3", "I3", sHead))

	r := 4
	for _, c := range cats {
		t := c.total()
		set(r, []any{c.code, c.libelle, "", nil, nil, t, 0, t, ""})
		must(f.SetCellStyle(sheet, cell(1, r), cell(9, r), sCat))
		must(f.SetCellStyle(sheet, cell(4, r), cell(5, r), sCatDate))
		must(f.SetCellStyle(sheet, cell(6, r), cell(8, r), sCatMoney))
		must(f.SetRowHeight(sheet, r, 18))
		r++
		for _, e := range c.enfants {
			var d, fin any
			if !e.sansPeriode {
				d, fin = serial(e.debut), serial(e.fin)
			}
			set(r, []any{e.ct, e.libelle, "", d, fin, e.montant, 0, e.montant, ""})
			must(f.SetCellStyle(sheet, cell(1, r), cell(9, r), sRow))
			if !e.sansPeriode {
				must(f.SetCellStyle(sheet, cell(1, r), cell(1, r), sCode))
			}
			must(f.SetCellStyle(sheet, cell(4, r), cell(5, r), sDate))
			must(f.SetCellStyle(sheet, cell(6, r), cell(8, r), sMoney))
			must(f.SetRowOutlineLevel(sheet, r, 1))
			must(f.SetRowHeight(sheet, r, 18))
			r++
		}
	}

	must(f.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 3, TopLeftCell: "A4", ActivePane: "bottomLeft"}))
	for col, w := range map[string]float64{"A": 16, "B": 44, "C": 13, "D": 34, "E": 32, "F": 20, "G": 16, "H": 18, "I": 30} {
		must(f.SetColWidth(sheet, col, col, w))
	}
	must(f.SaveAs(*out))
	n := 0
	for _, c := range cats {
		n += len(c.enfants)
	}
	fmt.Printf("%s : %d catégories, %d CT\n", *out, len(cats), n)
}
