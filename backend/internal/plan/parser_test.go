package plan

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"njord/internal/domain"
)

const demoPath = "../../../test_data_demo/demo_plancharge.xlsx"

func readDemo(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(demoPath)
	if err != nil {
		t.Fatalf("lecture démo : %v", err)
	}
	return data
}

func lineByRow(res *ParseResult, row int) *ParsedLine {
	for i := range res.Lines {
		if res.Lines[i].RowNum == row {
			return &res.Lines[i]
		}
	}
	return nil
}

func TestParseDemo(t *testing.T) {
	res, err := Parse(readDemo(t))
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 36 || res.OK != 31 || res.Warn != 5 || res.Drop != 0 {
		t.Fatalf("compteurs total=%d ok=%d warn=%d drop=%d", res.Total, res.OK, res.Warn, res.Drop)
	}
	if res.Layout != "A" {
		t.Errorf("layout %q", res.Layout)
	}
	if res.PeriodeDebut != "2026-09-01" || res.PeriodeFin != "2026-11-30" {
		t.Errorf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	if res.HeaderRow != 3 || res.SourceFormat != domain.FormatDemo {
		t.Errorf("header row %d format %s", res.HeaderRow, res.SourceFormat)
	}
	// Seuls warns : lignes non nominatives (réserves sans libellé, « PO », « RTE ») ;
	// les pourcentages (60, 10, 200 %) ne sont plus contrôlés et le code Ressource
	// n'est plus contrôlé (ligne 52 : code externe, mais LEROY Nathalie identifiée).
	gotRows := []string{}
	for _, is := range res.Issues {
		if !strings.HasPrefix(is.Motif, "ligne non nominative : nom/prénom non identifiable dans le libellé (") {
			t.Errorf("motif inattendu l. %d : %s", is.RowNum, is.Motif)
		}
		gotRows = append(gotRows, strconv.Itoa(is.RowNum))
	}
	if strings.Join(gotRows, " ") != "50 51 53 54 55" {
		t.Fatalf("issues %+v", res.Issues)
	}
	if l := lineByRow(res, 53); l.MotifRejet != "ligne non nominative : nom/prénom non identifiable dans le libellé (« PO »)" {
		t.Errorf("ligne 53 motif %q", l.MotifRejet)
	}
	// 50 et 51 : même CT, même période, libellé vide → identités distinctes (« R:<ligne> »), pas de doublon.
	for _, row := range []int{50, 51} {
		if l := lineByRow(res, row); l.MotifRejet != "ligne non nominative : nom/prénom non identifiable dans le libellé (libellé vide)" {
			t.Errorf("ligne %d motif %q", row, l.MotifRejet)
		}
	}
	if res.MotifsCount[motifNonNominatif] != 5 || len(res.MotifsCount) != 1 {
		t.Errorf("motifs %v", res.MotifsCount)
	}
	for row, np := range map[int]string{8: "DURAND Claire", 18: "PETIT Karim", 19: "BLANC Sarah", 37: "ROBERT Michel", 38: "DE LA TOUR Antoine", 47: "BONNET Hugo", 52: "LEROY Nathalie", 53: ""} {
		if l := lineByRow(res, row); l == nil || l.NomPrenom != np {
			t.Errorf("ligne %d nom_prenom %+v, attendu %q", row, l, np)
		}
	}
	l23 := lineByRow(res, 23)
	if l23 == nil || l23.Pourcentage != 10 || l23.StatutParsing != domain.ParsingOK || l23.MotifRejet != "" || !strings.Contains(l23.Libelle, "FONTAINE") || !l23.Inactive {
		t.Errorf("ligne 23 %+v", l23)
	}
	alpha := "Squad Alpha — Plateforme"
	core := alpha + " > Alpha Core Team"
	dt := "Direction Technique SC"
	comite := dt + " > Comité d'Architecture"
	want := map[int]string{
		8: core, 9: core, 10: core, 11: alpha, 12: alpha, 13: alpha, 14: alpha,
		17: "Squad Beta — Data & IA", 23: "Squad Beta — Data & IA",
		26: "Squad Gamma — Intégration", 31: "Squad Gamma — Intégration",
		36: comite, 37: comite, 38: comite, 39: dt, 40: dt,
		43: "Cellule Transverse Qualité", 47: "Cellule Transverse Qualité",
		50: "Réserve de Capacité", 55: "Réserve de Capacité",
	}
	for row, g := range want {
		l := lineByRow(res, row)
		if l == nil {
			t.Errorf("ligne %d absente", row)
			continue
		}
		if l.Groupe != g {
			t.Errorf("ligne %d groupe %q, attendu %q", row, l.Groupe, g)
		}
	}
	l8 := lineByRow(res, 8)
	if l8.CT != "Y99F90001" || l8.Ressource != "DURANDC" || l8.ChargeTotale != 219 ||
		l8.PPS != 25093.02 || l8.Pourcentage != 40 || l8.DateDebut != "2026-09-01" || l8.DateFin != "2026-11-30" ||
		l8.TypeAffectation != "Standard" || l8.LigneCout != "MAIN D'OEUVRE SUR SITE" || l8.Unite != "U9AAA1" ||
		l8.CalculDuree != "Dates fixes" || l8.TauxFixe != "OUI" || l8.Pendant != "73j" ||
		l8.QuantiteAffectee == nil || *l8.QuantiteAffectee != 1 || l8.Layout != "A" {
		t.Errorf("ligne 8 %+v", l8.PlanLine)
	}
	if l := lineByRow(res, 50); l.Ressource != "2GI_DEMO_0ZZZ_SiteLoire_TS_TT_" {
		t.Errorf("ligne 50 ressource brute %q", l.Ressource)
	}
	if l := lineByRow(res, 45); l.CT != "Y99F900010" {
		t.Errorf("CT 10 car. %q", l.CT)
	}
	// 30 identités (25 NOM Prénom + « L:PO », « L:RTE », 3 × « R:<ligne> »), FONTAINE Emma inactive.
	if res.PctInactifs != 3.33 {
		t.Errorf("pct inactifs %v", res.PctInactifs)
	}
}

// buildSpecXLSX writes a workbook in spec format (sheet "Plan de charge", header row 1).
func buildSpecXLSX(t *testing.T, sheet string, header []any, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	if sheet != "Sheet1" {
		if _, err := f.NewSheet(sheet); err != nil {
			t.Fatal(err)
		}
		f.DeleteSheet("Sheet1")
	}
	all := append([][]any{header}, rows...)
	for i, r := range all {
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

var specHeader = []any{"Tâche ou sous-projet", "Ressource", "Libellé", "Type d'affectation", "Ligne de coût",
	"Charge totale", ".PPS", "Pourcentage", "Unité", "Calcul de la durée", "Date début", "Date fin"}

// Serials: 46266 = 2026-09-01, 46356 = 2026-11-30, 46418 = 2027-01-31.
func specRows() [][]any {
	return [][]any{
		// 2: layout A ok
		{"CT_A1", "R_001", "DUPONT Jean / Squad Alpha", "Standard", "MAIN D'OEUVRE SUR SITE", 219.0, 25093.02, 40, "U_0001", "Dates fixes", 46266, 46418},
		// 3: layout B ok (pas de Type d'affectation, poubelle 1 en fin)
		{"CT_A1", "R_002", "Squad Beta / MARTIN Léa", "CAPACITE SUR SITE", 100.5, 1000, 50, "U_0002", "Dates fixes", 46266, 46356, 1},
		// 4: [inactif] + pourcentage hors ex-liste SPEC (accepté)
		{"CT_B2", "[inactif] R_003", "Paul Petit", "Standard", "MAIN D'OEUVRE SUR SITE", 50, 0, 10, "U_0001", "Dates fixes", 46266, 46356},
		// 5: CT vide
		{"", "R_004", "X", "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", 46266, 46356},
		// 6: charge négative (layout B)
		{"CT_C3", "R_005", "Y", "MAIN D'OEUVRE SUR SITE", -5, 0, 20, "U_0001", "Dates fixes", 46266, 46356, 1},
		// 7 et 8: doublon
		{"CT_D4", "RES_ext_01", "Ext One", "Standard", "CAPACITE SUR SITE", 70, 700, 100, "U_0003", "Dates fixes", 46266, 46356},
		{"CT_D4", "RES_ext_01", "Ext One", "Standard", "CAPACITE SUR SITE", 30, 300, 100, "U_0003", "Dates fixes", 46266, 46356},
		// 9: layout inconnu
		{"CT_E5", "R_006", "Z", "autre chose", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", 46266, 46356},
		// 10: vide
		{},
		// 11: date fin < date début + ressource vide (n'est plus un rejet) + non nominative — plusieurs motifs
		{"CT_F6", "", "W", "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", 46356, 46266},
		// 12: date fin < date début (warn) ; code ressource quelconque (plus contrôlé)
		{"CT_F6", "r-7", "V", "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", "2026-11-30", "01/09/2026"},
		// 13: date non convertible
		{"CT_F6", "R_008", "U", "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", "bientôt", 46356},
	}
}

func TestParseSpecSynthetic(t *testing.T) {
	data := buildSpecXLSX(t, "Plan de charge", specHeader, specRows())
	res, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if res.HeaderRow != 1 || res.Sheet != "Plan de charge" || res.SourceFormat != domain.FormatSpec {
		t.Errorf("table %s/%d/%s", res.Sheet, res.HeaderRow, res.SourceFormat)
	}
	if res.Layout != "mixte" {
		t.Errorf("layout %q", res.Layout)
	}
	if res.Total != 11 {
		t.Fatalf("total %d", res.Total)
	}
	exp := map[int]struct {
		st    domain.ParsingStatut
		motif string
	}{
		2:  {domain.ParsingOK, ""},
		3:  {domain.ParsingOK, ""},
		4:  {domain.ParsingOK, ""},
		5:  {domain.ParsingDrop, "CT vide ; ligne non nominative : nom/prénom non identifiable dans le libellé (« X »)"},
		6:  {domain.ParsingDrop, "négative"},
		7:  {domain.ParsingWarn, "doublon (CT, nom/prénom, période) avec la ligne 8 : agrégation implicite"},
		8:  {domain.ParsingWarn, "doublon (CT, nom/prénom, période) avec la ligne 7"},
		9:  {domain.ParsingDrop, "layout inconnu"},
		11: {domain.ParsingWarn, "date de fin antérieure à la date de début ; ligne non nominative : nom/prénom non identifiable dans le libellé (« W »)"},
		12: {domain.ParsingWarn, "date de fin antérieure à la date de début ; ligne non nominative"},
		13: {domain.ParsingDrop, "date de début non convertible"},
	}
	for row, e := range exp {
		l := lineByRow(res, row)
		if l == nil {
			t.Errorf("ligne %d absente", row)
			continue
		}
		if l.StatutParsing != e.st || !strings.Contains(l.MotifRejet, e.motif) || (e.motif == "" && l.MotifRejet != "") {
			t.Errorf("ligne %d : %s %q, attendu %s %q", row, l.StatutParsing, l.MotifRejet, e.st, e.motif)
		}
	}
	for row, np := range map[int]string{2: "DUPONT Jean", 3: "MARTIN Léa", 4: "PETIT Paul", 7: "ONE Ext", 11: "", 12: ""} {
		if l := lineByRow(res, row); l.NomPrenom != np {
			t.Errorf("ligne %d nom_prenom %q, attendu %q", row, l.NomPrenom, np)
		}
	}
	if res.OK != 3 || res.Warn != 4 || res.Drop != 4 {
		t.Errorf("ok=%d warn=%d drop=%d", res.OK, res.Warn, res.Drop)
	}
	b := lineByRow(res, 3)
	if b.Layout != "B" || b.TypeAffectation != "" || b.LigneCout != "CAPACITE SUR SITE" || b.ChargeTotale != 100.5 ||
		b.PPS != 1000 || b.Pourcentage != 50 || b.Unite != "U_0002" || b.CalculDuree != "Dates fixes" ||
		b.DateDebut != "2026-09-01" || b.DateFin != "2026-11-30" {
		t.Errorf("layout B mal décalé : %+v", b.PlanLine)
	}
	in := lineByRow(res, 4)
	if !in.Inactive || in.Ressource != "R_003" {
		t.Errorf("inactif %+v", in.PlanLine)
	}
	if l := lineByRow(res, 11); l.Ressource != "" {
		t.Errorf("ligne 11 ressource %q", l.Ressource)
	}
	l12 := lineByRow(res, 12)
	if l12.DateDebut != "2026-11-30" || l12.DateFin != "2026-09-01" {
		t.Errorf("dates texte %s %s", l12.DateDebut, l12.DateFin)
	}
	if res.PeriodeDebut != "2026-09-01" || res.PeriodeFin != "2027-01-31" {
		t.Errorf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	// Identités des lignes acceptées : DUPONT Jean, MARTIN Léa, PETIT Paul (inactif),
	// ONE Ext, « L:W », « L:V » → 1/6.
	if res.PctInactifs != 16.67 {
		t.Errorf("pct inactifs %v", res.PctInactifs)
	}
	if res.MotifsCount[motifDoublon] != 2 {
		t.Errorf("motifs %v", res.MotifsCount)
	}
	for _, l := range res.Lines {
		if l.Groupe != "" {
			t.Errorf("groupe inattendu %q", l.Groupe)
		}
	}
}

func TestParseHeaderInvalid(t *testing.T) {
	bad := append([]any{}, specHeader...)
	bad[5], bad[6] = bad[6], bad[5] // ordre faux
	data := buildSpecXLSX(t, "Plan de charge", bad, specRows())
	_, err := Parse(data)
	var pe *ParseError
	if !errors.As(err, &pe) || pe.Code != "header_invalid" {
		t.Fatalf("attendu header_invalid, obtenu %v", err)
	}
	// Onglet sans en-tête reconnaissable → sheet_not_found.
	data = buildSpecXLSX(t, "Autre", []any{"a", "b", "c"}, [][]any{{1, 2, 3}})
	_, err = Parse(data)
	if !errors.As(err, &pe) || pe.Code != "sheet_not_found" {
		t.Fatalf("attendu sheet_not_found, obtenu %v", err)
	}
	// Fichier illisible.
	_, err = Parse([]byte("pas un xlsx"))
	if !errors.As(err, &pe) || pe.Code != "file_invalid" {
		t.Fatalf("attendu file_invalid, obtenu %v", err)
	}
}

func TestNormalizeRessource(t *testing.T) {
	cases := []struct {
		in, code string
		inactive bool
	}{
		{"DURANDC", "DURANDC", false},
		{"[inactif] R_002", "R_002", true},
		{"[INACTIF]2GI_DEMO_X", "2GI_DEMO_X", true},
		{"  r-7 ", "r-7", false},
		{"[inactif]", "", true},
		{"", "", false},
	}
	for _, c := range cases {
		code, in := NormalizeRessource(c.in)
		if code != c.code || in != c.inactive {
			t.Errorf("%q → %q %v", c.in, code, in)
		}
	}
}

// Rule 6: the duplicate key is (CT, NOM Prénom, période), whatever the code
// Ressource; non-nominative lines are keyed by their libellé.
func TestParseDoublonNomPrenom(t *testing.T) {
	row := func(ct, ress, lib string) []any {
		return []any{ct, ress, lib, "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", 46266, 46356}
	}
	res, err := Parse(buildSpecXLSX(t, "Plan de charge", specHeader, [][]any{
		row("CT1", "A1", "DURAND Claire"),         // 2 ┐ même personne, codes différents
		row("CT1", "B2", "Claire DURAND / Squad"), // 3 ┘
		row("CT1", "A1", "MARTIN Léa"),            // 4 même code, autre personne : pas doublon
		row("CT1", "X", "PO"),                     // 5 ┐ non nominatives, même libellé
		row("CT1", "Y", "PO"),                     // 6 ┘
		row("CT1", "X", "RTE"),                    // 7 autre libellé : pas doublon
		row("CT2", "A1", "DURAND Claire"),         // 8 autre CT : pas doublon
	}))
	if err != nil {
		t.Fatal(err)
	}
	for row, dup := range map[int]bool{2: true, 3: true, 4: false, 5: true, 6: true, 7: false, 8: false} {
		if got := strings.Contains(lineByRow(res, row).MotifRejet, "doublon"); got != dup {
			t.Errorf("ligne %d doublon=%v : %q", row, got, lineByRow(res, row).MotifRejet)
		}
	}
	if l := lineByRow(res, 4); l.StatutParsing != domain.ParsingOK {
		t.Errorf("ligne 4 %s %q", l.StatutParsing, l.MotifRejet)
	}
}
