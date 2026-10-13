package analyse

import (
	"net/http"
	"strings"
	"testing"

	"njord/internal/domain"
)

// csvRessourcesCT: « ressource;CT » de chaque ligne de ecarts.csv (sans l'en-tête).
func csvRessourcesCT(t *testing.T, e *env, path string) []string {
	t.Helper()
	w := e.do("GET", path, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%s : %d %s", path, w.Code, w.Body.String())
	}
	lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")[1:]
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		f := strings.Split(strings.TrimSpace(l), ";")
		out = append(out, f[0]+";"+f[1])
	}
	return out
}

func hasLigneCSV(lines []string, s string) bool {
	for _, l := range lines {
		if l == s {
			return true
		}
	}
	return false
}

// DECISIONS n° 26 : ecarts.csv?masquer_traites=true retire les tuples dont toutes
// les anomalies sont traitées / ignorées ; une anomalie rouverte les fait revenir.
func TestHandlerCSVMasquerTraites(t *testing.T) {
	e := newEnv(t)
	e.seed()
	// BLANC Sarah (20 h prévues sur Y99F90004) impute 20 h sur Y99F90001 → erreur de CT des deux côtés.
	e.exec(`INSERT INTO realise_entries(version_id,row_num,tg,tg_libelle,categorie,type,employe_fournisseur,nom_prenom,quantite,total_eur,date_depense,periode_comptable,statut_parsing)
		VALUES ('real1',8,'Y99F90001','Y99F90001 - Socle','MAIN D''OEUVRE','MAIN D''OEUVRE SUR SITE','BLANC Sarah Mme','BLANC Sarah',20,2000,'2026-09-09','2026-09-30','ok')`)
	res := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	checkRowKeys(t, res.Ecarts, res.Anomalies)
	durand := findAnomalie(res.Anomalies, "ecart|Y99F90001|DURAND Claire|sur_imputation")
	ect := findAnomalie(res.Anomalies, "ecart|Y99F90001|BLANC Sarah|erreur_ct")
	if durand == nil || ect == nil {
		t.Fatalf("anomalies attendues absentes : %+v", res.Anomalies)
	}
	for _, r := range res.Ecarts {
		if r.Ressource == "BLANC Sarah" && strings.Join(r.Anomalies, ",") != ect.Key {
			t.Errorf("BLANC Sarah %s : %v", r.CT, r.Anomalies)
		}
	}

	all := csvRessourcesCT(t, e, "/api/analyse/ecarts.csv")
	for _, s := range []string{"DURAND Claire;Y99F90001", "BLANC Sarah;Y99F90001", "BLANC Sarah;Y99F90004"} {
		if !hasLigneCSV(all, s) {
			t.Fatalf("%s absent : %v", s, all)
		}
	}
	// Rien de traité : masquer_traites ne retire rien.
	if got := csvRessourcesCT(t, e, "/api/analyse/ecarts.csv?masquer_traites=true"); len(got) != len(all) {
		t.Errorf("rien de traité : %v / %v", got, all)
	}

	put := func(a *domain.Anomalie, fp string, s domain.AnomalieStatut) {
		t.Helper()
		if w := e.do("PUT", "/api/analyse/anomalies/suivi", domain.AnomalieSuiviInput{Key: a.Key, Fingerprint: fp, Statut: s}); w.Code != http.StatusOK {
			t.Fatalf("PUT %s : %d %s", a.Key, w.Code, w.Body.String())
		}
	}
	put(durand, durand.Fingerprint, domain.AnomalieTraitee)
	put(ect, ect.Fingerprint, domain.AnomalieIgnoree)
	got := csvRessourcesCT(t, e, "/api/analyse/ecarts.csv?masquer_traites=true")
	for _, s := range []string{"DURAND Claire;Y99F90001", "BLANC Sarah;Y99F90001", "BLANC Sarah;Y99F90004"} {
		if hasLigneCSV(got, s) {
			t.Errorf("%s non masqué : %v", s, got)
		}
	}
	if len(got) != len(all)-3 {
		t.Errorf("masqués : %d lignes sur %d, attendu %d", len(got), len(all), len(all)-3)
	}
	// Par défaut (interrupteur désactivé côté export) : tout reste.
	if n := len(csvRessourcesCT(t, e, "/api/analyse/ecarts.csv?masquer_traites=false")); n != len(all) {
		t.Errorf("masquer_traites=false : %d / %d", n, len(all))
	}
	// Combiné aux filtres.
	if got := csvRessourcesCT(t, e, "/api/analyse/ecarts.csv?flag=erreur_ct&masquer_traites=true"); len(got) != 0 {
		t.Errorf("flag=erreur_ct masqué : %v", got)
	}

	// Anomalie rouverte (empreinte enregistrée différente) → ses tuples reviennent.
	put(ect, "000000000000", domain.AnomalieIgnoree)
	got = csvRessourcesCT(t, e, "/api/analyse/ecarts.csv?masquer_traites=true")
	if !hasLigneCSV(got, "BLANC Sarah;Y99F90001") || !hasLigneCSV(got, "BLANC Sarah;Y99F90004") || hasLigneCSV(got, "DURAND Claire;Y99F90001") {
		t.Errorf("après réouverture : %v", got)
	}
}
