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
	if res.Total != 36 || res.OK != 30 || res.Warn != 6 || res.Drop != 0 {
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
	// Seuls warns : nom/prénom non identifiable (réserves sans libellé, « PO », « RTE ») ;
	// les pourcentages (60, 10, 200 %) ne sont plus contrôlés.
	gotRows := []string{}
	for _, is := range res.Issues {
		if !strings.Contains(is.Motif, "nom/prénom non identifiable") {
			t.Errorf("motif inattendu l. %d : %s", is.RowNum, is.Motif)
		}
		gotRows = append(gotRows, strconv.Itoa(is.RowNum))
	}
	if strings.Join(gotRows, " ") != "50 51 52 53 54 55" {
		t.Fatalf("issues %+v", res.Issues)
	}
	for row, np := range map[int]string{8: "DURAND Claire", 18: "PETIT Karim", 19: "BLANC Sarah", 37: "ROBERT Michel", 38: "DE LA TOUR Antoine", 47: "BONNET Hugo", 53: ""} {
		if l := lineByRow(res, row); l == nil || l.NomPrenom != np {
			t.Errorf("ligne %d nom_prenom %+v, attendu %q", row, l, np)
		}
	}
	l23 := lineByRow(res, 23)
	if l23 == nil || l23.Pourcentage != 10 || l23.StatutParsing != domain.ParsingOK || l23.MotifRejet != "" || !strings.Contains(l23.Libelle, "FONTAINE") {
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
	if l8.CT != "Y99F90001" || l8.Ressource != "DURANDC" || l8.RessourceKind != "internal" || l8.ChargeTotale != 219 ||
		l8.PPS != 25093.02 || l8.Pourcentage != 40 || l8.DateDebut != "2026-09-01" || l8.DateFin != "2026-11-30" ||
		l8.TypeAffectation != "Standard" || l8.LigneCout != "MAIN D'OEUVRE SUR SITE" || l8.Unite != "U9AAA1" ||
		l8.CalculDuree != "Dates fixes" || l8.TauxFixe != "OUI" || l8.Pendant != "73j" ||
		l8.QuantiteAffectee == nil || *l8.QuantiteAffectee != 1 || l8.Layout != "A" {
		t.Errorf("ligne 8 %+v", l8.PlanLine)
	}
	if l := lineByRow(res, 50); l.RessourceKind != "external" {
		t.Errorf("ligne 50 kind %s", l.RessourceKind)
	}
	if l := lineByRow(res, 45); l.CT != "Y99F900010" {
		t.Errorf("CT 10 car. %q", l.CT)
	}
	if res.PctInactifs != 0 {
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
		// 11: date fin < date début + ressource vide (drop) — plusieurs motifs
		{"CT_F6", "", "W", "Standard", "MAIN D'OEUVRE SUR SITE", 10, 0, 20, "U_0001", "Dates fixes", 46356, 46266},
		// 12: date fin < date début (warn) + ressource de format inconnu
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
		2:  {domain.ParsingWarn, "ressource « R_001 » ≠ NOM + initiale du prénom (attendu « DUPONTJ »)"},
		3:  {domain.ParsingWarn, "attendu « MARTINL »"},
		4:  {domain.ParsingWarn, "attendu « PETITP »"},
		5:  {domain.ParsingDrop, "CT vide"},
		6:  {domain.ParsingDrop, "négative"},
		7:  {domain.ParsingWarn, "doublon"},
		8:  {domain.ParsingWarn, "doublon"},
		9:  {domain.ParsingDrop, "layout inconnu"},
		11: {domain.ParsingDrop, "ressource vide ; date de fin antérieure"},
		12: {domain.ParsingWarn, "date de fin antérieure à la date de début ; ressource de format inconnu"},
		13: {domain.ParsingDrop, "date de début non convertible"},
	}
	for row, e := range exp {
		l := lineByRow(res, row)
		if l == nil {
			t.Errorf("ligne %d absente", row)
			continue
		}
		if l.StatutParsing != e.st || !strings.Contains(l.MotifRejet, e.motif) {
			t.Errorf("ligne %d : %s %q, attendu %s %q", row, l.StatutParsing, l.MotifRejet, e.st, e.motif)
		}
	}
	if res.OK != 0 || res.Warn != 6 || res.Drop != 5 {
		t.Errorf("ok=%d warn=%d drop=%d", res.OK, res.Warn, res.Drop)
	}
	b := lineByRow(res, 3)
	if b.Layout != "B" || b.TypeAffectation != "" || b.LigneCout != "CAPACITE SUR SITE" || b.ChargeTotale != 100.5 ||
		b.PPS != 1000 || b.Pourcentage != 50 || b.Unite != "U_0002" || b.CalculDuree != "Dates fixes" ||
		b.DateDebut != "2026-09-01" || b.DateFin != "2026-11-30" {
		t.Errorf("layout B mal décalé : %+v", b.PlanLine)
	}
	in := lineByRow(res, 4)
	if !in.Inactive || in.Ressource != "R_003" || in.RessourceKind != "internal" {
		t.Errorf("inactif %+v", in.PlanLine)
	}
	if k := lineByRow(res, 7).RessourceKind; k != "external" {
		t.Errorf("RES_ext kind %s", k)
	}
	l12 := lineByRow(res, 12)
	if l12.DateDebut != "2026-11-30" || l12.DateFin != "2026-09-01" {
		t.Errorf("dates texte %s %s", l12.DateDebut, l12.DateFin)
	}
	if res.PeriodeDebut != "2026-09-01" || res.PeriodeFin != "2027-01-31" {
		t.Errorf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	// Ressources distinctes acceptées : R_001, R_002, R_003 (inactif), RES_ext_01, r-7 → 20 %.
	if res.PctInactifs != 20 {
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
		in, code, kind string
		inactive       bool
	}{
		{"DURANDC", "DURANDC", "internal", false},
		{"R_001", "R_001", "internal", false},
		{"[inactif] R_002", "R_002", "internal", true},
		{"[INACTIF]2GI_DEMO_X", "2GI_DEMO_X", "external", true},
		{"RES_ext_12", "RES_ext_12", "external", false},
		{"2GI_DEMO_1ZZZ_SiteNord_TS_TT_", "2GI_DEMO_1ZZZ_SiteNord_TS_TT_", "external", false},
		{"r-7", "r-7", "unknown", false},
	}
	for _, c := range cases {
		code, in, kind := NormalizeRessource(c.in)
		if code != c.code || in != c.inactive || kind != c.kind {
			t.Errorf("%q → %q %v %s", c.in, code, in, kind)
		}
	}
}
