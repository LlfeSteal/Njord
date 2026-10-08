package analyse

import (
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"njord/internal/domain"
	"njord/internal/plan"
	"njord/internal/realise"
	"njord/internal/store"
)

func near(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

func demoInput(t *testing.T) Input {
	return demoInputWith(t, "../../../test_data_demo/demo_plancharge.xlsx", "../../../test_data_demo/demo_realise.xlsx")
}

// demoInputWith croise le plan et le réalisé donnés (fichiers au format démo).
func demoInputWith(t *testing.T, planPath, realisePath string) Input {
	t.Helper()
	pd, err := os.ReadFile(planPath)
	if err != nil {
		t.Fatalf("lecture plan démo : %v", err)
	}
	rd, err := os.ReadFile(realisePath)
	if err != nil {
		t.Fatalf("lecture réalisé démo : %v", err)
	}
	pr, err := plan.Parse(pd)
	if err != nil {
		t.Fatal(err)
	}
	rr, err := realise.Parse(rd)
	if err != nil {
		t.Fatal(err)
	}
	in := baseInput()
	var lines []domain.PlanLine
	for _, l := range pr.Lines {
		lines = append(lines, l.PlanLine)
	}
	onePlan(&in, lines...)
	in.Entries = rr.Entries
	return in
}

// checkInvariants verifies the cross-field consistency of one forecast.
func checkInvariants(t *testing.T, p domain.PrevisionCT, asOf string) {
	t.Helper()
	if !near(p.AtterrissagePlan, p.Consomme+p.ResteAFaire, 0.02) {
		t.Errorf("%s : atterrissage plan %v ≠ consommé %v + reste %v", p.CT, p.AtterrissagePlan, p.Consomme, p.ResteAFaire)
	}
	if !near(p.EcartPlan, p.AtterrissagePlan-p.Budget, 0.02) || !near(p.EcartTendance, p.AtterrissageTendance-p.Budget, 0.02) {
		t.Errorf("%s : écarts incohérents %+v", p.CT, p)
	}
	if p.Series == nil {
		t.Fatalf("%s : séries nil", p.CT)
	}
	if len(p.Series) == 0 {
		return
	}
	last := p.Series[len(p.Series)-1]
	if last.PlanCumul == nil || !near(*last.PlanCumul, p.AtterrissagePlan, 0.02) {
		t.Errorf("%s : dernier plan_cumul %v ≠ atterrissage %v", p.CT, last.PlanCumul, p.AtterrissagePlan)
	}
	if last.TendanceCumul == nil || !near(*last.TendanceCumul, p.AtterrissageTendance, 0.05) {
		t.Errorf("%s : dernier tendance_cumul %v ≠ atterrissage tendance %v", p.CT, last.TendanceCumul, p.AtterrissageTendance)
	}
	asWeek := WeekOfDate(asOf)
	for _, pt := range p.Series {
		switch {
		case asWeek == "":
			if pt.ReelCumul != nil || pt.PlanCumul == nil {
				t.Errorf("%s %s : sans réalisé, réel nul et plan défini attendus", p.CT, pt.Week)
			}
		case pt.Week < asWeek:
			if pt.ReelCumul == nil || pt.PlanCumul != nil || pt.TendanceCumul != nil || pt.HeuresReel == nil {
				t.Errorf("%s %s : avant as_of, réel seul attendu", p.CT, pt.Week)
			}
		case pt.Week == asWeek:
			if pt.ReelCumul == nil || pt.PlanCumul == nil || *pt.PlanCumul != *pt.ReelCumul || !near(*pt.ReelCumul, p.Consomme, 0.02) {
				t.Errorf("%s %s : à as_of, plan = réel = consommé attendu (%v)", p.CT, pt.Week, p.Consomme)
			}
		default:
			if pt.ReelCumul != nil || pt.HeuresReel != nil || pt.PlanCumul == nil {
				t.Errorf("%s %s : après as_of, projection seule attendue", p.CT, pt.Week)
			}
		}
	}
}

func TestPrevisionsDemo(t *testing.T) {
	in := demoInput(t)
	res := Run(in, store.DefaultSettings())
	pv := res.Previsions

	budget, conso := 0.0, 0.0
	for _, l := range in.Plans[0].Lines {
		if l.StatutParsing != domain.ParsingDrop {
			budget += l.PPS
		}
	}
	for _, e := range in.Entries {
		if e.StatutParsing != domain.ParsingDrop {
			conso += e.TotalEur
		}
	}
	if pv.AsOf != "2026-10-03" || pv.AsOfWeek != "2026-W40" {
		t.Fatalf("as_of = %q / %q", pv.AsOf, pv.AsOfWeek)
	}
	gl := pv.Global
	if gl.CT != "" || gl.CTLibelle != "Périmètre" {
		t.Errorf("global = %q / %q", gl.CT, gl.CTLibelle)
	}
	if !near(gl.Budget, budget, 0.01) || !near(gl.Budget, 1014062.10, 1) {
		t.Errorf("budget global = %v, Σ PPS = %v", gl.Budget, budget)
	}
	if !near(gl.Consomme, conso, 0.01) {
		t.Errorf("consommé global = %v, Σ TotalEur = %v", gl.Consomme, conso)
	}
	checkInvariants(t, gl, pv.AsOf)
	last := gl.Series[len(gl.Series)-1]
	if !near(last.BudgetCumul, gl.Budget, 1) {
		t.Errorf("budget_cumul final %v ≠ budget %v", last.BudgetCumul, gl.Budget)
	}
	if gl.Statut != fcStatut(fcCalc{budget: gl.Budget, consomme: gl.Consomme, atterPlan: gl.AtterrissagePlan, atterTend: gl.AtterrissageTendance}) {
		t.Errorf("statut global incohérent : %+v", gl)
	}

	nb := map[domain.PrevisionStatut]int{}
	sumB, sumC := 0.0, 0.0
	for i, p := range pv.ParCT {
		checkInvariants(t, p, pv.AsOf)
		nb[p.Statut]++
		sumB += p.Budget
		sumC += p.Consomme
		if len(p.Series) != len(gl.Series) {
			t.Errorf("%s : axe de %d semaines ≠ global %d", p.CT, len(p.Series), len(gl.Series))
		}
		if i > 0 {
			a := pv.ParCT[i-1]
			rank := map[domain.PrevisionStatut]int{domain.PrevisionDepassement: 0, domain.PrevisionVigilance: 1, domain.PrevisionOK: 2}
			if rank[a.Statut] > rank[p.Statut] || (a.Statut == p.Statut && a.EcartPlan < p.EcartPlan) {
				t.Errorf("tri : %s (%s, %v) avant %s (%s, %v)", a.CT, a.Statut, a.EcartPlan, p.CT, p.Statut, p.EcartPlan)
			}
		}
	}
	t.Logf("as_of %s · budget %.2f · consommé %.2f · reste %.2f · atterrissage plan %.2f · tendance %.2f (rythme %.2f × %d) · statut %s · par statut %v · %d semaines (%s → %s)",
		pv.AsOf, gl.Budget, gl.Consomme, gl.ResteAFaire, gl.AtterrissagePlan, gl.AtterrissageTendance, gl.RythmeHebdo,
		gl.SemainesRestantes, gl.Statut, nb, len(gl.Series), gl.Series[0].Week, last.Week)
	// Fin d'exercice (DECISIONS n° 17) : 31/12 de l'année de as_of, 13 semaines W41..W53.
	if gl.Echeance != "2026-12-31" || gl.SemainesEcheance != 13 {
		t.Errorf("échéance globale %q, %d semaines", gl.Echeance, gl.SemainesEcheance)
	}
	for _, p := range append(pv.ParCT, gl) {
		checkEcheance(t, p, store.DefaultSettings())
	}
	t.Logf("échéance %s · budget exercice %.2f · projection plan %.2f · tendance %.2f · non consommé %.2f (%s) · sous-conso %v",
		gl.Echeance, gl.BudgetEcheance, gl.ProjectionPlanEcheance, gl.ProjectionTendanceEcheance, gl.NonConsomme, gl.NonConsommeSource, gl.SousConsommation)
	for _, p := range pv.ParCT {
		t.Logf("  %s %-12s budget %10.2f conso %10.2f reste %10.2f plan %10.2f tend %10.2f fin %s", p.CT, p.Statut, p.Budget, p.Consomme, p.ResteAFaire, p.AtterrissagePlan, p.AtterrissageTendance, p.FinPlan)
	}
}

// fcLine: a plan line with explicit dates, PPS and cost line.
func fcLine(ct string, charge, pps float64, debut, fin, ligneCout string) domain.PlanLine {
	l := planLine(ct, "R1", "DURAND Claire", nil, charge)
	l.PPS, l.DateDebut, l.DateFin, l.LigneCout = pps, debut, fin, ligneCout
	return l
}

func fcEntry(ct string, eur float64, date string) domain.RealiseEntry {
	e := cost(ct, "FRAIS DIVERS", "FRAIS", eur)
	e.DateDepense = date
	return e
}

func findCT(t *testing.T, pv domain.Previsions, ct string) domain.PrevisionCT {
	t.Helper()
	for _, p := range pv.ParCT {
		if p.CT == ct {
			return p
		}
	}
	t.Fatalf("CT %s absent", ct)
	return domain.PrevisionCT{}
}

func TestPrevisionsSynthetique(t *testing.T) {
	in := baseInput()
	onePlan(&in,
		// A : 4 semaines W37..W40 (20 j ouvrés), 1 000 €/semaine ; consommé 3 000 € → ok.
		fcLine("A", 80, 4000, "2026-09-07", "2026-10-02", "MAIN D'OEUVRE SUR SITE"),
		// B : sans réalisé, W41..W42, 2 000 €.
		fcLine("B", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"),
		// D : dépassement, budget 1 000 € (W38), consommé 1 500 €.
		fcLine("D", 10, 1000, "2026-09-14", "2026-09-18", "MAIN D'OEUVRE SUR SITE"),
		// E : tendance — 10 000 € sur W37..W44, rythme récent élevé.
		fcLine("E", 0, 8000, "2026-09-07", "2026-10-30", "FRAIS"),
		// F : dates invalides → PPS hors série mais dans le budget.
		fcLine("F", 0, 500, "", "", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		mo("A", "DURAND Claire", 10, "2026-09-08"), // 1 000 € W37
		mo("A", "DURAND Claire", 20, "2026-10-01"), // 2 000 € W40
		fcEntry("D", 1500, "2026-09-15"),
		fcEntry("E", 2000, "2026-09-29"), // W40
		fcEntry("E", 2000, "2026-09-22"), // W39
		fcEntry("X", 300, "2026-10-03"),  // CT hors plan, as_of
	}
	pv := Run(in, store.DefaultSettings()).Previsions
	if pv.AsOf != "2026-10-03" || pv.AsOfWeek != "2026-W40" {
		t.Fatalf("as_of = %q / %q", pv.AsOf, pv.AsOfWeek)
	}
	a := findCT(t, pv, "A")
	if a.Budget != 4000 || a.Consomme != 3000 || a.ResteAFaire != 0 || a.AtterrissagePlan != 3000 || a.Statut != domain.PrevisionOK ||
		a.PctConsomme == nil || *a.PctConsomme != 75 || a.FinPlan != "2026-10-02" || a.SemainesRestantes != 0 || a.RythmeHebdo != 750 {
		t.Errorf("A = %+v", a)
	}
	var w38 *domain.PrevisionPoint
	for i := range a.Series {
		if a.Series[i].Week == "2026-W38" {
			w38 = &a.Series[i]
		}
	}
	if w38 == nil || w38.BudgetCumul != 2000 || w38.HeuresPlan != 20 || w38.ReelCumul == nil || *w38.ReelCumul != 1000 || *w38.HeuresReel != 0 {
		t.Errorf("A W38 = %+v", w38)
	}

	b := findCT(t, pv, "B")
	if b.Consomme != 0 || b.ResteAFaire != 2000 || b.AtterrissagePlan != 2000 || b.Statut != domain.PrevisionVigilance ||
		b.SemainesRestantes != 2 || b.RythmeHebdo != 0 || b.AtterrissageTendance != 0 {
		t.Errorf("B = %+v", b) // atterrissage plan = 100 % du budget > 95 % → vigilance
	}

	d := findCT(t, pv, "D")
	if d.Statut != domain.PrevisionDepassement || d.EcartPlan != 500 {
		t.Errorf("D = %+v", d)
	}

	e := findCT(t, pv, "E")
	// 8 semaines × 1 000 € ; reste W41..W44 = 4 000 € ; atterrissage plan 8 000 € = budget → vigilance.
	// Rythme = (2 000 + 2 000) / 4 = 1 000 ; 4 semaines restantes → tendance 8 000.
	if e.ResteAFaire != 4000 || e.AtterrissagePlan != 8000 || e.RythmeHebdo != 1000 || e.SemainesRestantes != 4 ||
		e.AtterrissageTendance != 8000 || e.Statut != domain.PrevisionVigilance {
		t.Errorf("E = %+v", e)
	}

	f := findCT(t, pv, "F")
	if f.Budget != 500 || f.ResteAFaire != 0 || f.Statut != domain.PrevisionOK || f.FinPlan != "" {
		t.Errorf("F = %+v", f)
	}

	x := findCT(t, pv, "X")
	if x.Budget != 0 || x.Consomme != 300 || x.PctConsomme != nil || x.Statut != domain.PrevisionDepassement {
		t.Errorf("X = %+v", x)
	}

	if pv.ParCT[0].CT != "D" || pv.ParCT[1].CT != "X" {
		t.Errorf("tri : %s, %s", pv.ParCT[0].CT, pv.ParCT[1].CT)
	}
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
	}
	gl := pv.Global
	if gl.Budget != 15500 || gl.Consomme != 8800 || gl.ResteAFaire != 6000 || gl.Series[0].Week != "2026-W37" ||
		gl.Series[len(gl.Series)-1].Week != "2026-W44" || gl.FinPlan != "2026-10-30" {
		t.Errorf("global = %+v", gl)
	}
}

func TestPrevisionsTendance(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil // 10 semaines pleines W37..W46
	in := baseInput()
	// 10 000 € sur W37..W46 (1 000 €/semaine) ; consommation récente 2 000 €/semaine.
	onePlan(&in, fcLine("T", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	for _, d := range []string{"2026-09-14", "2026-09-21", "2026-09-28", "2026-10-02"} {
		in.Entries = append(in.Entries, fcEntry("T", 2000, d))
	}
	pv := Run(in, s).Previsions
	p := findCT(t, pv, "T")
	// W38..W40 consommées (4 écritures, W40 deux fois) : 8 000 € ; rythme = 8 000 / 4 = 2 000 ; 6 semaines restantes.
	if p.Consomme != 8000 || p.RythmeHebdo != 2000 || p.SemainesRestantes != 6 || p.AtterrissageTendance != 20000 ||
		p.ResteAFaire != 6000 || p.AtterrissagePlan != 14000 || p.Statut != domain.PrevisionDepassement {
		t.Errorf("T = %+v", p)
	}
	checkInvariants(t, p, pv.AsOf)
	// tendance_cumul : +2 000 € par semaine après as_of.
	for _, pt := range p.Series {
		if pt.Week == "2026-W42" && (pt.TendanceCumul == nil || *pt.TendanceCumul != 12000 || *pt.PlanCumul != 10000) {
			t.Errorf("W42 = %+v", pt)
		}
	}

	// Plan à 90 % du budget mais rythme récent au-delà → vigilance.
	// as_of W44 : consommé 7 000 € sur W41..W44, reste W45..W46 = 2 000 € ; tendance 7 000 + 1 750 × 2.
	in.Entries = nil
	for _, d := range []string{"2026-10-06", "2026-10-13", "2026-10-20", "2026-10-30"} {
		in.Entries = append(in.Entries, fcEntry("T", 1750, d))
	}
	p = findCT(t, Run(in, s).Previsions, "T")
	if p.AtterrissagePlan != 9000 || p.RythmeHebdo != 1750 || p.SemainesRestantes != 2 || p.AtterrissageTendance != 10500 ||
		p.Statut != domain.PrevisionVigilance {
		t.Errorf("T vigilance = %+v", p)
	}
}

func TestPrevisionsSansRealise(t *testing.T) {
	in := baseInput()
	onePlan(&in, fcLine("A", 40, 2000, "2026-09-07", "2026-09-18", "MAIN D'OEUVRE SUR SITE"))
	pv := Run(in, store.DefaultSettings()).Previsions
	if pv.AsOf != "" || pv.AsOfWeek != "" {
		t.Fatalf("as_of = %q", pv.AsOf)
	}
	gl := pv.Global
	if gl.Consomme != 0 || gl.ResteAFaire != 2000 || gl.AtterrissagePlan != 2000 || gl.AtterrissageTendance != 0 ||
		gl.SemainesRestantes != 2 || len(gl.Series) != 2 || gl.Series[1].HeuresPlan != 20 {
		t.Errorf("global = %+v", gl)
	}
	checkInvariants(t, gl, "")

	// Ni plan ni réalisé : structures vides mais jamais nil.
	pv = Run(baseInput(), store.DefaultSettings()).Previsions
	if pv.ParCT == nil || len(pv.ParCT) != 0 || pv.Global.Series == nil || pv.Global.Statut != domain.PrevisionOK {
		t.Errorf("vide = %+v", pv)
	}
}

// provLine: une ligne de provision (DECISIONS n° 16).
func provLine(ct, ligneCout, groupe string, montant float64) domain.ProvisionLine {
	rowSeq++
	return domain.ProvisionLine{RowNum: rowSeq, CT: ct, Libelle: "Provision " + ct, Montant: montant, Unite: "EURO",
		LigneCout: ligneCout, TypeDepense: "Standard", DateDebut: "2026-12-30", DateFin: "2026-12-31", Groupe: groupe,
		StatutParsing: domain.ParsingOK}
}

func TestPrevisionsProvisions(t *testing.T) {
	in := baseInput()
	onePlan(&in,
		fcLine("A", 80, 4000, "2026-09-07", "2026-10-02", "MAIN D'OEUVRE SUR SITE"),
		// D : budget 1 000 €, consommé 1 500 € → dépassement sans provisions.
		fcLine("D", 10, 1000, "2026-09-14", "2026-09-18", "MAIN D'OEUVRE SUR SITE"),
		// B : sans réalisé, 2 000 € → vigilance (100 % du budget) sans provisions.
		fcLine("B", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		mo("A", "DURAND Claire", 30, "2026-09-08"),
		fcEntry("D", 1500, "2026-09-15"),
		fcEntry("X", 300, "2026-10-03"), // hors plan : dépassement sans provisions
	}
	s := store.DefaultSettings()
	sans := Run(in, s).Previsions

	drop := provLine("A", "CAPACITE SUR SITE", "Proj > A", 99999)
	drop.StatutParsing = domain.ParsingDrop
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	in.Provisions = []domain.ProvisionLine{
		provLine("D", "CAPACITE SUR SITE", "Proj > Squad D", 600),
		provLine("B", "PROVISIONS POUR ALEAS", "Proj > Squad B", 1000),
		provLine("X", "FRAIS DE MISSION", "Proj > Missions", 1000),
		provLine("P", "CAPACITE SUR SITE", "Réserve > Fonds de transformation", 1500),
		provLine("P", "FRAIS ACHATS CAPACITE SUR SITE", "Réserve > Autre libellé", 500),
		provLine("", "FRAIS DE MISSION", "", 50), // sans CT : global seulement
		drop,
	}
	res := Run(in, s)
	pv := res.Previsions
	if res.Meta.ProvisionVersion == nil || res.Meta.ProvisionVersion.ID != "prov1" {
		t.Errorf("meta.provision_version = %+v", res.Meta.ProvisionVersion)
	}

	d := findCT(t, pv, "D")
	// Charge max 1 600 € ; atterrissage 1 500 € < 95 % → ok ; l'atterrissage ne contient pas les provisions.
	if d.PPS != 1000 || d.Provisions != 600 || d.Budget != 1600 || d.AtterrissagePlan != 1500 || d.ResteAFaire != 0 ||
		d.EcartPlan != -100 || d.Statut != domain.PrevisionOK || d.PctConsomme == nil || *d.PctConsomme != 93.75 {
		t.Errorf("D = %+v", d)
	}
	b := findCT(t, pv, "B")
	if b.Budget != 3000 || b.ResteAFaire != 2000 || b.AtterrissagePlan != 2000 || b.Statut != domain.PrevisionOK {
		t.Errorf("B = %+v", b)
	}
	x := findCT(t, pv, "X")
	if x.PPS != 0 || x.Provisions != 1000 || x.Budget != 1000 || x.Consomme != 300 || x.Statut != domain.PrevisionOK {
		t.Errorf("X = %+v", x)
	}
	// CT présent seulement dans les provisions : libellé = sous-projet de la 1re ligne.
	p := findCT(t, pv, "P")
	if p.CTLibelle != "Fonds de transformation" || p.PPS != 0 || p.Provisions != 2000 || p.Budget != 2000 || p.Consomme != 0 ||
		p.ResteAFaire != 0 || p.AtterrissagePlan != 0 || p.Statut != domain.PrevisionOK || p.FinPlan != "" || p.SemainesRestantes != 0 {
		t.Errorf("P = %+v", p)
	}
	for _, c := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, c, pv.AsOf)
		checkEcheance(t, c, s)
		if c.ProvisionsEcheance != c.Provisions { // provisions datées du 30/12 : dans l'exercice
			t.Errorf("%s : provisions de l'exercice %v ≠ %v", c.CT, c.ProvisionsEcheance, c.Provisions)
		}
		if !near(c.Budget, c.PPS+c.Provisions, 0.02) {
			t.Errorf("%s : budget %v ≠ pps %v + provisions %v", c.CT, c.Budget, c.PPS, c.Provisions)
		}
	}

	// Global : budget = Σ PPS + Σ provisions (lignes sans CT comprises, drop exclue) ;
	// reste, atterrissages et budget_cumul inchangés.
	gl, gs := pv.Global, sans.Global
	if gl.PPS != 7000 || gl.Provisions != 4650 || gl.Budget != 11650 || gs.Budget != 7000 || gs.Provisions != 0 || gs.PPS != 7000 {
		t.Errorf("global = pps %v provisions %v budget %v (sans : %v)", gl.PPS, gl.Provisions, gl.Budget, gs.Budget)
	}
	if gl.ResteAFaire != gs.ResteAFaire || gl.AtterrissagePlan != gs.AtterrissagePlan || gl.AtterrissageTendance != gs.AtterrissageTendance ||
		gl.Consomme != gs.Consomme || len(gl.Series) != len(gs.Series) {
		t.Errorf("les provisions ne doivent changer ni reste ni atterrissage : %+v / %+v", gl, gs)
	}
	for i := range gl.Series {
		if gl.Series[i].BudgetCumul != gs.Series[i].BudgetCumul {
			t.Errorf("budget_cumul %s : %v ≠ %v (plan seul)", gl.Series[i].Week, gl.Series[i].BudgetCumul, gs.Series[i].BudgetCumul)
		}
	}
	// Sans provisions : statuts antérieurs.
	if findCT(t, sans, "D").Statut != domain.PrevisionDepassement || findCT(t, sans, "X").Statut != domain.PrevisionDepassement ||
		findCT(t, sans, "B").Statut != domain.PrevisionVigilance {
		t.Error("statuts sans provisions modifiés")
	}
	for _, c := range sans.ParCT {
		if c.CT == "P" {
			t.Error("CT P sans provisions : ne doit pas apparaître")
		}
	}
	// Anomalies budget : X n'est plus « hors budget », plus d'anomalie pour D.
	for _, a := range res.Anomalies {
		if a.Categorie == domain.AnomalieBudget && (a.CT == "D" || a.CT == "X" || a.CT == "P") {
			t.Errorf("anomalie budget inattendue : %+v", a)
		}
	}
}

// checkEcheance verifies the end-of-fiscal-year figures (DECISIONS n° 17).
func checkEcheance(t *testing.T, p domain.PrevisionCT, s domain.Settings) {
	t.Helper()
	if p.Echeance == "" || !near(p.BudgetEcheance, p.PPSEcheance+p.ProvisionsEcheance, 0.02) {
		t.Errorf("%s : échéance %q, budget_echeance %v ≠ pps %v + provisions %v", p.CT, p.Echeance, p.BudgetEcheance, p.PPSEcheance, p.ProvisionsEcheance)
	}
	if !near(p.ProjectionTendanceEcheance, p.Consomme+p.RythmeHebdo*float64(p.SemainesEcheance), 0.02+0.005*float64(p.SemainesEcheance)) {
		t.Errorf("%s : projection tendance %v incohérente", p.CT, p.ProjectionTendanceEcheance)
	}
	worst := math.Min(p.ProjectionPlanEcheance, p.ProjectionTendanceEcheance)
	if !near(p.NonConsomme, math.Max(0, p.BudgetEcheance-worst), 0.03) {
		t.Errorf("%s : non consommé %v ≠ %v − %v", p.CT, p.NonConsomme, p.BudgetEcheance, worst)
	}
	if (p.NonConsomme == 0) != (p.NonConsommeSource == "") {
		t.Errorf("%s : source %q pour non consommé %v", p.CT, p.NonConsommeSource, p.NonConsomme)
	}
	if p.SousConsommation != (p.NonConsomme > s.SeuilSousConsoPct/100*p.BudgetEcheance+fcTolerance && p.NonConsomme > s.SeuilSousConsoEur+fcTolerance) {
		t.Errorf("%s : sous-consommation %v incohérente (%v / %v)", p.CT, p.SousConsommation, p.NonConsomme, p.BudgetEcheance)
	}
}

func TestPrevisionsEcheance(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in,
		// S : 10 000 € sur W37..W46 (1 000 €/sem.), 2 000 € en 2027 (exercice suivant), 500 € hors série.
		fcLine("S", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"),
		fcLine("S", 0, 2000, "2027-01-11", "2027-01-22", "FRAIS"),
		fcLine("S", 0, 500, "", "", "FRAIS"),
		// T : 10 000 € sur W41..W50, consommation récente faible → tendance la plus basse.
		fcLine("T", 0, 10000, "2026-10-05", "2026-12-11", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		fcEntry("S", 500, "2026-09-08"), fcEntry("S", 500, "2026-09-15"),
		fcEntry("S", 500, "2026-09-22"), fcEntry("S", 500, "2026-09-29"),
		fcEntry("T", 400, "2026-10-02"), // as_of W40
	}
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	p1 := provLine("S", "CAPACITE SUR SITE", "Proj > S", 3000)
	p1.DateDebut = "2026-11-01"
	p2 := provLine("S", "CAPACITE SUR SITE", "Proj > S", 4000)
	p2.DateDebut = "2027-01-15" // exercice suivant : hors budget de l'exercice, dans le budget
	p3 := provLine("S", "PROVISIONS POUR ALEAS", "Proj > S", 1000)
	p3.DateDebut = "" // sans date : dans l'exercice
	in.Provisions = []domain.ProvisionLine{p1, p2, p3}
	res := Run(in, s)
	pv := res.Previsions
	if pv.AsOf != "2026-10-02" {
		t.Fatalf("as_of = %q", pv.AsOf)
	}

	// S : échéance 31/12/2026 (W53) → 13 semaines W41..W53.
	sc := findCT(t, pv, "S")
	if sc.Budget != 20500 || sc.PPS != 12500 || sc.Provisions != 8000 || sc.AtterrissagePlan != 10000 || sc.Statut != domain.PrevisionOK {
		t.Errorf("S (chiffres n° 16 modifiés) = %+v", sc)
	}
	if sc.Echeance != "2026-12-31" || sc.PPSEcheance != 10500 || sc.ProvisionsEcheance != 4000 || sc.BudgetEcheance != 14500 ||
		sc.SemainesEcheance != 13 || sc.ProjectionPlanEcheance != 8000 || sc.ProjectionTendanceEcheance != 8500 ||
		sc.NonConsomme != 6500 || sc.NonConsommeSource != "plan" || sc.RythmeNecessaire != 961.54 || !sc.SousConsommation {
		t.Errorf("S échéance = %+v", sc)
	}
	// T : tendance 400 + 100 × 13 = 1 700 < plan 10 400 → non consommé 8 300 (tendance).
	tc := findCT(t, pv, "T")
	if tc.Statut != domain.PrevisionDepassement || tc.BudgetEcheance != 10000 || tc.ProjectionPlanEcheance != 10400 ||
		tc.ProjectionTendanceEcheance != 1700 || tc.NonConsomme != 8300 || tc.NonConsommeSource != "tendance" ||
		tc.RythmeNecessaire != 738.46 || !tc.SousConsommation {
		t.Errorf("T échéance = %+v", tc)
	}
	// Global = enveloppe commune : 24 500 − min(18 400, 10 200) = 14 300 (≠ Σ CT = 14 800).
	gl := pv.Global
	if gl.Echeance != "2026-12-31" || gl.BudgetEcheance != 24500 || gl.ProvisionsEcheance != 4000 || gl.SemainesEcheance != 13 ||
		gl.ProjectionPlanEcheance != 18400 || gl.ProjectionTendanceEcheance != 10200 || gl.NonConsomme != 14300 ||
		gl.NonConsommeSource != "tendance" || !gl.SousConsommation {
		t.Errorf("global échéance = %+v", gl)
	}
	for _, p := range append(pv.ParCT, gl) {
		checkEcheance(t, p, s)
		checkInvariants(t, p, pv.AsOf)
	}

	// Anomalies : sous-consommation en plus du dépassement de T.
	byKey := map[string]domain.Anomalie{}
	for _, a := range res.Anomalies {
		byKey[a.Key] = a
	}
	checkAnomalies(t, res.Anomalies)
	if _, ok := byKey["budget|T"]; !ok {
		t.Error("anomalie de dépassement de T absente")
	}
	a, ok := byKey["budget_sous_conso|S"]
	nb := func(s string) string { return strings.ReplaceAll(s, " ", " ") }
	if !ok || a.Categorie != domain.AnomalieBudget || a.Gravite != 2 || a.Montant == nil || *a.Montant != 6500 ||
		a.Lien != "/previsions?ct=S" || a.CT != "S" ||
		nb(a.Titre) != "Sous-consommation · S : 6 500 € non consommés au 31/12/2026 (45 %)" ||
		nb(a.Detail) != "Budget de l'exercice 14 500 € (PDC 10 500 € + provisions 4 000 €) ; projection plan 8 000 €, tendance 8 500 € ; il faudrait 962 €/sem contre 500 €/sem" {
		t.Errorf("anomalie S = %+v", a)
	}
	if a, ok := byKey["budget_sous_conso|T"]; !ok || strings.Contains(a.Detail, "provisions") ||
		nb(a.Titre) != "Sous-consommation · T : 8 300 € non consommés au 31/12/2026 (83 %)" {
		t.Errorf("anomalie T = %+v", a)
	}
	// L'empreinte suit budget de l'exercice et projections.
	in.Entries = append(in.Entries, fcEntry("S", 100, "2026-09-30"))
	for _, a2 := range Run(in, s).Anomalies {
		if a2.Key == "budget_sous_conso|S" && a2.Fingerprint == byKey["budget_sous_conso|S"].Fingerprint {
			t.Error("empreinte inchangée malgré des projections modifiées")
		}
	}
}

func TestPrevisionsEcheancePassee(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	s.FinExercice = "2026-09-20" // W38 < as_of W40
	in := baseInput()
	onePlan(&in, fcLine("S", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	in.Entries = []domain.RealiseEntry{fcEntry("S", 500, "2026-09-08"), fcEntry("S", 1500, "2026-10-02")}
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	in.Provisions = []domain.ProvisionLine{provLine("S", "CAPACITE SUR SITE", "Proj > S", 3000)} // datée 30/12 : après l'échéance
	pv := Run(in, s).Previsions
	p := findCT(t, pv, "S")
	// Budget de l'exercice = W37..W38 = 2 000 € ; projections = consommé 2 000 €.
	if p.Echeance != "2026-09-20" || p.SemainesEcheance != 0 || p.PPSEcheance != 2000 || p.ProvisionsEcheance != 0 ||
		p.ProjectionPlanEcheance != 2000 || p.ProjectionTendanceEcheance != 2000 || p.RythmeNecessaire != 0 ||
		p.NonConsomme != 0 || p.NonConsommeSource != "" || p.SousConsommation || p.Budget != 13000 {
		t.Errorf("échéance passée = %+v", p)
	}
	checkEcheance(t, pv.Global, s)
}

func TestPrevisionsEcheanceDefaut(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	// Sans réalisé : année de Input.Now, semaines comptées depuis la 1re semaine de l'axe.
	in := baseInput()
	in.Now = time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)
	onePlan(&in, fcLine("S", 0, 4000, "2027-01-04", "2027-01-29", "FRAIS")) // W01..W04 2027
	pv := Run(in, s).Previsions
	p := findCT(t, pv, "S")
	// 31/12/2027 = W52 : 52 semaines W01..W52 ; plan = 4 000 €, tendance 0 → non consommé 4 000 € (< 5 000 €).
	if p.Echeance != "2027-12-31" || pv.Global.Echeance != "2027-12-31" || p.SemainesEcheance != 52 ||
		p.ProjectionPlanEcheance != 4000 || p.ProjectionTendanceEcheance != 0 || p.NonConsomme != 4000 ||
		p.NonConsommeSource != "tendance" || p.SousConsommation || p.RythmeNecessaire != 76.92 {
		t.Errorf("sans réalisé = %+v", p)
	}
	// Avec réalisé : année de as_of (Now ignoré).
	in.Entries = []domain.RealiseEntry{fcEntry("S", 1000, "2027-01-08")}
	in.Now = time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if e := Run(in, s).Previsions.Global.Echeance; e != "2027-12-31" {
		t.Errorf("échéance avec réalisé = %q", e)
	}
}

func TestFcEcheanceSeuils(t *testing.T) {
	s := store.DefaultSettings() // 10 % et 5 000 €
	cases := []struct {
		name            string
		budget, plan, t float64
		nc              float64
		source          string
		sous            bool
	}{
		{"pct seul", 20000, 16000, 30000, 4000, "plan", false},      // 20 % mais 4 000 €
		{"eur seul", 100000, 92000, 95000, 8000, "plan", false},     // 8 000 € mais 8 %
		{"les deux", 50000, 60000, 42000, 8000, "tendance", true},   // 16 % et 8 000 €
		{"égalité", 50000, 40000, 40000, 10000, "plan", true},       // plan retenu à égalité
		{"au-delà", 10000, 12000, 11000, 0, "", false},              // projections au-delà du budget
		{"tolérance", 50000, 45000.4, 46000, 4999.6, "plan", false}, // ≤ 5 000 € + tolérance
	}
	for _, c := range cases {
		var p domain.PrevisionCT
		fcEcheance(&p, fcCalc{ppsEch: c.budget, prevuEch: c.plan, rythme: c.t, se: 1, echeance: "2026-12-31"}, s)
		if p.NonConsomme != c.nc || p.NonConsommeSource != c.source || p.SousConsommation != c.sous {
			t.Errorf("%s : non consommé %v (%q), sous-conso %v", c.name, p.NonConsomme, p.NonConsommeSource, p.SousConsommation)
		}
	}
}
