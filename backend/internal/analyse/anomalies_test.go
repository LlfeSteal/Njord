package analyse

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"njord/internal/domain"
	"njord/internal/plan"
	"njord/internal/realise"
)

// seedDemo imports the demo files (test_data_demo) as active versions.
func (e *env) seedDemo() {
	e.t.Helper()
	ctx := context.Background()
	data, err := os.ReadFile("../../../test_data_demo/demo_plancharge.xlsx")
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := plan.NewService(e.st).Commit(ctx, data, "demo_plancharge.xlsx", "", "test", true); err != nil {
		e.t.Fatal(err)
	}
	data, err = os.ReadFile("../../../test_data_demo/demo_realise.xlsx")
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := realise.NewService(e.st).Import(ctx, data, "demo_realise.xlsx", "", "test", true); err != nil {
		e.t.Fatal(err)
	}
}

func checkAnomalies(t *testing.T, as []domain.Anomalie) {
	t.Helper()
	keys := map[string]bool{}
	for i, a := range as {
		if keys[a.Key] {
			t.Errorf("clé en double : %s", a.Key)
		}
		keys[a.Key] = true
		if strings.Contains(a.Key, "/") || !strings.HasPrefix(a.Key, string(a.Categorie)+"|") {
			t.Errorf("clé invalide : %s", a.Key)
		}
		if len(a.Fingerprint) != 12 || a.Titre == "" || a.Lien == "" || a.Gravite < 1 || a.Gravite > 3 {
			t.Errorf("anomalie incomplète : %+v", a)
		}
		if a.Categorie == domain.AnomalieEcart && (a.Flag == nil || *a.Flag == domain.FlagConforme) {
			t.Errorf("écart conforme ou sans flag : %s", a.Key)
		}
		if len(a.Details) > maxDetails {
			t.Errorf("%s : %d détails", a.Key, len(a.Details))
		}
		if i == 0 {
			continue
		}
		p := as[i-1]
		switch {
		case p.Gravite != a.Gravite:
			if p.Gravite < a.Gravite {
				t.Errorf("tri gravité : %s avant %s", p.Key, a.Key)
			}
		case p.Categorie != a.Categorie:
			if categorieOrder[p.Categorie] > categorieOrder[a.Categorie] {
				t.Errorf("tri catégorie : %s avant %s", p.Key, a.Key)
			}
		case magnitude(&p) != magnitude(&a):
			if magnitude(&p) < magnitude(&a) {
				t.Errorf("tri montant : %s avant %s", p.Key, a.Key)
			}
		case p.Key > a.Key:
			t.Errorf("tri clé : %s avant %s", p.Key, a.Key)
		}
	}
}

func TestAnomaliesDemo(t *testing.T) {
	e := newEnv(t)
	e.seedDemo()
	w := e.do("GET", "/api/analyse", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	res := decode[domain.AnalyseResult](t, w)
	if len(res.Anomalies) == 0 {
		t.Fatal("aucune anomalie sur la démo")
	}
	checkAnomalies(t, res.Anomalies)
	byCat := map[domain.AnomalieCategorie]int{}
	for _, a := range res.Anomalies {
		byCat[a.Categorie]++
		if a.Statut != domain.AnomalieATraiter || a.Suivi != nil {
			t.Errorf("%s : statut initial %s", a.Key, a.Statut)
		}
	}
	t.Logf("démo : %d anomalies %v", len(res.Anomalies), byCat)
	for i, a := range res.Anomalies {
		if i < 8 {
			t.Logf("  [%d] %s — %s — %s — %s", a.Gravite, a.Titre, a.Detail, a.Lien, a.Key)
		}
	}
	if byCat[domain.AnomalieEcart] == 0 {
		t.Error("aucune anomalie écart")
	}
	// Analyse budgétaire (DECISIONS n° 10) : 5 natures dont Σ = budget et consommé des prévisions.
	if pn := res.Budget.ParNature; len(pn) != 5 || pn[0].Nature != "provision" || pn[0].PPS < 85000 {
		t.Errorf("par nature : %+v", pn)
	} else {
		var pps, reel float64
		for _, n := range pn {
			pps += n.PPS
			reel += n.Realise
		}
		g := res.Previsions.Global
		if math.Abs(pps-g.Budget) > 0.05 || math.Abs(reel-g.Consomme) > 0.05 {
			t.Errorf("Σ natures PPS %.2f / réalisé %.2f, prévisions %.2f / %.2f", pps, reel, g.Budget, g.Consomme)
		}
		t.Logf("par nature : %+v", pn)
	}
	// La démo couvre tous les cas (DECISIONS n° 9) : sur- et sous-imputations, personnes jamais imputées.
	flags := map[domain.Flag]int{}
	for _, r := range res.Ecarts {
		flags[r.Flag]++
	}
	if flags[domain.FlagSurImputation] < 4 || flags[domain.FlagSousImputation] < 3 || flags[domain.FlagHorsPlan] == 0 || flags[domain.FlagConforme] == 0 {
		t.Errorf("flags de la démo : %v", flags)
	}
	if k := res.KPIs; k.NbPersonnesAbsentes != 2 || k.NbPersonnesPlanifiees != 21 {
		t.Errorf("jamais imputés : %d / %d planifiées, attendu 2 / 21", k.NbPersonnesAbsentes, k.NbPersonnesPlanifiees)
	}
	for _, key := range []string{
		anomalieKey("ecart", "Y99F90004", "BLANC Sarah", string(domain.FlagSurImputation)),
		anomalieKey("ecart", "Y99F90001", "MARTIN Théo", string(domain.FlagSousImputation)),
		anomalieKey("ecart", "Y99F900010", "ROUX Marc", string(domain.FlagAbsence)),
		anomalieKey("ecart", "Y99F90005", "DUBOIS Lucas", string(domain.FlagAbsence)),
	} {
		found := false
		for _, a := range res.Anomalies {
			found = found || a.Key == key
		}
		if !found {
			t.Errorf("anomalie attendue absente : %s", key)
		}
	}
	// Chaque écart non conforme est couvert par une anomalie, et Σ heures concorde.
	sum := map[string]float64{}
	for _, r := range res.Ecarts {
		if r.Flag != domain.FlagConforme && (!r.Inactive || r.Flag == domain.FlagHorsPlan) {
			sum[anomalieKey("ecart", r.CT, r.Ressource, string(r.Flag))] += r.Ecart
		}
	}
	for _, a := range res.Anomalies {
		if a.Categorie != domain.AnomalieEcart {
			continue
		}
		if a.Heures == nil || math.Abs(*a.Heures-sum[a.Key]) > 0.01 || len(a.Semaines) == 0 || !strings.HasPrefix(a.Lien, "/ecarts?ct=") {
			t.Errorf("écart %s : %+v (attendu %.2f h)", a.Key, a, sum[a.Key])
		}
		delete(sum, a.Key)
	}
	if len(sum) != 0 {
		t.Errorf("écarts non couverts : %v", sum)
	}

	// Déterminisme : même calcul → mêmes clés et empreintes.
	again := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	if len(again.Anomalies) != len(res.Anomalies) {
		t.Fatalf("instable : %d vs %d", len(again.Anomalies), len(res.Anomalies))
	}
	for i := range again.Anomalies {
		if again.Anomalies[i].Key != res.Anomalies[i].Key || again.Anomalies[i].Fingerprint != res.Anomalies[i].Fingerprint {
			t.Errorf("instable : %s", res.Anomalies[i].Key)
		}
	}
}

func findAnomalie(as []domain.Anomalie, key string) *domain.Anomalie {
	for i := range as {
		if as[i].Key == key {
			return &as[i]
		}
	}
	return nil
}

func TestAnomaliesSuiviCycle(t *testing.T) {
	e := newEnv(t)
	e.seedDemo()
	res := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	if len(res.Anomalies) == 0 {
		t.Fatal("aucune anomalie")
	}
	a := res.Anomalies[0]

	// Traitée.
	w := e.do("PUT", "/api/analyse/anomalies/suivi", domain.AnomalieSuiviInput{
		Key: a.Key, Fingerprint: a.Fingerprint, Statut: domain.AnomalieTraitee, Commentaire: "vu avec le chef de projet", Operateur: "alice",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("PUT : %d %s", w.Code, w.Body.String())
	}
	s := decode[domain.AnomalieSuivi](t, w)
	if s.Key != a.Key || s.Statut != domain.AnomalieTraitee || s.Operateur != "alice" || s.UpdatedAt.IsZero() || s.Obsolete {
		t.Errorf("suivi : %+v", s)
	}
	got := findAnomalie(decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil)).Anomalies, a.Key)
	if got == nil || got.Statut != domain.AnomalieTraitee || got.Suivi == nil || got.Suivi.Commentaire != "vu avec le chef de projet" || got.Suivi.Obsolete {
		t.Fatalf("après PUT : %+v", got)
	}

	// Upsert → ignorée, opérateur par en-tête.
	req := domain.AnomalieSuiviInput{Key: a.Key, Fingerprint: a.Fingerprint, Statut: domain.AnomalieIgnoree, Commentaire: strings.Repeat("é", 300)}
	if w := e.do("PUT", "/api/analyse/anomalies/suivi", req); w.Code != http.StatusOK || decode[domain.AnomalieSuivi](t, w).Operateur != "local" {
		t.Fatalf("upsert : %d %s", w.Code, w.Body.String())
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM anomalie_suivi`).Scan(&n)
	if n != 1 {
		t.Errorf("upsert : %d lignes", n)
	}
	got = findAnomalie(decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil)).Anomalies, a.Key)
	if got.Statut != domain.AnomalieIgnoree {
		t.Errorf("ignorée : %s", got.Statut)
	}

	// Les chiffres bougent → à traiter, suivi obsolète.
	e.exec(`UPDATE anomalie_suivi SET fingerprint = 'aaaaaaaaaaaa' WHERE key = ?`, a.Key)
	got = findAnomalie(decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil)).Anomalies, a.Key)
	if got.Statut != domain.AnomalieATraiter || got.Suivi == nil || !got.Suivi.Obsolete || got.Suivi.Statut != domain.AnomalieIgnoree {
		t.Errorf("obsolète : %+v %+v", got, got.Suivi)
	}

	// Rouverte.
	if w := e.do("DELETE", "/api/analyse/anomalies/suivi?key="+url.QueryEscape(a.Key), nil); w.Code != http.StatusNoContent {
		t.Fatalf("DELETE : %d %s", w.Code, w.Body.String())
	}
	got = findAnomalie(decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil)).Anomalies, a.Key)
	if got.Statut != domain.AnomalieATraiter || got.Suivi != nil {
		t.Errorf("rouverte : %+v", got)
	}
	if w := e.do("DELETE", "/api/analyse/anomalies/suivi?key=absente", nil); w.Code != http.StatusNoContent {
		t.Errorf("DELETE absente : %d", w.Code)
	}

	// Erreurs.
	for _, b := range []any{
		domain.AnomalieSuiviInput{Key: a.Key, Fingerprint: a.Fingerprint, Statut: "a_traiter"},
		domain.AnomalieSuiviInput{Key: a.Key, Fingerprint: a.Fingerprint, Statut: "bof"},
		domain.AnomalieSuiviInput{Key: "", Fingerprint: a.Fingerprint, Statut: domain.AnomalieTraitee},
		domain.AnomalieSuiviInput{Key: a.Key, Fingerprint: " ", Statut: domain.AnomalieTraitee},
		"pas un objet",
	} {
		if w := e.do("PUT", "/api/analyse/anomalies/suivi", b); w.Code != http.StatusBadRequest {
			t.Errorf("%v : %d", b, w.Code)
		}
	}
	if w := e.do("DELETE", "/api/analyse/anomalies/suivi", nil); w.Code != http.StatusBadRequest {
		t.Errorf("DELETE sans key : %d", w.Code)
	}

	// Journal d'audit.
	rows, err := e.st.DB().Query(`SELECT operateur, action, objet_id, details FROM audit_log WHERE objet_type = 'anomalie' ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var actions []string
	for rows.Next() {
		var op, action, id, details string
		rows.Scan(&op, &action, &id, &details)
		actions = append(actions, action)
		if action == "anomalie.traitee" && (op != "alice" || id != a.Key || details != "vu avec le chef de projet") {
			t.Errorf("audit traitee : %s %s %q", op, id, details)
		}
		if action == "anomalie.ignoree" && len([]rune(details)) != 200 {
			t.Errorf("audit ignoree : commentaire non tronqué (%d)", len([]rune(details)))
		}
	}
	if strings.Join(actions, ",") != "anomalie.traitee,anomalie.ignoree,anomalie.rouverte,anomalie.rouverte" {
		t.Errorf("audit : %v", actions)
	}
}

func TestAnomaliesBudget(t *testing.T) {
	plan := &domain.Version{ID: "plan1"}
	real := &domain.Version{ID: "real1"}
	res := domain.AnalyseResult{
		Meta: domain.AnalyseMeta{PlanVersion: plan, RealiseVersion: real},
		Previsions: domain.Previsions{ParCT: []domain.PrevisionCT{
			{CT: "CT1", CTLibelle: "CT1 - Socle", Budget: 10000, AtterrissagePlan: 12500, AtterrissageTendance: 15000,
				EcartPlan: 2500, EcartTendance: 5000, Statut: domain.PrevisionDepassement},
			{CT: "CT2", Budget: 10000, AtterrissagePlan: 9600, AtterrissageTendance: 10800,
				EcartPlan: -400, EcartTendance: 800, Statut: domain.PrevisionVigilance},
			{CT: "CT3", Budget: 10000, AtterrissagePlan: 8000, AtterrissageTendance: 8000, EcartPlan: -2000, EcartTendance: -2000, Statut: domain.PrevisionOK},
		}},
	}
	r := &run{s: domain.Settings{SeuilCTRisqueEur: 10000}}
	as := r.anomalies(&res)
	if len(as) != 2 {
		t.Fatalf("%d anomalies : %+v", len(as), as)
	}
	checkAnomalies(t, as)
	a, b := as[0], as[1]
	if a.Key != "budget|CT1" || a.Gravite != 3 || *a.Montant != 2500 || a.Lien != "/previsions?ct=CT1" || a.CTLibelle != "CT1 - Socle" || a.Statut != domain.AnomalieATraiter {
		t.Errorf("CT1 : %+v", a)
	}
	// Le montant est l'écart du plan (celui de la page Budget), même si la tendance est pire.
	if a.Titre != "Atterrissage · CT1 : dépassement prévu (+"+fmtEur(2500)+")" {
		t.Errorf("titre : %q", a.Titre)
	}
	if a.Detail != "Atterrissage prévu 12 500 € pour un budget de 10 000 € (tendance 15 000 €)" {
		t.Errorf("detail : %q", a.Detail)
	}
	if b.Key != "budget|CT2" || b.Gravite != 2 || *b.Montant != 800 {
		t.Errorf("CT2 (tendance plus défavorable) : %+v", b)
	}
	if b.Titre != "Atterrissage · CT2 : vigilance (tendance +"+fmtEur(800)+")" {
		t.Errorf("titre CT2 : %q", b.Titre)
	}
	// Empreinte stable, sensible aux chiffres.
	fp := a.Fingerprint
	if again := r.anomalies(&res); again[0].Fingerprint != fp {
		t.Error("empreinte instable")
	}
	res.Previsions.ParCT[0].AtterrissagePlan += 0.3 // arrondi à 1 € : inchangé
	if again := r.anomalies(&res); again[0].Fingerprint != fp {
		t.Error("empreinte sensible au centime")
	}
	res.Previsions.ParCT[0].AtterrissagePlan += 150
	if again := r.anomalies(&res); again[0].Fingerprint == fp {
		t.Error("empreinte inchangée malgré +150 €")
	}
}

func TestAnomaliesSeed(t *testing.T) {
	e := newEnv(t)
	e.seed()
	res := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	checkAnomalies(t, res.Anomalies)
	want := map[string]bool{
		"ecart|Y99F90001|DURAND Claire|sur_imputation": false,
		"ecart|Y99F900012|BARBIER Luc|hors_plan":       false,
		"ct_risque|Y99F900012":                         false,
		"derive|Y99F900012|5":                          false,
		"qualite|plan_warn":                            false,
	}
	for _, a := range res.Anomalies {
		if _, ok := want[a.Key]; ok {
			want[a.Key] = true
		}
		if a.Categorie == "correspondance" || a.Key == "qualite|fuzzy" {
			t.Errorf("catégorie supprimée : %s", a.Key)
		}
		switch a.Key {
		case "ecart|Y99F90001|DURAND Claire|sur_imputation":
			if a.Titre != "DURAND Claire · Y99F90001 : sur-imputation" || a.Detail != "1 semaine, écart cumulé +16 h (prévu 10 h, réel 26 h)" ||
				a.Lien != "/ecarts?ct=Y99F90001&ressource=DURAND+Claire&flag=sur_imputation" || a.Ressource != "DURAND Claire" {
				t.Errorf("écart DURAND Claire : %+v", a)
			}
		case "ecart|Y99F900012|BARBIER Luc|hors_plan":
			if a.Titre != "BARBIER Luc · Y99F900012 : hors plan" || a.Lien != "/ecarts?ct=Y99F900012&ressource=BARBIER+Luc&flag=hors_plan" {
				t.Errorf("hors plan BARBIER : %+v", a)
			}
		case "ct_risque|Y99F900012":
			if a.Gravite != 3 || *a.Montant != 15000 || a.Lien != "/budget?ct=Y99F900012" {
				t.Errorf("ct_risque : %+v", a)
			}
		case "derive|Y99F900012|5":
			if a.Gravite != 2 || *a.Montant != 15000 || a.Lien != "/realise/real1?tg=Y99F900012" {
				t.Errorf("derive : %+v", a)
			}
		case "qualite|plan_warn":
			if a.Lien != "/plan/plan1?statut=warn" || len(a.Details) != 1 {
				t.Errorf("plan_warn : %+v", a)
			}
		}
	}
	for k, ok := range want {
		if !ok {
			t.Errorf("anomalie absente : %s", k)
		}
	}
}
