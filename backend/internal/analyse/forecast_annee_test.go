package analyse

import (
	"reflect"
	"testing"

	"njord/internal/domain"
	"njord/internal/store"
)

// provDated: une provision datée (debut, fin ; "" = sans date).
func provDated(ct, ligneCout string, montant float64, debut, fin string) domain.ProvisionLine {
	p := provLine(ct, ligneCout, "Proj > "+ct, montant)
	p.DateDebut, p.DateFin = debut, fin
	return p
}

// TestPrevisionsProvisionsSecurisees: sécurisées datées dans / hors période, sans
// date, aléas jamais comptés ; placement dans la courbe plan (DECISIONS n° 23).
// as_of 01/10/2026 (W40), semaines pleines.
func TestPrevisionsProvisionsSecurisees(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	in := baseInput()
	onePlan(&in,
		fcLine("E", 0, 4000, "2026-10-05", "2026-10-30", "FRAIS"), // W41..W44, 1 000 €/sem.
		fcLine("L", 0, 1000, "2026-10-05", "2026-10-09", "FRAIS"), // W41
	)
	in.Entries = []domain.RealiseEntry{fcEntry("E", 2000, "2026-10-01"), fcEntry("L", 100, "2026-10-01")}
	in.Enveloppes = map[string]domain.Enveloppe{"E": fcEnv("2026-09-01", "2026-11-30", 20000)} // W36..W49
	in.Provisions = []domain.ProvisionLine{
		provDated("E", "CAPACITE SUR SITE", 1000, "2026-11-10", "2026-11-20"), // dans la période (W46)
		provDated("E", "FRAIS DE MISSION", 300, "", "2026-10-20"),             // date de fin seule, dans la période (W43)
		provDated("E", "CAPACITE SUR SITE", 500, "2027-02-01", "2027-02-28"),  // hors période
		provDated("E", "CAPACITE SUR SITE", 200, "", ""),                      // sans date : échéance (W49)
		provDated("E", "CAPACITE SUR SITE", 50, "2026-09-02", ""),             // dans la période mais avant as_of → W41
		provDated("E", "PROVISIONS POUR ALEAS", 7000, "2026-10-15", ""),       // aléas : jamais comptés
		provDated("E", " provisions  pour aleas", 1000, "", ""),               // aléas (canon : casse, espaces)
		provDated("L", "FRAIS DE MISSION", 400, "", ""),                       // sans enveloppe, sans date : dernière semaine
		provDated("L", "FRAIS DE MISSION", 600, "2030-01-01", ""),             // sans enveloppe : comptée même lointaine
		provDated("L", "PROVISIONS POUR ALEAS", 900, "", ""),
	}
	pv := Run(in, s).Previsions
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		checkBudget(t, p, s)
	}
	checkSynthese(t, pv)

	e := findCT(t, pv, "E")
	// Comptées : 1 000 + 300 + 200 + 50 = 1 550 ; hors : 500 ; aléas : 8 000.
	if e.Provisions != 10050 || e.ProvisionsSecurisees != 1550 || e.ProvisionsHorsEnveloppe != 500 || e.ProvisionsAleas != 8000 ||
		e.Consomme != 2000 || e.ResteAFaire != 4000 || e.AtterrissagePlan != 7550 || e.ProjectionPlanEcheance != 7550 ||
		fv(e.NonConsomme) != 12450 || fv(e.EcartPlan) != -12450 || !e.SousConsommation || fs(e.Statut) != domain.PrevisionOK {
		t.Errorf("E = %+v", e)
	}
	want := map[string]float64{
		"2026-W40": 2000,                     // as_of : plan = réel
		"2026-W41": 2000 + 1000 + 50,         // + provision passée reportée après as_of
		"2026-W43": 2000 + 3000 + 50 + 300,   // + provision datée par sa fin
		"2026-W45": 2000 + 4000 + 50 + 300,   // fin du plan
		"2026-W46": 2000 + 4000 + 1350,       // + 1 000 datée W46
		"2026-W48": 2000 + 4000 + 1350,       //
		"2026-W49": 2000 + 4000 + 1350 + 200, // + sans date à l'échéance
	}
	for w, v := range want {
		if pt := fcPoint(t, e, w); fv(pt.PlanCumul) != v {
			t.Errorf("E %s : plan_cumul %v, attendu %v", w, fv(pt.PlanCumul), v)
		}
	}

	// Sans enveloppe : toutes les sécurisées comptées ; l'axe va jusqu'à la plus tardive (2030-W01).
	l := findCT(t, pv, "L")
	if l.ProvisionsSecurisees != 1000 || l.ProvisionsAleas != 900 || l.ProvisionsHorsEnveloppe != 0 || l.AtterrissagePlan != 2100 {
		t.Errorf("L = %+v", l)
	}
	last := l.Series[len(l.Series)-1]
	if last.Week != "2030-W01" || fv(last.PlanCumul) != 2100 {
		t.Errorf("L dernier point = %+v", last)
	}
	if pt := fcPoint(t, l, "2029-W52"); fv(pt.PlanCumul) != 1100 {
		t.Errorf("L 2029-W52 = %v", fv(pt.PlanCumul))
	}

	// Global = E seul.
	if gl := pv.Global; gl.ProvisionsSecurisees != 1550 || gl.ProvisionsHorsEnveloppe != 500 || gl.ProvisionsAleas != 8000 || gl.AtterrissagePlan != 7550 {
		t.Errorf("global = %+v", gl)
	}
}

// TestBudgetClassificationEnveloppe: sécurisé = reste de la période + provisions
// sécurisées comptées (hors enveloppe exclues), non sécurisé = aléas (DECISIONS n° 23).
func TestBudgetClassificationEnveloppe(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	in := baseInput()
	onePlan(&in,
		fcLine("E", 0, 4000, "2026-10-05", "2026-10-30", "FRAIS"), // W41..W44
		fcLine("E", 0, 9000, "2027-01-04", "2027-01-08", "FRAIS"), // hors enveloppe
	)
	in.Entries = []domain.RealiseEntry{fcEntry("E", 2000, "2026-10-01")}
	in.Enveloppes = map[string]domain.Enveloppe{"E": fcEnv("2026-09-01", "2026-12-31", 20000)}
	in.Provisions = []domain.ProvisionLine{
		provDated("E", "CAPACITE SUR SITE", 1000, "2026-11-10", ""),
		provDated("E", "CAPACITE SUR SITE", 5000, "2027-03-01", ""), // hors enveloppe : ni sécurisé ni non sécurisé
		provDated("E", "PROVISIONS POUR ALEAS", 15000, "", ""),
	}
	res := Run(in, s)
	var b domain.BudgetCT
	for _, x := range res.Budget.ParCT {
		if x.CT == "E" {
			b = x
		}
	}
	if b.Securise != 5000 || b.NonSecurise != 15000 || fv(b.PctSecurite) != 25 || !b.Risque || b.Provisions != 21000 || b.PPSPlan != 13000 {
		t.Errorf("E = %+v", b)
	}
	if g := res.Budget.Global; g.Securise != 5000 || g.NonSecurise != 15000 || fv(g.PctNonSecurise) != 75 || !res.Alertes.AlerteGlobale ||
		fv(res.KPIs.PctSecurise) != 25 || res.KPIs.NbCTRisque != 1 {
		t.Errorf("global = %+v, alertes %+v", g, res.Alertes)
	}
}

// anneeScenario: dernier réalisé 01/10/2026 (W40), plan en effet au lundi suivant
// (date de référence 05/10, as_of 04/10, DECISIONS n° 31), sans fériés ni semaine verrouillée.
//   - Y : enveloppe 01/07/2026 → 30/06/2027 (365 j, 36 500 €) à cheval sur 2026 / 2027 ;
//     plan 1 000 €/sem. de 2026-W28 à 2027-W25 + 2 000 € en 2027-W27..W28 (hors période) ;
//   - Z : enveloppe 2026 seule ; N : sans enveloppe, en 2026 et 2027 ; O : plan 2025 seul.
func anneeScenario() (Input, domain.Settings) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	in := baseInput()
	onePlan(&in,
		fcLine("Y", 0, 51000, "2026-07-06", "2027-06-25", "FRAIS"), // 51 semaines pleines
		fcLine("Y", 0, 2000, "2027-07-05", "2027-07-16", "FRAIS"),
		fcLine("Z", 0, 1000, "2026-10-05", "2026-10-09", "FRAIS"),
		fcLine("N", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"),
		fcLine("N", 0, 500, "2027-02-01", "2027-02-05", "FRAIS"),
		fcLine("O", 0, 300, "2025-03-03", "2025-03-07", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		fcEntry("Y", 3000, "2026-09-08"), fcEntry("Y", 1000, "2026-10-01"),
		fcEntry("Y", 365, ""),           // sans date : au prorata des tranches
		fcEntry("Y", 500, "2026-06-15"), // avant l'enveloppe (2026)
		fcEntry("N", 100, "2026-09-15"), fcEntry("N", 50, ""),
	}
	in.Enveloppes = map[string]domain.Enveloppe{
		"Y": fcEnv("2026-07-01", "2027-06-30", 36500),
		"Z": fcEnv("2026-01-01", "2026-12-31", 5000),
	}
	in.Provisions = []domain.ProvisionLine{
		provDated("Y", "CAPACITE SUR SITE", 700, "2027-03-01", ""),
		provDated("Y", "CAPACITE SUR SITE", 3650, "", ""),
		provDated("Y", "PROVISIONS POUR ALEAS", 2000, "2026-11-02", ""),
		provDated("Y", "CAPACITE SUR SITE", 400, "2027-08-01", ""), // hors période, en 2027
	}
	refPlan(&in, "2026-10-05")
	return in, s
}

func TestPrevisionsAnnee(t *testing.T) {
	in, s := anneeScenario()
	res := Run(in, s)
	tout := res.Previsions
	if tout.Annee != 0 || !reflect.DeepEqual(tout.Annees, []int{2026, 2027}) {
		t.Errorf("annee %d, annees %v", tout.Annee, tout.Annees)
	}
	if got := RunPrevisions(in, s, 0); !reflect.DeepEqual(got, tout) {
		t.Error("RunPrevisions(0) ≠ Run().Previsions")
	}
	p26, p27 := RunPrevisions(in, s, 2026), RunPrevisions(in, s, 2027)
	if p26.Annee != 2026 || p27.Annee != 2027 || !reflect.DeepEqual(p26.Annees, tout.Annees) || p26.AsOf != tout.AsOf {
		t.Errorf("années : %d %d %v", p26.Annee, p27.Annee, p26.Annees)
	}
	for _, pv := range []domain.Previsions{tout, p26, p27} {
		for _, p := range append(pv.ParCT, pv.Global) {
			checkInvariants(t, p, pv.AsOf)
			checkBudget(t, p, s)
		}
		checkTri(t, pv.ParCT)
		checkSynthese(t, pv)
	}

	// « Tout » : Y sur toute sa période.
	y := findCT(t, tout, "Y")
	if y.Consomme != 4365 || y.ConsommeHorsEnveloppe != 500 || y.ResteAFaire != 38000 || y.PlanHorsEnveloppe != 2000 ||
		y.ProvisionsSecurisees != 4350 || y.ProvisionsHorsEnveloppe != 400 || y.ProvisionsAleas != 2000 || y.AtterrissagePlan != 46715 {
		t.Errorf("Y tout = %+v", y)
	}

	// 2026 : tranche 01/07/2026 → 03/01/2027 (dimanche de 2026-W53), 187 j ÷ 365 ; l'enveloppe se
	// poursuit en 2027 (DECISIONS n° 35) : jamais de non consommé en 2026, le dépassement reste suivi.
	y26 := findCT(t, p26, "Y")
	if y26.Poursuite != "2027-06-30" || fv(y26.NonConsomme) != 0 || y26.SousConsommation {
		t.Errorf("Y 2026 poursuite %q, non consommé %v, sous-consommation %v", y26.Poursuite, fv(y26.NonConsomme), y26.SousConsommation)
	}
	if y26.Enveloppe == nil || *y26.Enveloppe != (domain.Enveloppe{DateDebut: "2026-07-01", DateFin: "2027-01-03", Montant: 18700}) ||
		fv(y26.Budget) != 18700 || y26.Echeance != "2027-01-03" {
		t.Fatalf("Y 2026 enveloppe = %+v", y26.Enveloppe)
	}
	if y26.Consomme != 4187 || y26.ConsommeHorsEnveloppe != 500 || y26.PPS != 26000 || y26.ResteAFaire != 13000 || y26.PlanHorsEnveloppe != 0 ||
		y26.ProvisionsSecurisees != 1870 || y26.ProvisionsAleas != 2000 || y26.ProvisionsHorsEnveloppe != 0 || y26.Provisions != 3870 ||
		y26.AtterrissagePlan != 19057 || fv(y26.EcartPlan) != 357 || fs(y26.Statut) != domain.PrevisionDepassement ||
		y26.RythmeHebdo != 1000 || y26.SemainesEcheance != 13 || y26.AtterrissageTendance != 17187 {
		t.Errorf("Y 2026 = %+v", y26)
	}
	// Séries sur les semaines de 2026, cumulées depuis 0.
	if n := len(y26.Series); n != 53 || y26.Series[0].Week != "2026-W01" || y26.Series[n-1].Week != "2026-W53" ||
		y26.Series[0].BudgetCumul != 0 || fv(y26.Series[n-1].PlanCumul) != 19057 || y26.Series[n-1].BudgetCumul != 26000 {
		t.Errorf("Y 2026 séries : %d points, %+v … %+v", n, y26.Series[0], y26.Series[n-1])
	}

	// 2027 : l'enveloppe se termine en 2027 (DECISIONS n° 35) : prise entière, jugée à terminaison,
	// mêmes chiffres que « Tout » ; séries sur les semaines de 2027, cumulées depuis le début de l'enveloppe.
	y27 := findCT(t, p27, "Y")
	if y27.Enveloppe == nil || *y27.Enveloppe != (domain.Enveloppe{DateDebut: "2026-07-01", DateFin: "2027-06-30", Montant: 36500}) ||
		y27.Poursuite != "" {
		t.Fatalf("Y 2027 enveloppe = %+v, poursuite %q", y27.Enveloppe, y27.Poursuite)
	}
	if fv(y27.Budget) != fv(y.Budget) || y27.Consomme != y.Consomme || y27.ResteAFaire != y.ResteAFaire ||
		y27.ProvisionsSecurisees != y.ProvisionsSecurisees || y27.AtterrissagePlan != y.AtterrissagePlan ||
		fv(y27.EcartPlan) != fv(y.EcartPlan) || fv(y27.NonConsomme) != fv(y.NonConsomme) || fs(y27.Statut) != fs(y.Statut) {
		t.Errorf("Y 2027 ≠ tout : %+v", y27)
	}
	if len(y27.Series) != 52 || y27.Series[0].Week != "2027-W01" || y27.Series[0].ReelCumul != nil {
		t.Errorf("Y 2027 séries : %d points, %+v", len(y27.Series), y27.Series[0])
	}
	for _, w := range []string{"2027-W01", "2027-W09", "2027-W26"} {
		a, b := fcPoint(t, y27, w), fcPoint(t, y, w)
		if a.BudgetCumul != b.BudgetCumul || fv(a.PlanCumul) != fv(b.PlanCumul) {
			t.Errorf("Y %s : 2027 budget %v plan %v, tout %v / %v", w, a.BudgetCumul, fv(a.PlanCumul), b.BudgetCumul, fv(b.PlanCumul))
		}
	}

	// Z : 2026 entière (prorata 1) ; hors de 2027. O (plan 2025) hors des deux années.
	z26 := findCT(t, p26, "Z")
	if fv(z26.Budget) != 5000 || z26.ResteAFaire != 1000 || z26.Enveloppe.DateDebut != "2026-01-01" || z26.Enveloppe.DateFin != "2026-12-31" {
		t.Errorf("Z 2026 = %+v", z26)
	}
	for _, c := range []struct {
		pv  domain.Previsions
		out []string
	}{{p26, []string{"O"}}, {p27, []string{"O", "Z"}}} {
		for _, p := range c.pv.ParCT {
			for _, ct := range c.out {
				if p.CT == ct {
					t.Errorf("%d : %s ne doit pas apparaître", c.pv.Annee, ct)
				}
			}
		}
	}
	if len(tout.ParCT) != 4 || len(p26.ParCT) != 3 || len(p27.ParCT) != 2 {
		t.Errorf("par_ct : %d / %d / %d", len(tout.ParCT), len(p26.ParCT), len(p27.ParCT))
	}

	// N (sans enveloppe) : semaines de N seules, € sans date exclus, horizon borné à la fin de N.
	if p26.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, Consomme: 100, AtterrissagePlan: 2100, AtterrissageTendance: 425}) {
		t.Errorf("hors enveloppe 2026 = %+v", p26.HorsEnveloppe)
	}
	if p27.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, Consomme: 0, AtterrissagePlan: 500, AtterrissageTendance: 125}) {
		t.Errorf("hors enveloppe 2027 = %+v", p27.HorsEnveloppe)
	}
	if n := findCT(t, tout, "N"); n.Consomme != 150 || n.AtterrissagePlan != 2650 || n.AtterrissageTendance != 600 {
		t.Errorf("N tout = %+v", n)
	}

	// Global : 2026 = tranche de Y (qui se poursuit) + Z ; 2027 = Y entière (DECISIONS n° 35).
	g26, g27 := p26.Global, p27.Global
	if fv(g26.Budget) != 23700 || g26.Echeance != "2027-01-03" || len(g26.Series) != 53 || fv(g27.Budget) != 36500 ||
		g27.Echeance != "2027-06-30" || len(g27.Series) != 26 || g27.Series[25].Week != "2027-W26" ||
		fv(g27.Series[25].PlanCumul) != 46715 || p27.Enveloppes.NbConfigures != 1 || p27.Enveloppes.Montant != 36500 {
		t.Errorf("global 2026 %+v / 2027 %+v", g26, g27)
	}
	// Écart à terminaison 2026 : celui de Z (se termine en 2026) + le seul dépassement de la tranche de Y.
	if want := round2(fv(z26.EcartPlan) + max(0, fv(y26.EcartPlan))); fv(g26.EcartPlan) != want || p26.Enveloppes.Ecart != want ||
		p26.Enveloppes.NbPoursuite != 1 || p26.Enveloppes.MontantPoursuite != 18700 || p27.Enveloppes.NbPoursuite != 0 {
		t.Errorf("écart à terminaison 2026 %v (attendu %v), synthèse %+v", fv(g26.EcartPlan), want, p26.Enveloppes)
	}

	// Les anomalies, KPI et natures ne dépendent pas de l'année : AnalyseResult reste « Tout ».
	if res.Previsions.Annee != 0 {
		t.Errorf("AnalyseResult.previsions.annee = %d", res.Previsions.Annee)
	}
	// Année sans enveloppe (2030) : périmètre vide, CT sans enveloppe de l'année seuls.
	if p := RunPrevisions(in, s, 2030); p.Global.BudgetSource != "aucun" || len(p.ParCT) != 0 || p.Annee != 2030 {
		t.Errorf("2030 = %+v", p)
	}
}

func TestPrevisionsAnnees(t *testing.T) {
	s := store.DefaultSettings()
	in := baseInput() // Now = 05/10/2026
	onePlan(&in, fcLine("A", 0, 1000, "2026-09-07", "2026-09-11", "FRAIS"), fcLine("B", 0, 1000, "2026-09-07", "2026-09-11", "FRAIS"))
	if a := Run(in, s).Previsions.Annees; a == nil || len(a) != 0 {
		t.Errorf("sans enveloppe : %v", a)
	}
	// Sans réalisé : depuis l'année de Now, jusqu'à l'enveloppe la plus tardive (31/12/2028).
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-01-01", "2028-12-31", 1), "B": fcEnv("2026-01-01", "2027-03-01", 1),
		"Q": fcEnv("2026-01-01", "2035-01-01", 1)} // Q hors sources : ignoré
	if a := Run(in, s).Previsions.Annees; !reflect.DeepEqual(a, []int{2026, 2027, 2028}) {
		t.Errorf("annees = %v", a)
	}
	// Date de référence en 2027 (DECISIONS n° 31 : plan réactualisé en effet au
	// 01/02/2027) : on part de 2027, quel que soit le réalisé.
	plan := in.Plans
	reprev := PlanSource{Version: domain.Version{ID: "plan2027", Kind: domain.KindPlan, DateEffet: "2027-02-01"},
		Lines: []domain.PlanLine{fcLine("A", 0, 1000, "2027-02-01", "2027-02-05", "FRAIS")}}
	in.Plans = append(plan, reprev)
	in.Entries = []domain.RealiseEntry{fcEntry("A", 10, "2026-09-10")}
	if a := Run(in, s).Previsions.Annees; !reflect.DeepEqual(a, []int{2027, 2028}) {
		t.Errorf("annees (référence 2027) = %v", a)
	}
	// Réalisé en 2027 mais plan en effet en 2026 : on part de 2026.
	in.Plans = plan
	in.Entries = []domain.RealiseEntry{fcEntry("A", 10, "2027-02-10")}
	if a := Run(in, s).Previsions.Annees; !reflect.DeepEqual(a, []int{2026, 2027, 2028}) {
		t.Errorf("annees (référence 2026) = %v", a)
	}
	// Année ISO : le 03/01/2027 appartient à 2026-W53.
	in.Entries = nil
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-01-01", "2027-01-03", 1)}
	if a := Run(in, s).Previsions.Annees; !reflect.DeepEqual(a, []int{2026}) {
		t.Errorf("annees (fin 03/01/2027) = %v", a)
	}
	// Toutes les enveloppes finies avant l'année de la date de référence : aucune année proposée.
	in.Plans = append(plan, reprev)
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-01-01", "2026-06-30", 1)}
	if a := Run(in, s).Previsions.Annees; a == nil || len(a) != 0 {
		t.Errorf("enveloppes passées : %v", a)
	}
}

// TestPrevisionsETP: ETP planifiés (DECISIONS n° 25).
func TestPrevisionsETP(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = []string{"2026-12-25"}, []int{51}
	in := baseInput()
	mo := func(ct string, pct int, debut, fin string) domain.PlanLine {
		l := fcLine(ct, 10, 100, debut, fin, "MAIN D'OEUVRE SUR SITE")
		l.Pourcentage = pct
		return l
	}
	frais := fcLine("E", 0, 100, "2026-12-07", "2026-12-25", "FRAIS")
	frais.Pourcentage = 100 // hors mo_types : ignorée
	capa := mo("E", 20, "2026-12-14", "2026-12-18")
	capa.LigneCout = "capacite sur site" // mo_types (canon)
	onePlan(&in,
		mo("E", 50, "2026-12-07", "2026-12-25"), // W50..W52
		mo("E", 50, "2026-12-07", "2026-12-25"),
		mo("E", 100, "2026-12-09", "2026-12-11"), // mer → ven : 3 j sur 5
		frais, capa,
		mo("F", 100, "2026-12-07", "2026-12-11"), // CT sans enveloppe : hors du global
	)
	in.Entries = []domain.RealiseEntry{fcEntry("E", 10, "2026-12-01")}
	in.Enveloppes = map[string]domain.Enveloppe{"E": fcEnv("2026-12-01", "2026-12-31", 10000)}
	pv := Run(in, s).Previsions
	e := findCT(t, pv, "E")
	for w, want := range map[string]float64{
		"2026-W49": 0,   // avant les lignes
		"2026-W50": 1.6, // 0,5 + 0,5 + 0,6
		"2026-W51": 0,   // verrouillée : aucun jour ouvré (capacité 20 % comprise)
		"2026-W52": 1,   // 25/12 férié : 4 jours sur 4 jours ouvrés
	} {
		if pt := fcPoint(t, e, w); pt.ETP != want {
			t.Errorf("E %s : ETP %v, attendu %v", w, pt.ETP, want)
		}
	}
	if pt := fcPoint(t, findCT(t, pv, "F"), "2026-W50"); pt.ETP != 1 {
		t.Errorf("F W50 : ETP %v", pt.ETP)
	}
	// Global = Σ des CT du périmètre (E seul).
	if pt := fcPoint(t, pv.Global, "2026-W50"); pt.ETP != 1.6 {
		t.Errorf("global W50 : ETP %v", pt.ETP)
	}

	// Semaine non verrouillée : la capacité à 20 % compte.
	s.SemainesVerrouillees = nil
	if pt := fcPoint(t, findCT(t, Run(in, s).Previsions, "E"), "2026-W51"); pt.ETP != 1.2 {
		t.Errorf("E W51 non verrouillée : ETP %v", pt.ETP)
	}
}

// TestPrevisionsAnneeTerminaison: en année N, l'écart est évalué à la fin de
// l'enveloppe (DECISIONS n° 35). P (2026-07 → 2027-06) se poursuit en 2027 : sa
// tranche 2026 sous-consommée n'est ni non consommée ni en sous-consommation, et
// ne pèse pas sur l'écart du global. B (2025-10 → 2026-03) se termine en 2026 :
// prise entière, consommé 2025 compris, séries de 2026 parties du cumul de 2025.
func TestPrevisionsAnneeTerminaison(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	in := baseInput()
	onePlan(&in, fcLine("P", 0, 10000, "2026-10-05", "2026-10-30", "FRAIS"))
	refPlan(&in, "2026-10-01")
	in.Enveloppes = map[string]domain.Enveloppe{
		"P": fcEnv("2026-07-01", "2027-06-30", 100000),
		"B": fcEnv("2025-10-01", "2026-03-31", 10000),
	}
	in.Entries = []domain.RealiseEntry{fcEntry("B", 3000, "2025-11-12"), fcEntry("B", 2000, "2026-02-10")}
	pv := RunPrevisions(in, s, 2026)
	checkSynthese(t, pv)
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		checkBudget(t, p, s)
	}

	p := findCT(t, pv, "P")
	if p.Poursuite != "2027-06-30" || fv(p.NonConsomme) != 0 || p.SousConsommation || fv(p.EcartPlan) >= 0 ||
		fs(p.Statut) != domain.PrevisionOK {
		t.Errorf("P 2026 = poursuite %q, non consommé %v, sous-conso %v, écart %v", p.Poursuite, fv(p.NonConsomme), p.SousConsommation, fv(p.EcartPlan))
	}

	b := findCT(t, pv, "B")
	if b.Poursuite != "" || b.Enveloppe == nil || *b.Enveloppe != (domain.Enveloppe{DateDebut: "2025-10-01", DateFin: "2026-03-31", Montant: 10000}) ||
		b.Consomme != 5000 || fv(b.NonConsomme) != 5000 || fv(b.EcartPlan) != -5000 {
		t.Errorf("B 2026 = %+v", b)
	}
	if w1 := fcPoint(t, b, "2026-W01"); fv(w1.ReelCumul) != 3000 {
		t.Errorf("B 2026-W01 réel %v, attendu 3 000 (cumul 2025)", fv(w1.ReelCumul))
	}

	// Écart à terminaison : B seul (− 5 000) ; P n'y porterait que son dépassement.
	g := pv.Global
	if fv(g.EcartPlan) != -5000 || fv(g.NonConsomme) != 5000 || pv.Enveloppes.Ecart != -5000 ||
		pv.Enveloppes.NonConsomme != 5000 || pv.Enveloppes.NbPoursuite != 1 || g.Consomme != 5000 {
		t.Errorf("global 2026 : écart %v, non consommé %v, synthèse %+v", fv(g.EcartPlan), fv(g.NonConsomme), pv.Enveloppes)
	}
}
