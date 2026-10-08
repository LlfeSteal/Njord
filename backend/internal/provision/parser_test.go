package provision

import (
	"errors"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"njord/internal/domain"
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

var header = []any{"Tâche ou sous-projet", "Libellé", "Quantité", "Unité", "Ligne de coût", "Type de dépense",
	"Date de début", "Date de fin", "Calcul de la durée", "Depuis", "Pendant", ".PPS"}

// banner: lignes 1-2 de l'export Planisware, en-tête ligne 3.
func withBanner(rows ...[]any) [][]any {
	return append([][]any{{"07/10/26", "", "", "", "Dépenses prévues"}, {}, header}, rows...)
}

func grp(name string) []any { return []any{name} }
func somme(v float64) []any {
	return []any{"Somme", "", v, "", "", "", "", "", "", "", "", v}
}

// data: ligne standard ; pps = nil → cellule vide.
func data(ct, lib string, qte any, ligne string, d1, d2 any, pps any) []any {
	return []any{ct, lib, qte, "EURO", ligne, "Standard", d1, d2, "Depuis-pendant", "261j", "1j", pps}
}

// Serials: 46296 = 2026-10-01, 46297 = 2026-10-02, 46387 = 2026-12-31, 46388 = 2027-01-01.
func sampleRows() [][]any {
	return withBanner(
		grp("Projet A"), // 4
		somme(1500),     // 5
		grp("Sous A1"),  // 6
		somme(1000),     // 7
		data("Y99F00001", "Provision A1", 600.0, "PROVISIONS POUR ALEAS", 46296, 46297, 600.0), // 8
		data("Y99F00001", "Capacité A1", 400.0, "CAPACITE SUR SITE", 46296, 46297, nil),        // 9 : repli sur Quantité
		grp("Sous A2"), // 10
		somme(500),     // 11
		data("Y99F00002", "Frais A2", 999.0, "FRAIS ACHATS CAPACITE SUR SITE", 46387, 46388, 500.0), // 12 : .PPS prioritaire
		grp("Projet B"), // 13
		somme(260),      // 14
		data("Y99F00003", "Avoir", -50.0, "PROVISIONS POUR ALEAS", 46387, 46388, -50.0),                                           // 15 : négatif
		[]any{"Y99F00003", "Dollar", 300.0, "USD", "PROVISIONS POUR ALEAS", "Standard", 46387, "pas une date", "", "", "", 300.0}, // 16
		data("Y99F00004", "NaN", "abc", "PROVISIONS POUR ALEAS", 46387, 46388, "-"),                                               // 17 : drop
		data("", "Sans CT", 10.0, "PROVISIONS POUR ALEAS", 46387, 46388, 10.0),                                                    // 18 : drop (ferme Projet B)
		[]any{},         // 19 : vide
		grp("Projet C"), // 20
		somme(200),      // 21
		data("Y99F00005", "Doublon", 100.0, "PROVISIONS POUR ALEAS", 46387, 46388, 100.0), // 22
		data("Y99F00005", "Doublon", 100.0, "PROVISIONS POUR ALEAS", 46387, 46388, 100.0), // 23 : warn doublon
	)
}

func byRow(res *ParseResult) map[int]domain.ProvisionLine {
	m := map[int]domain.ProvisionLine{}
	for _, l := range res.Lines {
		m[l.RowNum] = l
	}
	return m
}

func TestParseSample(t *testing.T) {
	res, err := Parse(buildXLSX(t, "Style par défaut", sampleRows()))
	if err != nil {
		t.Fatal(err)
	}
	if res.Sheet != "Style par défaut" || res.HeaderRow != 3 || res.SourceFormat != domain.FormatProvisions {
		t.Fatalf("table %q ligne %d format %q", res.Sheet, res.HeaderRow, res.SourceFormat)
	}
	if res.Total != 9 || res.OK != 4 || res.Warn != 3 || res.Drop != 2 {
		t.Fatalf("compteurs total=%d ok=%d warn=%d drop=%d", res.Total, res.OK, res.Warn, res.Drop)
	}
	m := byRow(res)
	cases := []struct {
		row     int
		groupe  string
		montant float64
		statut  domain.ParsingStatut
		motif   string
	}{
		{8, "Projet A > Sous A1", 600, domain.ParsingOK, ""},
		{9, "Projet A > Sous A1", 400, domain.ParsingOK, ""},
		{12, "Projet A > Sous A2", 500, domain.ParsingOK, ""},
		{15, "Projet B", -50, domain.ParsingWarn, "montant négatif (-50 €)"},
		{16, "Projet B", 300, domain.ParsingWarn, "unité « USD » au lieu de EURO"},
		{17, "Projet B", 0, domain.ParsingDrop, "montant non numérique"},
		{18, "Projet B", 10, domain.ParsingDrop, "CT vide"},
		{22, "Projet C", 100, domain.ParsingOK, ""},
		{23, "Projet C", 100, domain.ParsingWarn, "doublon (CT, libellé, ligne de coût, date, montant) de la ligne 22"},
	}
	for _, c := range cases {
		l, ok := m[c.row]
		if !ok {
			t.Errorf("ligne %d absente", c.row)
			continue
		}
		if l.Groupe != c.groupe || l.Montant != c.montant || l.StatutParsing != c.statut || !strings.Contains(l.MotifRejet, c.motif) {
			t.Errorf("ligne %d: groupe %q montant %v statut %s motif %q", c.row, l.Groupe, l.Montant, l.StatutParsing, l.MotifRejet)
		}
	}
	if !strings.Contains(m[16].MotifRejet, "date de fin illisible") || m[16].DateFin != "" || m[16].DateDebut != "2026-12-31" {
		t.Errorf("ligne 16: %+v", m[16])
	}
	if l := m[8]; l.CT != "Y99F00001" || l.Unite != "EURO" || l.LigneCout != "PROVISIONS POUR ALEAS" ||
		l.TypeDepense != "Standard" || l.DateDebut != "2026-10-01" || l.DateFin != "2026-10-02" || l.Libelle != "Provision A1" {
		t.Errorf("ligne 8: %+v", l)
	}
	// Σ ok + warn = 600 + 400 + 500 − 50 + 300 + 100 + 100.
	if res.MontantTotalEur != 1950 {
		t.Errorf("montant total %v", res.MontantTotalEur)
	}
	if res.PeriodeDebut != "2026-10-01" || res.PeriodeFin != "2027-01-01" {
		t.Errorf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	if len(res.Issues) != 5 {
		t.Errorf("issues %d: %+v", len(res.Issues), res.Issues)
	}
	want := map[string]int{motifNegatif: 1, motifUnite: 1, motifDateFin: 1, motifCTVide: 1, motifMontantNum: 1, motifDoublon: 1}
	for k, v := range want {
		if res.MotifsCount[k] != v {
			t.Errorf("motif %q: %d (attendu %d) %v", k, res.MotifsCount[k], v, res.MotifsCount)
		}
	}
}

// Colonnes repérées par leur nom (ordre quelconque), colonnes facultatives absentes.
func TestParseColumnsByName(t *testing.T) {
	rows := [][]any{
		{".PPS", "Type de dépense", "Ligne de coût", "Quantité", "Tâche ou sous-projet"},
		{1234.5, "Standard", "PROVISIONS POUR ALEAS", 1000, "Y99F00009"},
		{"", "Standard", "CAPACITE SUR SITE", 99, "Y99F00009"},
	}
	res, err := Parse(buildXLSX(t, "Provisions", rows))
	if err != nil {
		t.Fatal(err)
	}
	if res.HeaderRow != 1 || res.Total != 2 || res.OK != 2 || res.MontantTotalEur != 1333.5 {
		t.Fatalf("%+v", res)
	}
	if l := res.Lines[0]; l.CT != "Y99F00009" || l.Montant != 1234.5 || l.Groupe != "" || l.Unite != "" {
		t.Errorf("%+v", l)
	}
}

// Somme non atteinte exactement à cause d'un avoir : le groupe ne se ferme
// qu'au total exact ; un dépassement est fermé par la ligne de groupe suivante.
func TestParseGroupsWithCredit(t *testing.T) {
	rows := withBanner(
		grp("P"), somme(100),
		data("CT1", "a", 150.0, "PROVISIONS POUR ALEAS", 46296, 46297, 150.0),
		data("CT1", "b", -50.0, "PROVISIONS POUR ALEAS", 46296, 46297, -50.0),
		grp("Q"), somme(10),
		data("CT2", "c", 30.0, "PROVISIONS POUR ALEAS", 46296, 46297, 30.0), // dépasse
		grp("R"), somme(5),
		data("CT3", "d", 5.0, "PROVISIONS POUR ALEAS", 46296, 46297, 5.0),
	)
	res, err := Parse(buildXLSX(t, "Style par défaut", rows))
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, l := range res.Lines {
		got = append(got, l.Groupe)
	}
	if strings.Join(got, "|") != "P|P|Q|R" {
		t.Errorf("groupes %v", got)
	}
}

func TestParseRejectsPlan(t *testing.T) {
	pdc := [][]any{
		{"Tâche ou sous-projet", "Ressource", "Libellé", "Type d'affectation", "Ligne de coût", "Charge totale", ".PPS",
			"Pourcentage", "Unité", "Calcul de la durée", "Date début", "Date fin"},
		{"Y99F00001", "R_001", "DUPONT Jean", "Standard", "MAIN D'OEUVRE SUR SITE", 100, 1000, 50, "U", "Dates fixes", 46296, 46297},
	}
	_, err := Parse(buildXLSX(t, "Style par défaut", pdc))
	var pe *ParseError
	if !errors.As(err, &pe) || pe.Code != CodeHeaderInvalid {
		t.Fatalf("erreur %v", err)
	}
	if !strings.Contains(pe.Msg, "Quantité") || !strings.Contains(pe.Msg, "Type de dépense") {
		t.Errorf("message %q", pe.Msg)
	}
}

func TestParseBlockingErrors(t *testing.T) {
	var pe *ParseError
	if _, err := Parse([]byte("pas un xlsx")); !errors.As(err, &pe) || pe.Code != CodeFileInvalid {
		t.Errorf("fichier illisible: %v", err)
	}
	other := buildXLSX(t, "Feuil1", [][]any{{"a", "b"}, {1, 2}})
	if _, err := Parse(other); !errors.As(err, &pe) || pe.Code != CodeSheetNotFound {
		t.Errorf("onglet introuvable: %v", err)
	}
	empty := buildXLSX(t, "Provisions", [][]any{{"a", "b"}})
	if _, err := Parse(empty); !errors.As(err, &pe) || pe.Code != CodeHeaderInvalid {
		t.Errorf("onglet Provisions sans en-tête: %v", err)
	}
}

func readDemo(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("../../../test_data_demo/" + name)
	if err != nil {
		t.Skipf("fichier de démo absent: %v", err)
	}
	return b
}

func TestParsePlanDemoRejected(t *testing.T) {
	_, err := Parse(readDemo(t, "demo_plancharge.xlsx"))
	var pe *ParseError
	if !errors.As(err, &pe) || pe.Code != CodeHeaderInvalid {
		t.Fatalf("erreur %v", err)
	}
}

func TestParseExportOctobre(t *testing.T) {
	res, err := Parse(readDemo(t, "Export Provisions Octobre_DEMO.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Sheet != "Style par défaut" || res.HeaderRow != 3 {
		t.Errorf("table %q ligne %d", res.Sheet, res.HeaderRow)
	}
	if res.Total != 31 || res.OK != 31 || res.Warn != 0 || res.Drop != 0 {
		t.Fatalf("compteurs total=%d ok=%d warn=%d drop=%d issues=%v", res.Total, res.OK, res.Warn, res.Drop, res.Issues)
	}
	if math.Abs(res.MontantTotalEur-1369126.5) > 0.001 {
		t.Errorf("montant total %v", res.MontantTotalEur)
	}
	cts := map[string]bool{}
	groupes := map[string]string{}
	for _, l := range res.Lines {
		cts[l.CT] = true
		groupes[l.CT] = l.Groupe
	}
	if len(cts) != 15 {
		t.Errorf("%d CT", len(cts))
	}
	for ct, g := range map[string]string{
		"Y99F71110": "Dromon > Cordage",
		"Y99F71111": "Dromon > Éperon",
		"Y99F71205": "Vaigrault > Grand-Voile",
		"Y99F71402": "Estacade > Cabestan",
		"Y99F71508": "Rivage > Squad Chaloupe",
		"YBR99AB05": "Filao > Narval",
	} {
		if groupes[ct] != g {
			t.Errorf("%s: groupe %q, attendu %q", ct, groupes[ct], g)
		}
	}
	if res.PeriodeDebut != "2026-10-01" || res.PeriodeFin != "2027-01-01" {
		t.Errorf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
}

// Jeu de démo (test_data_demo/generateur_provision) : provisions restantes
// sur les CT du plan et du réalisé démo (oracle : attendus.csv).
func TestParseDemoProvision(t *testing.T) {
	res, err := Parse(readDemo(t, "demo_provision.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 22 || res.OK != 22 {
		t.Fatalf("compteurs total=%d ok=%d issues=%v", res.Total, res.OK, res.Issues)
	}
	if math.Abs(res.MontantTotalEur-345030) > 0.001 {
		t.Errorf("montant total %v", res.MontantTotalEur)
	}
	par := map[string]float64{}
	for _, l := range res.Lines {
		par[l.CT] += l.Montant
	}
	for ct, want := range map[string]float64{
		"Y99F900011": 60030, "Y99F900012": 100000, "Y99F900013": 30000, "Y99F900014": 5000,
		"Y99F900015": 40000, "Y99F900021": 25000, "Y99F900022": 19000, "Y99F90004": 20000,
		"Y99F90006": 15000, "Y99F90009": 4000, "Y99F90601": 12000, "Y99F90701": 15000,
	} {
		if math.Abs(par[ct]-want) > 0.001 {
			t.Errorf("%s: %v, attendu %v", ct, par[ct], want)
		}
	}
	if len(par) != 12 {
		t.Errorf("%d CT", len(par))
	}
}
