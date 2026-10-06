package realise

import (
	"os"
	"strings"
	"testing"

	"njord/internal/domain"
)

func loadDemo(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("../../../test_data_demo/demo_realise.xlsx")
	if err != nil {
		t.Skip("fichier démo absent")
	}
	return data
}

func TestParseDemo(t *testing.T) {
	res, err := Parse(loadDemo(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("format=%s onglet=%s en-tête=%d total=%d ok=%d warn=%d drop=%d période=%s→%s montant=%.2f",
		res.SourceFormat, res.SheetName, res.HeaderRow, res.Total, res.OK, res.Warn, res.Drop,
		res.PeriodeDebut, res.PeriodeFin, res.MontantTotalEur)
	for _, k := range res.SortedMotifs() {
		t.Logf("  motif %q : %d", k, res.MotifsCount[k])
	}
	if res.SourceFormat != domain.FormatDemo || res.SheetName != "MyWorkSheet-1" || res.HeaderRow != 1 {
		t.Fatalf("détection: %s %s %d", res.SourceFormat, res.SheetName, res.HeaderRow)
	}
	if len(res.Entries) != 482 || res.Total != 482 {
		t.Fatalf("écritures: %d / total %d", len(res.Entries), res.Total)
	}
	if res.OK+res.Warn+res.Drop != res.Total {
		t.Fatal("compteurs incohérents")
	}
	if res.PeriodeDebut != "2026-08-27" || res.PeriodeFin != "2026-10-03" {
		t.Fatalf("période %s → %s", res.PeriodeDebut, res.PeriodeFin)
	}
	neg, negQ := 0, 0
	var sum float64
	for _, e := range res.Entries {
		if e.TotalEur < 0 {
			neg++
		}
		if e.Quantite < 0 {
			negQ++
		}
		if e.StatutParsing != domain.ParsingDrop {
			sum += e.TotalEur
		}
		if strings.Contains(e.TG, " ") || e.TG == "" && e.StatutParsing != domain.ParsingDrop {
			t.Errorf("tg %q", e.TG)
		}
	}
	// Avoirs conservés : 20 TOTAL EN € négatifs (dont 15 avec QUANTITE négative,
	// les 5 autres sont des FNP AUTOMATIQUES à quantité nulle).
	if neg != 20 || negQ != 15 {
		t.Fatalf("montants négatifs: %d (quantités négatives: %d)", neg, negQ)
	}
	if res.MontantTotalEur != 403130.43 { // Totaux du fichier : 403.130419 k€ (arrondi au centime par ligne)
		t.Fatalf("montant total %.2f", res.MontantTotalEur)
	}
	if d := sum - res.MontantTotalEur; d > 0.01 || d < -0.01 {
		t.Fatalf("montant total %.2f vs Σ %.2f", res.MontantTotalEur, sum)
	}
	e := res.Entries[0]
	if e.RowNum != 3 || e.TotalEur != 11000.89 || e.TG != "Y99F900011" ||
		e.TGLibelle != "Y99F900011 - Réserve de capacité Site Nord" ||
		e.WP != "Y99F90300" || e.WPLibelle != "Y99F90300 - Réserve de capacité & aléas" {
		t.Fatalf("1re écriture: %+v", e)
	}
	if e.EmployeFournisseur != e.Fournisseur || e.Fournisseur == "" || e.NomRessource != "" || e.CodeArticle != "" {
		t.Fatalf("employé/fournisseur: %+v", e)
	}
	if e.PeriodeComptable != "2026-10-05" || e.MoisComptable != "2026-10-01" || e.DateDepense != "2026-10-03" ||
		e.Categorie != "PRESTATION" || e.Type != "CAPACITE SUR SITE" || e.CategorieFNP != "" {
		t.Fatalf("1re écriture (dates/enum): %+v", e)
	}
	// nom_prenom : NOM RESSOURCE sans civilité ; "" pour les lignes fournisseur.
	mo, people := 0, map[string]bool{}
	for _, e := range res.Entries {
		switch {
		case e.NomRessource == "":
			if e.NomPrenom != "" {
				t.Errorf("fournisseur %q → nom_prenom %q", e.Fournisseur, e.NomPrenom)
			}
		case e.NomPrenom == "" || strings.HasSuffix(e.NomPrenom, ".") || strings.HasSuffix(e.NomPrenom, " Mme") ||
			!strings.HasPrefix(e.NomRessource, e.NomPrenom+" "):
			t.Errorf("ressource %q → nom_prenom %q", e.NomRessource, e.NomPrenom)
		default:
			people[e.NomPrenom] = true
		}
		if e.Categorie == "MAIN D'OEUVRE" {
			mo++
			if e.NomPrenom == "" {
				t.Errorf("écriture MO ligne %d sans nom_prenom", e.RowNum)
			}
		}
	}
	if mo != 333 || !people["DE LA TOUR Antoine"] || !people["DURAND Claire"] {
		t.Fatalf("nom_prenom: %d MO, %d personnes", mo, len(people))
	}
	last := res.Entries[len(res.Entries)-1]
	if last.NomRessource == "" || last.EmployeFournisseur != last.NomRessource || last.Quantite != 7.5 {
		t.Fatalf("dernière écriture: %+v", last)
	}
}
