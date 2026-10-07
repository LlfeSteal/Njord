package analyse

import (
	"math"
	"os"
	"testing"

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
