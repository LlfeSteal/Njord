package enveloppe

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// buildXLSX writes a workbook: rows are written from row 1 (banner included).
func buildXLSX(t *testing.T, sheet string, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		t.Fatal(err)
	}
	for i, r := range rows {
		if len(r) == 0 {
			continue
		}
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow(sheet, cell, &r); err != nil {
			t.Fatal(err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

var header = []any{"Nom", "Descriptif", "Calendrier", "Date de début Contrôles de mouvement",
	"Date de fin Contrôles de mouvement", "Prévision pour solde", "Coût encouru", "Coût prévisionnel", "Bloc note"}

// withBanner: lignes 1-2 de l'export (métadonnées), en-tête ligne 3.
func withBanner(rows ...[]any) [][]any {
	return append([][]any{{"12/10/26", "", "", "Tableau", "", "", "Utilisateur test"}, {}, header}, rows...)
}

// categ: ligne de catégorie (code …00, sans date) ; les colonnes F-H portent les sommes.
func categ(code, lib string) []any { return []any{code, lib, "", nil, nil, 10, 20, 30} }

// row: ligne de CT ; nil → cellule vide. Prévision pour solde et coût encouru
// sont remplis de valeurs parasites (non lues).
func row(ct, lib string, debut, fin, montant any) []any {
	return []any{ct, lib, "", debut, fin, 123.4, 567.8, montant, "note"}
}

// Serials : 46023 = 2026-01-01, 46387 = 2026-12-31, 46400 = 2027-01-13.
func sampleRows() [][]any {
	return withBanner(
		row("Y00A00001", "Orphelin", 46023, 46387, 1000),          // 4 : hors catégorie (warn)
		categ("Y00A10000", "  Catégorie   A "),                    // 5
		row("Y00A10001", "Alpha", 46023, 46387, 1500.5),           // 6 : ok
		row("Y00A10002", "Beta (A NE PAS UTILISER)", nil, nil, 0), // 7 : période manquante
		row("Y00A10003", "Gamma", "2026-03-01", "01/02/2026", 10), // 8 : fin avant début
		row("Y00A10004", "Delta", 46023, nil, 10),                 // 9 : période manquante
		row("Y00A10005", "Epsilon", 46023, 46387, -5),             // 10 : montant négatif
		row("Y00A10006", "Zeta", 46023, 46387, "abc"),             // 11 : montant illisible
		row("Y00A10007", "Eta", 46023, 46387, nil),                // 12 : montant absent
		[]any{"", "ligne sans code", "", 46023, 46387, 0, 0, 5},   // 13 : ignorée
		[]any{},                           // 14 : vide
		categ("Y00B20000", "Catégorie B"), // 15
		row("Y00A10001", "Alpha bis", 46023, 46387, 99),                              // 16 : CT en double
		row("Y00B20001", "Theta (à ne pas utiliser)", "2026-02-01", "2026-06-30", 0), // 17 : ok, montant nul
		row("Y00B20002", "Iota", "xx", 46387, 5),                                     // 18 : date invalide
		row("Y00B20100", "Kappa", 46023, 46400, 200),                                 // 19 : code …00 daté = enveloppe
		row("Y00A10005", "Epsilon corrigé", 46023, 46387, 7),                         // 20 : le 1er Y00A10005 a été rejeté
	)
}

func TestParseSample(t *testing.T) {
	res, err := Parse(buildXLSX(t, "Activité sans archive", sampleRows()))
	if err != nil {
		t.Fatal(err)
	}
	if res.Sheet != "Activité sans archive" || res.HeaderRow != 3 || res.SourceFormat != SourceFormat {
		t.Fatalf("table: %q ligne %d format %q", res.Sheet, res.HeaderRow, res.SourceFormat)
	}
	if res.Total != 13 || res.OK != 4 || res.Warn != 1 || res.Drop != 8 {
		t.Fatalf("comptes: total %d ok %d warn %d drop %d", res.Total, res.OK, res.Warn, res.Drop)
	}
	if res.PeriodeDebut != "2026-01-01" || res.PeriodeFin != "2027-01-13" || res.MontantTotalEur != 2707.5 {
		t.Fatalf("période %s → %s, montant %v", res.PeriodeDebut, res.PeriodeFin, res.MontantTotalEur)
	}
	wantMotifs := map[string]int{motifPeriode: 2, motifFinDebut: 1, motifMontant: 3, motifDoublon: 1, motifDate: 1, motifHorsCateg: 1}
	if fmt.Sprint(res.MotifsCount) != fmt.Sprint(wantMotifs) {
		t.Fatalf("motifs: %v", res.MotifsCount)
	}
	if len(res.Categories) != 2 || res.Categories[0] != (Categorie{5, "Y00A10000", "Catégorie A"}) || res.Categories[1].Code != "Y00B20000" {
		t.Fatalf("catégories: %+v", res.Categories)
	}

	type want struct {
		row               int
		categ, debut, fin string
		montant           float64
	}
	exp := map[string]want{
		"Y00A00001": {4, "", "2026-01-01", "2026-12-31", 1000},
		"Y00A10001": {6, "Y00A10000", "2026-01-01", "2026-12-31", 1500.5},
		"Y00B20001": {17, "Y00B20000", "2026-02-01", "2026-06-30", 0},
		"Y00B20100": {19, "Y00B20000", "2026-01-01", "2027-01-13", 200},
		"Y00A10005": {20, "Y00B20000", "2026-01-01", "2026-12-31", 7},
	}
	if len(res.Enveloppes) != len(exp) {
		t.Fatalf("enveloppes: %+v", res.Enveloppes)
	}
	for _, l := range res.Enveloppes {
		w, ok := exp[l.CT]
		if !ok || l.RowNum != w.row || l.Categorie != w.categ || l.DateDebut != w.debut || l.DateFin != w.fin || l.Montant != w.montant {
			t.Errorf("%s: %+v, attendu %+v", l.CT, l, w)
		}
	}
	if l := res.Enveloppes[1]; l.CategorieLibelle != "Catégorie A" || l.Descriptif != "Alpha" {
		t.Errorf("libellés: %+v", l)
	}

	motifs := map[int]string{}
	for _, is := range res.Issues {
		motifs[is.RowNum] = string(is.Statut) + " " + is.Motif
	}
	for rowNum, prefix := range map[int]string{
		4: "warn Hors catégorie", 7: "drop Période manquante", 8: "drop Fin avant début", 9: "drop Période manquante",
		10: "drop Montant invalide", 11: "drop Montant invalide", 12: "drop Montant invalide",
		16: "drop CT en double (déjà importé ligne 6)", 18: "drop Date invalide",
	} {
		if !strings.HasPrefix(motifs[rowNum], prefix) {
			t.Errorf("ligne %d: %q, attendu %q…", rowNum, motifs[rowNum], prefix)
		}
	}
	if len(res.Issues) != 9 {
		t.Errorf("issues: %+v", res.Issues)
	}
}

func TestParseColumnsInAnyOrder(t *testing.T) {
	data := buildXLSX(t, "Feuil1", [][]any{
		{"Coût prévisionnel", "Bloc note", "Date de fin Contrôles de mouvement", "nom", "DATE DE DÉBUT CONTRÔLES DE MOUVEMENT", "Descriptif"},
		{"", "", "", "Z9900", "", "Catégorie Z"},
		{"1 234,5", "x", "31/12/2026", "Z9901", "2026-01-01", "Un"},
	})
	res, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if res.Sheet != "Feuil1" || res.HeaderRow != 1 || res.Total != 1 || res.OK != 1 || len(res.Categories) != 1 {
		t.Fatalf("résultat: %+v", res)
	}
	l := res.Enveloppes[0]
	if l.CT != "Z9901" || l.Categorie != "Z9900" || l.CategorieLibelle != "Catégorie Z" || l.Montant != 1234.5 ||
		l.DateDebut != "2026-01-01" || l.DateFin != "2026-12-31" {
		t.Fatalf("enveloppe: %+v", l)
	}
}

func TestParseIssuesCapped(t *testing.T) {
	rows := withBanner(categ("C00", "Catégorie"))
	for i := 0; i < MaxIssues+20; i++ {
		rows = append(rows, row(fmt.Sprintf("CT%04dA", i), "", nil, nil, 0))
	}
	res, err := Parse(buildXLSX(t, "Activité sans archive", rows))
	if err != nil {
		t.Fatal(err)
	}
	if res.Drop != MaxIssues+20 || len(res.Issues) != MaxIssues || res.MotifsCount[motifPeriode] != MaxIssues+20 || res.PeriodeDebut != "" {
		t.Fatalf("drop %d, issues %d, motifs %v", res.Drop, len(res.Issues), res.MotifsCount)
	}
}

func TestParseErrors(t *testing.T) {
	code := func(data []byte) (string, string) {
		_, err := Parse(data)
		var pe *ParseError
		if !errors.As(err, &pe) {
			t.Fatalf("ParseError attendu: %v", err)
		}
		return pe.Code, pe.Msg
	}
	// En-tête sans Coût prévisionnel : header_invalid, colonne manquante citée.
	noMontant := withBanner(row("A1", "x", 46023, 46387, 1))
	noMontant[2] = []any{"Nom", "Descriptif", "Calendrier", "Date de début Contrôles de mouvement", "Date de fin Contrôles de mouvement", "Coût encouru"}
	if c, msg := code(buildXLSX(t, "Activité sans archive", noMontant)); c != CodeHeaderInvalid || !strings.Contains(msg, "colonnes manquantes : Coût prévisionnel ;") {
		t.Errorf("sans montant: %s %s", c, msg)
	}
	// Onglet attendu sans en-tête reconnaissable.
	if c, _ := code(buildXLSX(t, "Activité sans archive", [][]any{{"a", "b"}, {1, 2}})); c != CodeHeaderInvalid {
		t.Errorf("onglet sans en-tête: %s", c)
	}
	// Aucun onglet ni en-tête.
	if c, _ := code(buildXLSX(t, "Autre", [][]any{{"a", "b"}, {1, 2}})); c != CodeSheetNotFound {
		t.Errorf("autre fichier: %s", c)
	}
	if c, _ := code([]byte("pas un xlsx")); c != CodeFileInvalid {
		t.Errorf("fichier illisible: %s", c)
	}
}

// TestParseDemoFile lit le fichier de démo réel s'il est présent (jamais copié en fixture).
func TestParseDemoFile(t *testing.T) {
	data, err := os.ReadFile("../../../test_data_demo/CàT par CT OCTOBRE V3.0_DEMO.xlsx")
	if err != nil {
		t.Skip("fichier de démo absent")
	}
	res, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("onglet %q ligne %d : total %d ok %d warn %d drop %d, motifs %v, %s → %s, %.2f €",
		res.Sheet, res.HeaderRow, res.Total, res.OK, res.Warn, res.Drop, res.MotifsCount, res.PeriodeDebut, res.PeriodeFin, res.MontantTotalEur)
	if res.Sheet != "Activité sans archive" || res.HeaderRow != 3 || len(res.Categories) != 7 {
		t.Fatalf("onglet %q ligne %d, %d catégories", res.Sheet, res.HeaderRow, len(res.Categories))
	}
	categs := map[string]bool{}
	for _, c := range res.Categories {
		categs[c.Code] = true
	}
	used := map[string]bool{}
	var pirogue *Ligne
	for i, l := range res.Enveloppes {
		if categs[l.CT] {
			t.Errorf("ligne de catégorie importée comme enveloppe: %+v", l)
		}
		if l.Categorie == "" {
			t.Errorf("enveloppe hors catégorie: %+v", l)
		}
		used[l.Categorie] = true
		if l.CT == "Y99F71110" {
			pirogue = &res.Enveloppes[i]
		}
	}
	if len(used) != 7 {
		t.Errorf("catégories appliquées: %v", used)
	}
	if pirogue == nil || pirogue.Montant != 517065.246 || pirogue.DateDebut != "2026-01-01" || pirogue.DateFin != "2026-12-28" ||
		pirogue.Categorie != "Y99F71100" || pirogue.CategorieLibelle != "Bram" {
		t.Fatalf("Pirogue: %+v", pirogue)
	}
	if res.Warn != 0 || res.OK+res.Drop != res.Total || res.Drop != res.MotifsCount[motifPeriode] {
		t.Errorf("comptes: %+v", res.MotifsCount)
	}
}
