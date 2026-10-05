package realise

import (
	"errors"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"njord/internal/domain"
)

var specHeader = []any{
	"ENTITE", "ACTIVITE", "SOUS-ACTIVITE", "TRIGRAMME", "TG", "TG - LIBELLE", "WP", "WP LIBELLE",
	"DESCRIPTION DEPENSES", "CATEGORIE", "TYPE", "CATEGORIE DEPENSES POUR FNP AUTOMATIQUES",
	"EMPLOYE/FOURNISSEUR", "MATRICULE", "FPC", "CEA", "QUANTITE", "TOTAL EN €", "DATE DEPENSE",
	"PERIODE COMPTABLE", "COMPTE COMPTABLE", "N° FACTURE", "n° COMMANDE", "n° LIGNE", "LOT DE PROGRAMME IFRS15",
}

// specRow builds a valid 25-column line; overrides maps column index → value.
func specRow(over map[int]any) []any {
	r := []any{
		"ENTITE_A", "ACTIVITE_A", "SA_A", "PRG", "CT_000000001", "CT_000000001 - Développement Été",
		"WP_000000001", "WP_000000001 - Lot 1", "Prestation de conseil", "MAIN D'OEUVRE", "MAIN D'OEUVRE SUR SITE",
		"-", "DUPONT Jean M.", "A12345", "FPC_01 Fonction", "CEA_abcd", 7.5, 1234.5, 46266,
		46296.9999, "CCP_00000001", "F_00000000001", "CMD_0000001", 1, "LOT_1",
	}
	for k, v := range over {
		r[k] = v
	}
	return r
}

const (
	cTG   = 4
	cCat  = 9
	cType = 10
	cQte  = 16
	cTot  = 17
	cDate = 18
	cPer  = 19
	cFac  = 21
	cCmd  = 22
	cLig  = 23
	cWP   = 6
)

func buildXLSX(t *testing.T, sheet string, header []any, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		t.Fatal(err)
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

// specRows: Excel row → expected statut (row 2 = first data line).
func specFixture() ([][]any, map[int]domain.ParsingStatut) {
	rows := [][]any{
		specRow(nil),                                                   // 2 ok
		specRow(map[int]any{cTG: ""}),                                  // 3 drop TG vide
		specRow(map[int]any{cTG: "-"}),                                 // 4 drop TG "-"
		specRow(map[int]any{cDate: "pas une date"}),                    // 5 drop date invalide
		specRow(map[int]any{cDate: ""}),                                // 6 drop date vide
		specRow(map[int]any{cType: "TYPE INCONNU", cFac: "F_7"}),       // 7 warn type
		specRow(map[int]any{cCat: "BIDULE", cFac: "F_8"}),              // 8 warn catégorie
		specRow(map[int]any{cTot: "abc"}),                              // 9 drop montant
		specRow(map[int]any{cDate: 46280, cPer: 46270.6, cFac: "F_2"}), // 10 warn clôture (2026-09-06 < 2026-09-15 − 7 j)
		specRow(map[int]any{cDate: 46280, cPer: 46272.6, cFac: "F_3"}), // 11 ok (exactement 7 j)
		specRow(nil), // 12 warn doublon de la ligne 2
		specRow(map[int]any{cFac: "-", cCmd: "-"}),                                              // 13 ok (clé doublon ignorée sans facture ni commande)
		specRow(map[int]any{cFac: "-", cCmd: "-"}),                                              // 14 ok
		specRow(map[int]any{cTot: "-61 800,5", cQte: "-3,5", cWP: "-", cFac: "F_4", cLig: "-"}), // 15 ok avoir
		{}, // 16 vide, ignorée
		specRow(map[int]any{cType: "X", cCat: "Y", cFac: "F_5"}), // 17 warn double motif
		specRow(map[int]any{cTG: "", cType: "X", cFac: "F_6"}),   // 18 drop + warn
	}
	exp := map[int]domain.ParsingStatut{
		2: "ok", 3: "drop", 4: "drop", 5: "drop", 6: "drop", 7: "warn", 8: "warn", 9: "drop", 10: "warn",
		11: "ok", 12: "warn", 13: "ok", 14: "ok", 15: "ok", 17: "warn", 18: "drop",
	}
	return rows, exp
}

func TestParseSpecControls(t *testing.T) {
	rows, exp := specFixture()
	res, err := Parse(buildXLSX(t, "Réalisé", specHeader, rows))
	if err != nil {
		t.Fatal(err)
	}
	if res.SourceFormat != domain.FormatSpec || res.SheetName != "Réalisé" || res.HeaderRow != 1 {
		t.Fatalf("détection %s %s %d", res.SourceFormat, res.SheetName, res.HeaderRow)
	}
	if res.Total != 16 || res.OK != 5 || res.Warn != 5 || res.Drop != 6 {
		t.Fatalf("compteurs total=%d ok=%d warn=%d drop=%d", res.Total, res.OK, res.Warn, res.Drop)
	}
	byRow := map[int]domain.RealiseEntry{}
	for _, e := range res.Entries {
		byRow[e.RowNum] = e
		if exp[e.RowNum] != e.StatutParsing {
			t.Errorf("ligne %d: statut %s attendu %s (%s)", e.RowNum, e.StatutParsing, exp[e.RowNum], e.MotifRejet)
		}
	}
	if _, ok := byRow[16]; ok {
		t.Error("la ligne vide doit être ignorée")
	}
	motif := func(row int, sub string) {
		t.Helper()
		if !strings.Contains(byRow[row].MotifRejet, sub) {
			t.Errorf("ligne %d: motif %q ne contient pas %q", row, byRow[row].MotifRejet, sub)
		}
	}
	motif(3, "TG vide")
	motif(4, "TG vide")
	motif(5, "DATE DEPENSE non convertible")
	motif(6, "DATE DEPENSE vide")
	motif(7, "TYPE hors énuméré « TYPE INCONNU »")
	motif(8, "CATEGORIE hors énuméré « BIDULE »")
	motif(9, "TOTAL EN € non numérique")
	motif(10, "clôture anormale")
	motif(12, "doublon")
	motif(12, "ligne 2")
	motif(17, "TYPE hors énuméré « X » ; CATEGORIE hors énuméré « Y »")
	motif(18, "TG vide")
	motif(18, "TYPE hors énuméré")

	ok := byRow[2]
	if ok.TG != "CT_000000001" || ok.TGLibelle != "CT_000000001 - Développement Été" || ok.DateDepense != "2026-09-01" ||
		ok.PeriodeComptable != "2026-10-02" || ok.TotalEur != 1234.5 || ok.Quantite != 7.5 || ok.NumLigne == nil ||
		*ok.NumLigne != 1 || ok.CategorieFNP != "" || ok.LotIFRS15 != "LOT_1" || ok.Matricule != "A12345" ||
		ok.EmployeFournisseur != "DUPONT Jean M." || ok.MotifRejet != "" {
		t.Fatalf("ligne 2: %+v", ok)
	}
	if byRow[10].PeriodeComptable != "2026-09-06" || byRow[11].PeriodeComptable != "2026-09-08" {
		t.Fatalf("arrondi période: %s %s", byRow[10].PeriodeComptable, byRow[11].PeriodeComptable)
	}
	av := byRow[15]
	if av.TotalEur != -61800.5 || av.Quantite != -3.5 || av.WP != "" || av.NumLigne != nil {
		t.Fatalf("avoir: %+v", av)
	}
	if res.PeriodeDebut != "2026-09-01" || res.PeriodeFin != "2026-09-15" {
		t.Fatalf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	// Σ des lignes acceptées : 9 lignes à 1234.5 + avoir.
	if want := 9*1234.5 - 61800.5; res.MontantTotalEur != want {
		t.Fatalf("montant %.2f attendu %.2f", res.MontantTotalEur, want)
	}
	if res.MotifsCount["TG vide"] != 3 || res.MotifsCount["doublon"] != 1 || res.MotifsCount["TYPE hors énuméré"] != 3 {
		t.Fatalf("motifs %v", res.MotifsCount)
	}
	if len(res.Issues) != 11 {
		t.Fatalf("issues %d", len(res.Issues))
	}
}

func formatCode(t *testing.T, data []byte) string {
	t.Helper()
	_, err := Parse(data)
	var fe *FormatError
	if !errors.As(err, &fe) {
		t.Fatalf("FormatError attendue, obtenu %v", err)
	}
	return fe.Code
}

func TestParseRejects(t *testing.T) {
	rows := [][]any{specRow(nil)}
	// En-tête incomplet (24 colonnes).
	if c := formatCode(t, buildXLSX(t, "Réalisé", specHeader[:24], rows)); c != CodeHeaderInvalid {
		t.Errorf("24 colonnes: %s", c)
	}
	// Colonnes interverties.
	swapped := append([]any(nil), specHeader...)
	swapped[0], swapped[1] = swapped[1], swapped[0]
	if c := formatCode(t, buildXLSX(t, "Réalisé", swapped, rows)); c != CodeHeaderInvalid {
		t.Errorf("ordre: %s", c)
	}
	// Onglet Réalisé sans en-tête reconnaissable.
	if c := formatCode(t, buildXLSX(t, "Réalisé", []any{"A", "B"}, rows)); c != CodeHeaderInvalid {
		t.Errorf("onglet sans en-tête: %s", c)
	}
	// Aucun onglet exploitable.
	if c := formatCode(t, buildXLSX(t, "Feuil1", []any{"A", "B"}, rows)); c != CodeSheetNotFound {
		t.Errorf("onglet absent: %s", c)
	}
	// Fichier non Excel.
	if c := formatCode(t, []byte("pas un xlsx")); c != CodeFileInvalid {
		t.Errorf("non xlsx: %s", c)
	}
	// En-tête seul.
	if c := formatCode(t, buildXLSX(t, "Réalisé", specHeader, nil)); c != CodeFileInvalid {
		t.Errorf("sans données: %s", c)
	}
	// Le message d'en-tête cite la colonne manquante.
	_, err := Parse(buildXLSX(t, "Réalisé", specHeader[:24], rows))
	if !strings.Contains(err.Error(), "lot de programme ifrs15") {
		t.Errorf("message: %v", err)
	}
}

// En-tête spec sur un autre onglet, en ligne 3, colonnes supplémentaires tolérées.
func TestParseSpecOtherSheet(t *testing.T) {
	f := excelize.NewFile()
	defer f.Close()
	f.SetCellValue("Sheet1", "A1", "Export du réalisé")
	h := append(append([]any(nil), specHeader...), "COMMENTAIRE")
	f.SetSheetRow("Sheet1", "A3", &h)
	r := specRow(nil)
	f.SetSheetRow("Sheet1", "A4", &r)
	buf, _ := f.WriteToBuffer()
	res, err := Parse(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if res.HeaderRow != 3 || res.OK != 1 || res.Entries[0].RowNum != 4 {
		t.Fatalf("%+v", res)
	}
}
