package analyse

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
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

// fv dereferences a nullable figure (NaN si nil : toute comparaison échoue).
func fv(p *float64) float64 {
	if p == nil {
		return math.NaN()
	}
	return *p
}

// fs dereferences a nullable statut ("" si nil).
func fs(p *domain.PrevisionStatut) domain.PrevisionStatut {
	if p == nil {
		return ""
	}
	return *p
}

// checkSansBudget: un CT sans enveloppe (ou le global sans aucune enveloppe)
// n'a aucun champ de budget (DECISIONS n° 20).
func checkSansBudget(t *testing.T, p domain.PrevisionCT) {
	t.Helper()
	if p.BudgetSource != "aucun" || p.Budget != nil || p.Statut != nil || p.EcartPlan != nil || p.EcartTendance != nil ||
		p.PctConsomme != nil || p.BudgetEcheance != nil || p.NonConsomme != nil || p.RythmeNecessaire != nil || p.CibleMin != nil ||
		p.Enveloppe != nil || p.Echeance != "" || p.SousConsommation ||
		p.ProjectionPlanEcheance != 0 || p.ProjectionTendanceEcheance != 0 || p.SemainesEcheance != 0 ||
		p.PlanHorsEnveloppe != 0 || p.ConsommeHorsEnveloppe != 0 {
		t.Errorf("%q sans budget : champs de budget renseignés %+v", p.CT, p)
	}
}

// checkInvariants verifies the cross-field consistency of one forecast.
func checkInvariants(t *testing.T, p domain.PrevisionCT, asOf string) {
	t.Helper()
	// Atterrissage sécurisé (DECISIONS n° 23) = consommé + reste + provisions sécurisées comptées.
	if !near(p.AtterrissagePlan, p.Consomme+p.ResteAFaire+p.ProvisionsSecurisees, 0.02) {
		t.Errorf("%s : atterrissage plan %v ≠ consommé %v + reste %v + provisions sécurisées %v", p.CT, p.AtterrissagePlan,
			p.Consomme, p.ResteAFaire, p.ProvisionsSecurisees)
	}
	if !near(p.Provisions, p.ProvisionsSecurisees+p.ProvisionsAleas+p.ProvisionsHorsEnveloppe, 0.02) {
		t.Errorf("%s : provisions %v ≠ sécurisées %v + aléas %v + hors enveloppe %v", p.CT, p.Provisions,
			p.ProvisionsSecurisees, p.ProvisionsAleas, p.ProvisionsHorsEnveloppe)
	}
	if p.Budget == nil {
		checkSansBudget(t, p)
	} else if !near(fv(p.EcartPlan), p.AtterrissagePlan-*p.Budget, 0.02) || !near(fv(p.EcartTendance), p.AtterrissageTendance-*p.Budget, 0.02) {
		t.Errorf("%s : écarts incohérents %+v", p.CT, p)
	}
	if p.Series == nil {
		t.Fatalf("%s : séries nil", p.CT)
	}
	if p.CT == "" && p.Budget == nil && len(p.Series) != 0 {
		t.Errorf("global sans enveloppe : %d points de série", len(p.Series))
	}
	if len(p.Series) == 0 {
		return
	}
	last := p.Series[len(p.Series)-1]
	asWeek := WeekOfDate(asOf)
	if asWeek != "" && last.Week < asWeek {
		// Global dont toutes les enveloppes finissent avant as_of : axe = union des périodes, réel seul.
		if last.ReelCumul == nil || !near(*last.ReelCumul, p.Consomme, 0.02) || p.AtterrissagePlan != p.Consomme {
			t.Errorf("%s : dernier réel_cumul %v ≠ consommé %v", p.CT, last.ReelCumul, p.Consomme)
		}
		return
	}
	if last.PlanCumul == nil || !near(*last.PlanCumul, p.AtterrissagePlan, 0.02) {
		t.Errorf("%s : dernier plan_cumul %v ≠ atterrissage %v", p.CT, last.PlanCumul, p.AtterrissagePlan)
	}
	if last.TendanceCumul == nil || !near(*last.TendanceCumul, p.AtterrissageTendance, 0.05) {
		t.Errorf("%s : dernier tendance_cumul %v ≠ atterrissage tendance %v", p.CT, last.TendanceCumul, p.AtterrissageTendance)
	}
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

// checkBudget verifies the budget figures of a forecast with a budget
// (DECISIONS n° 19 et 20) : enveloppe d'un CT, ou Σ enveloppes pour le global.
func checkBudget(t *testing.T, p domain.PrevisionCT, s domain.Settings) {
	t.Helper()
	if p.Budget == nil {
		return
	}
	b := *p.Budget
	if p.BudgetSource != "enveloppe" || fv(p.BudgetEcheance) != b || p.Echeance == "" || p.Statut == nil ||
		p.ProjectionPlanEcheance != p.AtterrissagePlan || p.ProjectionTendanceEcheance != p.AtterrissageTendance ||
		p.SemainesEcheance != p.SemainesRestantes {
		t.Errorf("%s : budget incohérent %+v", p.CT, p)
	}
	if want := fcStatut(fcCalc{budget: b, atterPlan: p.AtterrissagePlan, atterTend: p.AtterrissageTendance}); fs(p.Statut) != want {
		t.Errorf("%s : statut %s, attendu %s", p.CT, fs(p.Statut), want)
	}
	if want := pct(p.Consomme, b); (want == nil) != (p.PctConsomme == nil) || (want != nil && !near(*want, *p.PctConsomme, 0.02)) {
		t.Errorf("%s : %% consommé %v, attendu %v", p.CT, p.PctConsomme, want)
	}
	switch {
	case p.Enveloppe != nil: // échéance = fin de l'enveloppe, budget = montant
		if p.Echeance != p.Enveloppe.DateFin || b != round2(p.Enveloppe.Montant) {
			t.Errorf("%s : échéance de l'enveloppe incohérente %+v", p.CT, p)
		}
		if !near(p.ProjectionTendanceEcheance, p.Consomme+p.RythmeHebdo*float64(p.SemainesEcheance), 0.02+0.005*float64(p.SemainesEcheance)) {
			t.Errorf("%s : projection tendance %v incohérente", p.CT, p.ProjectionTendanceEcheance)
		}
		// Non consommé = plan de charge seul (DECISIONS n° 21), jamais la tendance.
		if !near(fv(p.NonConsomme), math.Max(0, b-p.ProjectionPlanEcheance), 0.03) {
			t.Errorf("%s : non consommé %v ≠ %v − %v", p.CT, fv(p.NonConsomme), b, p.ProjectionPlanEcheance)
		}
	case p.CT != "":
		t.Errorf("%s : budget sans enveloppe", p.CT)
	}
	nc := fv(p.NonConsomme)
	if p.SousConsommation != (nc > s.SeuilSousConsoPct/100*b+fcTolerance && nc > s.SeuilSousConsoEur+fcTolerance) {
		t.Errorf("%s : sous-consommation %v incohérente (%v / %v)", p.CT, p.SousConsommation, nc, b)
	}
	if want := round2(math.Max(0, b-math.Max(s.SeuilSousConsoPct/100*b, s.SeuilSousConsoEur))); fv(p.CibleMin) != want {
		t.Errorf("%s : cible_min %v, attendu %v", p.CT, fv(p.CibleMin), want)
	}
}

// checkTri: CT avec enveloppe par statut puis écart plan décroissant ; CT sans
// enveloppe en dernier, atterrissage plan décroissant.
func checkTri(t *testing.T, par []domain.PrevisionCT) {
	t.Helper()
	rank := map[domain.PrevisionStatut]int{domain.PrevisionDepassement: 0, domain.PrevisionVigilance: 1, domain.PrevisionOK: 2}
	for i := 1; i < len(par); i++ {
		a, p := par[i-1], par[i]
		switch {
		case a.Statut == nil && p.Statut != nil:
			t.Errorf("tri : %s sans enveloppe avant %s", a.CT, p.CT)
		case a.Statut == nil:
			if a.AtterrissagePlan < p.AtterrissagePlan {
				t.Errorf("tri : %s (%v) avant %s (%v)", a.CT, a.AtterrissagePlan, p.CT, p.AtterrissagePlan)
			}
		case p.Statut == nil:
		case rank[*a.Statut] > rank[*p.Statut] || (*a.Statut == *p.Statut && *a.EcartPlan < *p.EcartPlan):
			t.Errorf("tri : %s (%s, %v) avant %s (%s, %v)", a.CT, *a.Statut, *a.EcartPlan, p.CT, *p.Statut, *p.EcartPlan)
		}
	}
}

func TestPrevisionsDemo(t *testing.T) {
	in := demoInput(t)
	res := Run(in, store.DefaultSettings())
	pv := res.Previsions

	pps, conso := 0.0, 0.0
	for _, l := range in.Plans[0].Lines {
		if l.StatutParsing != domain.ParsingDrop && strings.TrimSpace(l.CT) != "" {
			pps += l.PPS
		}
	}
	for _, e := range in.Entries {
		if e.StatutParsing != domain.ParsingDrop && strings.TrimSpace(e.TG) != "" {
			conso += e.TotalEur
		}
	}
	if pv.AsOf != "2026-10-03" || pv.AsOfWeek != "2026-W40" {
		t.Fatalf("as_of = %q / %q", pv.AsOf, pv.AsOfWeek)
	}
	// Aucune enveloppe : global vide de budget, tous les CT hors enveloppe (DECISIONS n° 20).
	gl := pv.Global
	if gl.CT != "" || gl.CTLibelle != "Périmètre" || gl.Consomme != 0 || gl.AtterrissagePlan != 0 || len(gl.Series) != 0 {
		t.Errorf("global = %+v", gl)
	}
	checkInvariants(t, gl, pv.AsOf)

	sumPPS, sumC, sumP, sumT := 0.0, 0.0, 0.0, 0.0
	for _, p := range pv.ParCT {
		checkInvariants(t, p, pv.AsOf)
		sumPPS += p.PPS
		sumC += p.Consomme
		sumP += p.AtterrissagePlan
		sumT += p.AtterrissageTendance
		if len(p.Series) != len(pv.ParCT[0].Series) || len(p.Series) == 0 {
			t.Errorf("%s : axe de %d semaines ≠ %d", p.CT, len(p.Series), len(pv.ParCT[0].Series))
		}
	}
	checkTri(t, pv.ParCT)
	if !near(sumPPS, pps, 0.05) || !near(sumPPS, 1014062.10, 1) {
		t.Errorf("Σ PPS par CT = %v, Σ PPS = %v", sumPPS, pps)
	}
	he := pv.HorsEnveloppe
	if he.NbCT != len(pv.ParCT) || !near(he.Consomme, conso, 0.05) || !near(he.Consomme, sumC, 0.05) ||
		!near(he.AtterrissagePlan, sumP, 0.05) || !near(he.AtterrissageTendance, sumT, 0.05) {
		t.Errorf("hors enveloppe = %+v (Σ consommé %v / %v, Σ atterrissages %v / %v)", he, conso, sumC, sumP, sumT)
	}
	if pv.Enveloppes != (domain.EnveloppesSynthese{NbCT: len(pv.ParCT)}) {
		t.Errorf("synthèse = %+v", pv.Enveloppes)
	}
	t.Logf("as_of %s · %d CT hors enveloppe · consommé %.2f · atterrissage plan %.2f · tendance %.2f · %d semaines",
		pv.AsOf, he.NbCT, he.Consomme, he.AtterrissagePlan, he.AtterrissageTendance, len(pv.ParCT[0].Series))
	for _, p := range pv.ParCT {
		t.Logf("  %s conso %10.2f reste %10.2f plan %10.2f tend %10.2f fin %s", p.CT, p.Consomme, p.ResteAFaire, p.AtterrissagePlan, p.AtterrissageTendance, p.FinPlan)
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

// TestPrevisionsSynthetique: CT sans enveloppe — horizon = tout le plan, aucun budget.
func TestPrevisionsSynthetique(t *testing.T) {
	in := baseInput()
	onePlan(&in,
		// A : 4 semaines W37..W40 (20 j ouvrés), 1 000 €/semaine ; consommé 3 000 €.
		fcLine("A", 80, 4000, "2026-09-07", "2026-10-02", "MAIN D'OEUVRE SUR SITE"),
		// B : sans réalisé, W41..W42, 2 000 €.
		fcLine("B", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"),
		// D : 1 000 € (W38), consommé 1 500 €.
		fcLine("D", 10, 1000, "2026-09-14", "2026-09-18", "MAIN D'OEUVRE SUR SITE"),
		// E : tendance — 8 000 € sur W37..W44, rythme récent élevé.
		fcLine("E", 0, 8000, "2026-09-07", "2026-10-30", "FRAIS"),
		// F : dates invalides → PPS hors série.
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
	if a.PPS != 4000 || a.Consomme != 3000 || a.ResteAFaire != 0 || a.AtterrissagePlan != 3000 || a.FinPlan != "2026-10-02" ||
		a.SemainesRestantes != 0 || a.RythmeHebdo != 750 || a.Series[0].Week != "2026-W37" || a.Series[len(a.Series)-1].Week != "2026-W44" {
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
	if b.Consomme != 0 || b.ResteAFaire != 2000 || b.AtterrissagePlan != 2000 || b.SemainesRestantes != 2 || b.RythmeHebdo != 0 ||
		b.AtterrissageTendance != 0 {
		t.Errorf("B = %+v", b)
	}
	if d := findCT(t, pv, "D"); d.AtterrissagePlan != 1500 || d.RythmeHebdo != 375 || d.AtterrissageTendance != 1500 {
		t.Errorf("D = %+v", d)
	}
	e := findCT(t, pv, "E")
	// 8 semaines × 1 000 € ; reste W41..W44 = 4 000 € ; rythme = (2 000 + 2 000) / 4 = 1 000 ; 4 semaines restantes.
	if e.ResteAFaire != 4000 || e.AtterrissagePlan != 8000 || e.RythmeHebdo != 1000 || e.SemainesRestantes != 4 || e.AtterrissageTendance != 8000 {
		t.Errorf("E = %+v", e)
	}
	if f := findCT(t, pv, "F"); f.PPS != 500 || f.ResteAFaire != 0 || f.FinPlan != "" {
		t.Errorf("F = %+v", f)
	}
	// CT absent du plan : plus de « dépense hors budget », simplement sans enveloppe.
	if x := findCT(t, pv, "X"); x.Consomme != 300 || x.AtterrissagePlan != 300 {
		t.Errorf("X = %+v", x)
	}

	var order []string
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		order = append(order, p.CT)
	}
	checkTri(t, pv.ParCT)
	if strings.Join(order, ",") != "E,A,B,D,X,F," {
		t.Errorf("tri (atterrissage plan décroissant) : %v", order)
	}
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 6, Consomme: 8800, AtterrissagePlan: 14800, AtterrissageTendance: 12800}) {
		t.Errorf("hors enveloppe = %+v", pv.HorsEnveloppe)
	}
}

func TestPrevisionsTendance(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil // 10 semaines pleines W37..W46
	in := baseInput()
	// 10 000 € sur W37..W46 (1 000 €/semaine) ; consommation récente 2 000 €/semaine ; enveloppe = la période du plan.
	onePlan(&in, fcLine("T", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	in.Enveloppes = map[string]domain.Enveloppe{"T": fcEnv("2026-09-07", "2026-11-13", 10000)}
	for _, d := range []string{"2026-09-14", "2026-09-21", "2026-09-28", "2026-10-02"} {
		in.Entries = append(in.Entries, fcEntry("T", 2000, d))
	}
	pv := Run(in, s).Previsions
	p := findCT(t, pv, "T")
	// W38..W40 consommées (4 écritures, W40 deux fois) : 8 000 € ; rythme = 8 000 / 4 = 2 000 ; 6 semaines restantes.
	if p.Consomme != 8000 || p.RythmeHebdo != 2000 || p.SemainesRestantes != 6 || p.AtterrissageTendance != 20000 ||
		p.ResteAFaire != 6000 || p.AtterrissagePlan != 14000 || fs(p.Statut) != domain.PrevisionDepassement {
		t.Errorf("T = %+v", p)
	}
	checkInvariants(t, p, pv.AsOf)
	checkBudget(t, p, s)
	// tendance_cumul : +2 000 € par semaine après as_of.
	for _, pt := range p.Series {
		if pt.Week == "2026-W42" && (pt.TendanceCumul == nil || *pt.TendanceCumul != 12000 || *pt.PlanCumul != 10000) {
			t.Errorf("W42 = %+v", pt)
		}
	}

	// Plan à 90 % de l'enveloppe mais rythme récent au-delà → vigilance.
	// as_of W44 : consommé 7 000 € sur W41..W44, reste W45..W46 = 2 000 € ; tendance 7 000 + 1 750 × 2.
	in.Entries = nil
	for _, d := range []string{"2026-10-06", "2026-10-13", "2026-10-20", "2026-10-30"} {
		in.Entries = append(in.Entries, fcEntry("T", 1750, d))
	}
	p = findCT(t, Run(in, s).Previsions, "T")
	if p.AtterrissagePlan != 9000 || p.RythmeHebdo != 1750 || p.SemainesRestantes != 2 || p.AtterrissageTendance != 10500 ||
		fs(p.Statut) != domain.PrevisionVigilance {
		t.Errorf("T vigilance = %+v", p)
	}
}

func TestPrevisionsSansRealise(t *testing.T) {
	in := baseInput()
	onePlan(&in, fcLine("A", 40, 2000, "2026-09-07", "2026-09-18", "MAIN D'OEUVRE SUR SITE"))
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-09-07", "2026-09-18", 2000)}
	s := store.DefaultSettings()
	pv := Run(in, s).Previsions
	if pv.AsOf != "" || pv.AsOfWeek != "" {
		t.Fatalf("as_of = %q", pv.AsOf)
	}
	gl := pv.Global
	if gl.Consomme != 0 || gl.ResteAFaire != 2000 || gl.AtterrissagePlan != 2000 || gl.AtterrissageTendance != 0 ||
		gl.SemainesRestantes != 2 || len(gl.Series) != 2 || gl.Series[1].HeuresPlan != 20 || fv(gl.Budget) != 2000 ||
		fs(gl.Statut) != domain.PrevisionVigilance || fv(gl.NonConsomme) != 0 || gl.SousConsommation {
		t.Errorf("global = %+v", gl)
	}
	checkInvariants(t, gl, "")
	checkBudget(t, gl, s)

	// Ni plan ni réalisé : structures vides mais jamais nil, global sans budget.
	pv = Run(baseInput(), s).Previsions
	if pv.ParCT == nil || len(pv.ParCT) != 0 || pv.Global.Series == nil || pv.Global.BudgetSource != "aucun" ||
		pv.HorsEnveloppe != (domain.HorsEnveloppe{}) {
		t.Errorf("vide = %+v", pv)
	}
	checkInvariants(t, pv.Global, "")
}

// TestPrevisionsSansEnveloppe: aucun champ de budget, ni dans la structure ni
// dans le JSON (null), et plus aucune fin d'exercice reconstruite.
func TestPrevisionsSansEnveloppe(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	in.Now = time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)
	onePlan(&in, fcLine("S", 0, 4000, "2027-01-04", "2027-01-29", "FRAIS")) // W01..W04 2027
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	in.Provisions = []domain.ProvisionLine{provLine("S", "CAPACITE SUR SITE", "Proj > S", 3000)}
	res := Run(in, s)
	pv := res.Previsions
	p := findCT(t, pv, "S")
	// Sans réalisé : 4 semaines W01..W04, plan 4 000 € + provision sécurisée 3 000 € (sans
	// enveloppe : toutes comptées, DECISIONS n° 23), tendance 0. La provision, datée avant
	// l'axe, entre dans la première semaine projetée.
	if p.PPS != 4000 || p.Provisions != 3000 || p.ProvisionsSecurisees != 3000 || p.ResteAFaire != 4000 || p.AtterrissagePlan != 7000 ||
		p.AtterrissageTendance != 0 || p.SemainesRestantes != 4 || len(p.Series) != 4 || fv(p.Series[0].PlanCumul) != 4000 {
		t.Errorf("S = %+v", p)
	}
	checkInvariants(t, p, "")
	checkInvariants(t, pv.Global, "")
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, AtterrissagePlan: 7000}) {
		t.Errorf("hors enveloppe = %+v", pv.HorsEnveloppe)
	}
	for _, a := range res.Anomalies {
		if a.Categorie == domain.AnomalieBudget {
			t.Errorf("anomalie budget sans enveloppe : %+v", a)
		}
	}
	raw, err := json.Marshal(pv)
	if err != nil {
		t.Fatal(err)
	}
	js := string(raw)
	for _, want := range []string{`"budget":null`, `"statut":null`, `"cible_min":null`, `"budget_source":"aucun"`, `"echeance":""`, `"hors_enveloppe":{"nb_ct":1,`} {
		if !strings.Contains(js, want) {
			t.Errorf("JSON sans %s", want)
		}
	}
	for _, gone := range []string{"charge_max", "mixte", "pps_echeance", "provisions_echeance"} {
		if strings.Contains(js, gone) {
			t.Errorf("JSON contient encore %s", gone)
		}
	}
}

// provLine: une ligne de provision (DECISIONS n° 16).
func provLine(ct, ligneCout, groupe string, montant float64) domain.ProvisionLine {
	rowSeq++
	return domain.ProvisionLine{RowNum: rowSeq, CT: ct, Libelle: "Provision " + ct, Montant: montant, Unite: "EURO",
		LigneCout: ligneCout, TypeDepense: "Standard", DateDebut: "2026-12-30", DateFin: "2026-12-31", Groupe: groupe,
		StatutParsing: domain.ParsingOK}
}

// TestPrevisionsProvisions: provisions sécurisées et aléas (DECISIONS n° 23) —
// les sécurisées comptées entrent dans l'atterrissage (et la courbe plan), les
// aléas jamais ; le budget reste l'enveloppe.
func TestPrevisionsProvisions(t *testing.T) {
	in := baseInput()
	onePlan(&in,
		fcLine("A", 80, 4000, "2026-09-07", "2026-10-02", "MAIN D'OEUVRE SUR SITE"),
		// D : enveloppe 1 000 €, consommé 1 500 € → dépassement, provisions ou pas.
		fcLine("D", 10, 1000, "2026-09-14", "2026-09-18", "MAIN D'OEUVRE SUR SITE"),
		fcLine("B", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		mo("A", "DURAND Claire", 30, "2026-09-08"),
		fcEntry("D", 1500, "2026-09-15"),
		fcEntry("X", 300, "2026-10-03"), // hors plan
	}
	in.Enveloppes = map[string]domain.Enveloppe{"D": fcEnv("2026-09-01", "2026-12-31", 1000)}
	s := store.DefaultSettings()
	sans := Run(in, s).Previsions

	drop := provLine("A", "CAPACITE SUR SITE", "Proj > A", 99999)
	drop.StatutParsing = domain.ParsingDrop
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	in.Provisions = []domain.ProvisionLine{
		provLine("D", "CAPACITE SUR SITE", "Proj > Squad D", 600), // 30/12/2026 : dans la période
		provLine("B", "PROVISIONS POUR ALEAS", "Proj > Squad B", 1000),
		provLine("X", "FRAIS DE MISSION", "Proj > Missions", 1000),
		provLine("P", "CAPACITE SUR SITE", "Réserve > Fonds de transformation", 1500),
		provLine("P", "FRAIS ACHATS CAPACITE SUR SITE", "Réserve > Autre libellé", 500),
		provLine("", "FRAIS DE MISSION", "", 50), // sans CT : hors de tout CT
		drop,
	}
	res := Run(in, s)
	pv := res.Previsions
	if res.Meta.ProvisionVersion == nil || res.Meta.ProvisionVersion.ID != "prov1" {
		t.Errorf("meta.provision_version = %+v", res.Meta.ProvisionVersion)
	}

	// D : 1 500 consommés + 600 de provision sécurisée datée dans la période.
	d := findCT(t, pv, "D")
	if d.PPS != 1000 || d.Provisions != 600 || d.ProvisionsSecurisees != 600 || d.ProvisionsAleas != 0 || fv(d.Budget) != 1000 ||
		d.AtterrissagePlan != 2100 || d.ProjectionPlanEcheance != 2100 || d.ResteAFaire != 0 ||
		fv(d.EcartPlan) != 1100 || fs(d.Statut) != domain.PrevisionDepassement || fv(d.PctConsomme) != 150 || fv(d.NonConsomme) != 0 {
		t.Errorf("D = %+v", d)
	}
	// Courbe plan : la provision s'ajoute dans sa semaine (W53), la courbe finit sur l'atterrissage.
	if pt := fcPoint(t, d, "2026-W52"); fv(pt.PlanCumul) != 1500 || pt.BudgetCumul != 1000 {
		t.Errorf("D W52 = %+v", pt)
	}
	if pt := fcPoint(t, d, "2026-W53"); fv(pt.PlanCumul) != 2100 || pt.BudgetCumul != 1000 {
		t.Errorf("D W53 = %+v", pt)
	}
	// Sans enveloppe : toutes les sécurisées comptées.
	if x := findCT(t, pv, "X"); x.PPS != 0 || x.Provisions != 1000 || x.ProvisionsSecurisees != 1000 || x.Budget != nil ||
		x.Consomme != 300 || x.AtterrissagePlan != 1300 || x.Statut != nil {
		t.Errorf("X = %+v", x)
	}
	// Aléas : jamais dans l'atterrissage.
	if b, bs := findCT(t, pv, "B"), findCT(t, sans, "B"); b.ProvisionsAleas != 1000 || b.ProvisionsSecurisees != 0 ||
		b.AtterrissagePlan != bs.AtterrissagePlan || b.Provisions != 1000 {
		t.Errorf("B = %+v", b)
	}
	// CT présent seulement dans les provisions : libellé = sous-projet de la 1re ligne, sans budget.
	p := findCT(t, pv, "P")
	if p.CTLibelle != "Fonds de transformation" || p.PPS != 0 || p.Provisions != 2000 || p.ProvisionsSecurisees != 2000 || p.Budget != nil ||
		p.Consomme != 0 || p.ResteAFaire != 0 || p.AtterrissagePlan != 2000 || p.Statut != nil || p.FinPlan != "" || p.SemainesRestantes != 0 {
		t.Errorf("P = %+v", p)
	}
	for _, c := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, c, pv.AsOf)
		checkBudget(t, c, s)
	}
	checkSynthese(t, pv)
	// Global = D seul (seul CT avec enveloppe).
	gl := pv.Global
	if gl.PPS != 1000 || gl.Provisions != 600 || gl.ProvisionsSecurisees != 600 || fv(gl.Budget) != 1000 || gl.AtterrissagePlan != 2100 ||
		sans.Global.Provisions != 0 || pv.Enveloppes.Atterrissage != 2100 || pv.Enveloppes.Depassement != 1100 {
		t.Errorf("global = %+v, synthèse %+v", gl, pv.Enveloppes)
	}
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: sans.HorsEnveloppe.NbCT + 1, Consomme: sans.HorsEnveloppe.Consomme,
		AtterrissagePlan: sans.HorsEnveloppe.AtterrissagePlan + 3000, AtterrissageTendance: sans.HorsEnveloppe.AtterrissageTendance}) {
		t.Errorf("hors enveloppe = %+v (sans : %+v)", pv.HorsEnveloppe, sans.HorsEnveloppe)
	}
	// Anomalies budget : D seulement (seul CT avec enveloppe).
	for _, a := range res.Anomalies {
		if a.Categorie == domain.AnomalieBudget && a.CT != "D" {
			t.Errorf("anomalie budget inattendue : %+v", a)
		}
	}
}

func TestPrevisionsEcheance(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in,
		// S : 10 000 € sur W37..W46 (1 000 €/sem.), 2 000 € en 2027 et 500 € hors série : hors enveloppe.
		fcLine("S", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"),
		fcLine("S", 0, 2000, "2027-01-11", "2027-01-22", "FRAIS"),
		fcLine("S", 0, 500, "", "", "FRAIS"),
		// T : 10 000 € sur W41..W50, consommation récente faible → tendance basse, sans effet sur le non consommé.
		fcLine("T", 0, 10000, "2026-10-05", "2026-12-11", "FRAIS"),
		// U : mêmes chiffres que T, sans enveloppe → aucun budget ni anomalie.
		fcLine("U", 0, 10000, "2026-10-05", "2026-12-11", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		fcEntry("S", 500, "2026-09-08"), fcEntry("S", 500, "2026-09-15"),
		fcEntry("S", 500, "2026-09-22"), fcEntry("S", 500, "2026-09-29"),
		fcEntry("T", 400, "2026-10-02"), // as_of W40
		fcEntry("U", 400, "2026-10-02"),
	}
	in.Enveloppes = map[string]domain.Enveloppe{
		"S": fcEnv("2026-01-01", "2026-12-31", 14500),
		"T": fcEnv("2026-01-01", "2026-12-31", 10000),
	}
	in.ProvisionVersion = &domain.Version{ID: "prov1", Kind: domain.KindProvision, Statut: domain.StatutActive}
	// Provisions de S : sécurisée datée après la fin de l'enveloppe (hors enveloppe) et aléas :
	// ni l'une ni l'autre n'entre dans l'atterrissage (DECISIONS n° 23).
	horsPeriode := provLine("S", "CAPACITE SUR SITE", "Proj > S", 3000)
	horsPeriode.DateDebut, horsPeriode.DateFin = "2027-01-15", "2027-01-31"
	in.Provisions = []domain.ProvisionLine{horsPeriode, provLine("S", "PROVISIONS POUR ALEAS", "Proj > S", 5000)}
	res := Run(in, s)
	pv := res.Previsions
	if pv.AsOf != "2026-10-02" {
		t.Fatalf("as_of = %q", pv.AsOf)
	}

	// S : fin de l'enveloppe 31/12/2026 (W53) → 13 semaines W41..W53.
	sc := findCT(t, pv, "S")
	if fv(sc.Budget) != 14500 || sc.PPS != 12500 || sc.Provisions != 8000 || sc.PlanHorsEnveloppe != 2500 || sc.AtterrissagePlan != 8000 ||
		sc.ProvisionsSecurisees != 0 || sc.ProvisionsAleas != 5000 || sc.ProvisionsHorsEnveloppe != 3000 || fs(sc.Statut) != domain.PrevisionOK {
		t.Errorf("S = %+v", sc)
	}
	if sc.Echeance != "2026-12-31" || fv(sc.BudgetEcheance) != 14500 || sc.SemainesEcheance != 13 || sc.ProjectionPlanEcheance != 8000 ||
		sc.ProjectionTendanceEcheance != 8500 || fv(sc.NonConsomme) != 6500 ||
		fv(sc.RythmeNecessaire) != 961.54 || !sc.SousConsommation || fv(sc.CibleMin) != 9500 {
		t.Errorf("S échéance = %+v", sc)
	}
	// T : tendance 400 + 100 × 13 = 1 700, plan 10 400 > enveloppe → dépassement, rien de
	// non consommé (DECISIONS n° 21 ; l'ancienne règle donnait 8 300 € sur la tendance).
	tc := findCT(t, pv, "T")
	if fs(tc.Statut) != domain.PrevisionDepassement || fv(tc.BudgetEcheance) != 10000 || tc.ProjectionPlanEcheance != 10400 ||
		tc.ProjectionTendanceEcheance != 1700 || fv(tc.NonConsomme) != 0 || fv(tc.EcartPlan) != 400 ||
		fv(tc.RythmeNecessaire) != 738.46 || tc.SousConsommation || fv(tc.CibleMin) != 5000 {
		t.Errorf("T échéance = %+v", tc)
	}
	if u := findCT(t, pv, "U"); u.AtterrissagePlan != 10400 || u.AtterrissageTendance != 1400 || u.SemainesRestantes != 10 {
		t.Errorf("U = %+v", u) // horizon = fin du plan (W50) : 10 semaines
	}
	// Global = S + T : non consommé = Σ des CT (6 500 + 0), sans compensation ;
	// statut et seuils sur les sommes.
	gl := pv.Global
	if gl.BudgetSource != "enveloppe" || fv(gl.Budget) != 24500 || gl.Echeance != "2026-12-31" || fv(gl.BudgetEcheance) != 24500 ||
		gl.SemainesEcheance != 13 || gl.ProjectionPlanEcheance != 18400 || gl.ProjectionTendanceEcheance != 10200 ||
		fv(gl.NonConsomme) != 6500 || !gl.SousConsommation || fs(gl.Statut) != domain.PrevisionOK ||
		fv(gl.EcartPlan) != -6100 || fv(gl.PctConsomme) != 9.8 || fv(gl.RythmeNecessaire) != 1700 || fv(gl.CibleMin) != 19500 ||
		gl.Provisions != 8000 || gl.PPS != 22500 || gl.ProvisionsAleas != 5000 || gl.ProvisionsHorsEnveloppe != 3000 || gl.ProvisionsSecurisees != 0 {
		t.Errorf("global échéance = %+v", gl)
	}
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, Consomme: 400, AtterrissagePlan: 10400, AtterrissageTendance: 1400}) {
		t.Errorf("hors enveloppe = %+v", pv.HorsEnveloppe)
	}
	checkSynthese(t, pv)
	for _, p := range append(pv.ParCT, gl) {
		checkBudget(t, p, s)
		checkInvariants(t, p, pv.AsOf)
	}

	// Anomalies : sous-consommation de S, dépassement de T (sans sous-consommation) ; rien pour U.
	byKey := map[string]domain.Anomalie{}
	for _, a := range res.Anomalies {
		byKey[a.Key] = a
		if a.CT == "U" && a.Categorie == domain.AnomalieBudget {
			t.Errorf("anomalie budget sur un CT sans enveloppe : %+v", a)
		}
	}
	checkAnomalies(t, res.Anomalies)
	if _, ok := byKey["budget|T"]; !ok {
		t.Error("anomalie de dépassement de T absente")
	}
	a, ok := byKey["budget_sous_conso|S"]
	nb := func(s string) string { return strings.ReplaceAll(s, " ", " ") }
	if !ok || a.Categorie != domain.AnomalieBudget || a.Gravite != 2 || a.Montant == nil || *a.Montant != 6500 ||
		a.Lien != "/previsions?ct=S" || a.CT != "S" ||
		nb(a.Titre) != "Sous-consommation · S : 6 500 € non consommés par le plan de charge et les provisions sécurisées à la fin de l'enveloppe, le 31/12/2026 (45 %)" ||
		nb(a.Detail) != "Enveloppe 14 500 € (01/01/2026 → 31/12/2026) ; atterrissage plan 8 000 € (tendance 8 500 €, repère) ; il faudrait 962 €/sem contre 500 €/sem" {
		t.Errorf("anomalie S = %+v", a)
	}
	if a, ok := byKey["budget_sous_conso|T"]; ok {
		t.Errorf("sous-consommation de T portée par la tendance : %+v", a)
	}
	// L'empreinte suit budget et atterrissage plan, pas la tendance : déplacer
	// une écriture de S hors des 4 dernières semaines (même période, même
	// consommé) ne change que le rythme.
	moved := append([]domain.RealiseEntry(nil), in.Entries...)
	moved[0] = fcEntry("S", 500, "2026-08-31") // W36 au lieu de W37
	inMoved := in
	inMoved.Entries = moved
	var tendOnly domain.Anomalie
	resMoved := Run(inMoved, s)
	for _, a2 := range resMoved.Anomalies {
		if a2.Key == "budget_sous_conso|S" {
			tendOnly = a2
		}
	}
	if sm := findCT(t, resMoved.Previsions, "S"); sm.ProjectionTendanceEcheance == sc.ProjectionTendanceEcheance ||
		sm.ProjectionPlanEcheance != sc.ProjectionPlanEcheance || tendOnly.Fingerprint != a.Fingerprint {
		t.Errorf("empreinte S sensible à la seule tendance : %s ≠ %s (tendance %v → %v)", tendOnly.Fingerprint, a.Fingerprint,
			sc.ProjectionTendanceEcheance, sm.ProjectionTendanceEcheance)
	}
	in.Entries = append(in.Entries, fcEntry("S", 100, "2026-09-30"))
	for _, a2 := range Run(in, s).Anomalies {
		if a2.Key == "budget_sous_conso|S" && a2.Fingerprint == a.Fingerprint {
			t.Error("empreinte inchangée malgré un atterrissage plan modifié")
		}
	}
}

// TestPrevisionsEcheancePassee: enveloppe terminée avant as_of, cible_min au plancher.
func TestPrevisionsEcheancePassee(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in, fcLine("S", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	in.Entries = []domain.RealiseEntry{fcEntry("S", 500, "2026-09-08"), fcEntry("S", 1500, "2026-10-02")}
	in.Enveloppes = map[string]domain.Enveloppe{"S": fcEnv("2026-09-07", "2026-09-20", 2000)} // W37..W38 < as_of W40
	pv := Run(in, s).Previsions
	p := findCT(t, pv, "S")
	// Consommé de la période = 500 € (1 500 € après la fin) ; le reste (1 500 €) est perdu, sous les 5 000 €.
	if p.Echeance != "2026-09-20" || p.SemainesEcheance != 0 || p.Consomme != 500 || p.ConsommeHorsEnveloppe != 1500 ||
		p.PlanHorsEnveloppe != 8000 || p.ProjectionPlanEcheance != 500 || p.ProjectionTendanceEcheance != 500 ||
		fv(p.RythmeNecessaire) != 0 || fv(p.NonConsomme) != 1500 || p.SousConsommation ||
		fv(p.CibleMin) != 0 || fs(p.Statut) != domain.PrevisionOK {
		t.Errorf("échéance passée = %+v", p)
	}
	checkBudget(t, p, s)
	checkBudget(t, pv.Global, s)
	checkInvariants(t, pv.Global, pv.AsOf)
}

func TestFcBudgetSeuils(t *testing.T) {
	s := store.DefaultSettings() // 10 % et 5 000 €
	cases := []struct {
		name            string
		budget, plan, t float64
		nc              float64
		sous            bool
	}{
		{"pct seul", 20000, 16000, 30000, 4000, false},      // 20 % mais 4 000 €
		{"eur seul", 100000, 92000, 95000, 8000, false},     // 8 000 € mais 8 %
		{"les deux", 50000, 42000, 60000, 8000, true},       // 16 % et 8 000 €
		{"tendance basse", 50000, 60000, 42000, 0, false},   // plan au-delà : la tendance ne compte pas (n° 21)
		{"égalité", 50000, 40000, 40000, 10000, true},       // plan = tendance
		{"au-delà", 10000, 12000, 11000, 0, false},          // projections au-delà du budget
		{"tolérance", 50000, 45000.4, 46000, 4999.6, false}, // ≤ 5 000 € + tolérance
	}
	for _, c := range cases {
		var p domain.PrevisionCT
		fc := fcCalc{budgeted: true, budget: c.budget, atterPlan: c.plan, atterTend: c.t, sr: 1, echeance: "2026-12-31"}
		fc.nc = fcNonConsomme(c.budget, c.plan)
		fcBudget(&p, fc, s)
		if fv(p.NonConsomme) != c.nc || p.SousConsommation != c.sous {
			t.Errorf("%s : non consommé %v, sous-conso %v", c.name, fv(p.NonConsomme), p.SousConsommation)
		}
		// Atterrir (plan) sous cible_min = sous-consommation (mêmes seuils), hors tolérance.
		if c.name != "tolérance" && (c.plan < fv(p.CibleMin)) != c.sous {
			t.Errorf("%s : cible_min %v incohérente avec la sous-consommation %v", c.name, fv(p.CibleMin), c.sous)
		}
	}
}

// TestFcCibleMin: zone cible [cible_min, budget] (DECISIONS n° 20).
func TestFcCibleMin(t *testing.T) {
	s := store.DefaultSettings() // 10 % et 5 000 €
	cases := []struct {
		name         string
		pct, eur     float64
		budget, want float64
	}{
		{"pourcentage", 10, 5000, 100000, 90000}, // 10 % = 10 000 € > 5 000 €
		{"euros", 10, 5000, 20000, 15000},        // 10 % = 2 000 € < 5 000 €
		{"bascule", 10, 5000, 50000, 45000},      // 10 % = 5 000 € = seuil €
		{"plancher", 10, 5000, 3000, 0},          // 3 000 − 5 000 < 0
		{"enveloppe nulle", 10, 5000, 0, 0},
		{"seuils nuls", 0, 0, 12345, 12345},
		{"pourcentage seul", 25, 0, 8000, 6000},
	}
	for _, c := range cases {
		s.SeuilSousConsoPct, s.SeuilSousConsoEur = c.pct, c.eur
		if got := round2(fcCibleMin(c.budget, s)); got != c.want {
			t.Errorf("%s : cible_min %v, attendu %v", c.name, got, c.want)
		}
		var p domain.PrevisionCT
		fcBudget(&p, fcCalc{budgeted: true, budget: c.budget, echeance: "2026-12-31"}, s)
		if fv(p.CibleMin) != c.want {
			t.Errorf("%s : PrevisionCT.cible_min %v, attendu %v", c.name, fv(p.CibleMin), c.want)
		}
	}
}

// fcEnv: une enveloppe importée (DECISIONS n° 18, 19).
func fcEnv(debut, fin string, montant float64) domain.Enveloppe {
	return domain.Enveloppe{DateDebut: debut, DateFin: fin, Montant: montant}
}

// fcPoint returns the point of week w of a series.
func fcPoint(t *testing.T, p domain.PrevisionCT, w string) domain.PrevisionPoint {
	t.Helper()
	for _, pt := range p.Series {
		if pt.Week == w {
			return pt
		}
	}
	t.Fatalf("%s : semaine %s absente", p.CT, w)
	return domain.PrevisionPoint{}
}

// enveloppesScenario: as_of 01/10/2026 (W40), semaines pleines.
//   - A : enveloppe couvrante 8 000 € en dépassement, 1 500 € planifiés en 2027 ;
//   - B : enveloppe W37..W44 de 30 000 € en sous-consommation, réalisé et plan hors période ;
//   - C : sans enveloppe (aucun budget) ;
//   - N : enveloppe pas encore commencée ; F : enveloppe terminée ;
//   - Z : enveloppe de 0 € avec consommation ; Q : enveloppe seule (aucune source).
func enveloppesScenario() (Input, domain.Settings) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in,
		fcLine("A", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"), // W37..W46, 1 000 €/sem.
		fcLine("A", 0, 1500, "2027-01-11", "2027-01-22", "FRAIS"),  // hors enveloppe
		fcLine("B", 0, 20000, "2026-09-07", "2026-11-13", "FRAIS"), // W37..W46, 2 000 €/sem.
		fcLine("C", 0, 1000, "2026-09-14", "2026-09-18", "FRAIS"),
		fcLine("N", 0, 4000, "2026-11-02", "2026-11-27", "FRAIS"), // W45..W48
		fcLine("F", 0, 3000, "2026-09-07", "2026-09-25", "FRAIS"), // W37..W39
	)
	in.Entries = []domain.RealiseEntry{
		fcEntry("A", 1000, "2026-09-08"), fcEntry("A", 1000, "2026-09-15"),
		fcEntry("A", 1000, "2026-09-22"), fcEntry("A", 1000, "2026-09-29"),
		fcEntry("A", 250, ""), // sans date : compté au consommé
		fcEntry("B", 2000, "2026-09-08"), fcEntry("B", 2000, "2026-09-15"),
		fcEntry("B", 2000, "2026-09-22"), fcEntry("B", 2000, "2026-09-29"),
		fcEntry("B", 700, "2026-08-20"), // W34 : avant l'enveloppe
		fcEntry("C", 1500, "2026-09-15"),
		fcEntry("F", 1000, "2026-09-08"), fcEntry("F", 1000, "2026-09-15"),
		fcEntry("F", 1000, "2026-09-22"), // après la fin de l'enveloppe (20/09)
		fcEntry("Z", 300, "2026-10-01"),  // as_of
	}
	in.Enveloppes = map[string]domain.Enveloppe{
		"A": fcEnv("2026-09-01", "2026-12-31", 8000),
		"B": fcEnv("2026-09-07", "2026-10-30", 30000),
		"N": fcEnv("2026-11-01", "2026-12-31", 5000),
		"F": fcEnv("2026-09-01", "2026-09-20", 10000),
		"Z": fcEnv("2026-01-01", "2026-12-31", 0),
		"Q": fcEnv("2026-01-01", "2026-12-31", 99999),
	}
	return in, s
}

func TestPrevisionsEnveloppes(t *testing.T) {
	in, s := enveloppesScenario()
	res := Run(in, s)
	pv := res.Previsions
	if pv.AsOf != "2026-10-01" || pv.AsOfWeek != "2026-W40" {
		t.Fatalf("as_of = %q / %q", pv.AsOf, pv.AsOfWeek)
	}
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		checkBudget(t, p, s)
	}

	// A : couvrante, dépassement. Consommé 4 000 + 250 sans date ; reste W41..W46 ;
	// tendance jusqu'au 31/12 (W53) : 13 semaines × 1 000.
	a := findCT(t, pv, "A")
	if a.BudgetSource != "enveloppe" || a.Enveloppe == nil || a.Enveloppe.Montant != 8000 || fv(a.Budget) != 8000 ||
		a.PPS != 11500 || a.Consomme != 4250 || a.ResteAFaire != 6000 || a.AtterrissagePlan != 10250 || fv(a.EcartPlan) != 2250 ||
		a.SemainesRestantes != 13 || a.RythmeHebdo != 1000 || a.AtterrissageTendance != 17250 || fs(a.Statut) != domain.PrevisionDepassement ||
		a.PlanHorsEnveloppe != 1500 || a.ConsommeHorsEnveloppe != 0 || fv(a.PctConsomme) != 53.13 {
		t.Errorf("A = %+v", a)
	}
	if a.Echeance != "2026-12-31" || fv(a.BudgetEcheance) != 8000 || a.SemainesEcheance != 13 ||
		fv(a.NonConsomme) != 0 || a.SousConsommation || fv(a.CibleMin) != 3000 {
		t.Errorf("A échéance = %+v", a)
	}
	// Séries : le prévu de 2027 n'entre pas dans le cumul ; l'axe va jusqu'à W53 au moins.
	if pt := fcPoint(t, a, "2026-W53"); pt.BudgetCumul != 10000 || *pt.PlanCumul != 10250 || *pt.TendanceCumul != 17250 {
		t.Errorf("A W53 = %+v", pt)
	}
	if pt := fcPoint(t, a, "2027-W03"); pt.BudgetCumul != 10000 || *pt.PlanCumul != 10250 {
		t.Errorf("A 2027-W03 = %+v", pt)
	}
	// L'axe couvre l'union des périodes : Z commence le 01/01/2026 (W01).
	if a.Series[0].Week != "2026-W01" {
		t.Errorf("axe : début %s", a.Series[0].Week)
	}

	// B : période W37..W44, sous-consommation ; réalisé de W34 et prévu W45..W46 à part.
	b := findCT(t, pv, "B")
	if fv(b.Budget) != 30000 || b.Consomme != 8000 || b.ConsommeHorsEnveloppe != 700 || b.PlanHorsEnveloppe != 4000 ||
		b.ResteAFaire != 8000 || b.AtterrissagePlan != 16000 || b.SemainesRestantes != 4 || b.RythmeHebdo != 2000 ||
		b.AtterrissageTendance != 16000 || fs(b.Statut) != domain.PrevisionOK {
		t.Errorf("B = %+v", b)
	}
	if b.Echeance != "2026-10-30" || fv(b.BudgetEcheance) != 30000 || b.SemainesEcheance != 4 ||
		b.ProjectionPlanEcheance != 16000 || b.ProjectionTendanceEcheance != 16000 || fv(b.NonConsomme) != 14000 ||
		fv(b.RythmeNecessaire) != 5500 || !b.SousConsommation || fv(b.CibleMin) != 25000 {
		t.Errorf("B échéance = %+v", b)
	}
	// 0 avant la période (le réalisé de W34 n'y est pas), plat après W44 ; heures réelles inchangées.
	if pt := fcPoint(t, b, "2026-W34"); pt.BudgetCumul != 0 || pt.ReelCumul == nil || *pt.ReelCumul != 0 {
		t.Errorf("B W34 = %+v", pt)
	}
	for _, w := range []string{"2026-W44", "2026-W46", "2026-W53"} {
		if pt := fcPoint(t, b, w); pt.BudgetCumul != 16000 || *pt.PlanCumul != 16000 || *pt.TendanceCumul != 16000 {
			t.Errorf("B %s = %+v", w, pt)
		}
	}

	// C : sans enveloppe — aucun budget, horizon = son plan (terminé en W38).
	c := findCT(t, pv, "C")
	if c.BudgetSource != "aucun" || c.Enveloppe != nil || c.Budget != nil || c.Statut != nil || c.Echeance != "" ||
		c.Consomme != 1500 || c.AtterrissagePlan != 1500 || c.AtterrissageTendance != 1500 || c.PPS != 1000 {
		t.Errorf("C = %+v", c)
	}

	// N : pas encore commencée — consommé 0, reste = prévu de la période, 13 semaines jusqu'au 31/12 ;
	// non consommé = 5 000 − 4 000 du plan (la tendance nulle n'y entre pas, n° 21).
	n := findCT(t, pv, "N")
	if n.Consomme != 0 || n.ResteAFaire != 4000 || n.AtterrissagePlan != 4000 || n.AtterrissageTendance != 0 || fs(n.Statut) != domain.PrevisionOK ||
		n.SemainesEcheance != 13 || fv(n.NonConsomme) != 1000 || n.SousConsommation ||
		fv(n.RythmeNecessaire) != 384.62 || fv(n.CibleMin) != 0 {
		t.Errorf("N = %+v", n)
	}

	// F : terminée le 20/09 (W38) — plus rien à faire, le reste est perdu.
	f := findCT(t, pv, "F")
	if f.Consomme != 2000 || f.ConsommeHorsEnveloppe != 1000 || f.PlanHorsEnveloppe != 1000 || f.ResteAFaire != 0 ||
		f.SemainesRestantes != 0 || f.SemainesEcheance != 0 || f.AtterrissagePlan != 2000 || f.AtterrissageTendance != 2000 ||
		f.Echeance != "2026-09-20" || fv(f.NonConsomme) != 8000 || fv(f.RythmeNecessaire) != 0 || !f.SousConsommation {
		t.Errorf("F = %+v", f)
	}

	// Z : enveloppe de 0 € consommée → dépassement.
	z := findCT(t, pv, "Z")
	if fv(z.Budget) != 0 || fs(z.Statut) != domain.PrevisionDepassement || fv(z.EcartPlan) != 300 || z.PctConsomme != nil ||
		z.BudgetSource != "enveloppe" || fv(z.CibleMin) != 0 {
		t.Errorf("Z = %+v", z)
	}
	// Q : enveloppe sans aucune source → pas de ligne.
	var order []string
	for _, p := range pv.ParCT {
		if p.CT == "Q" {
			t.Error("CT Q (enveloppe seule) : ne doit pas apparaître")
		}
		order = append(order, p.CT)
	}
	checkTri(t, pv.ParCT)
	if strings.Join(order, ",") != "A,Z,N,F,B,C" {
		t.Errorf("tri : %v", order)
	}

	// Global = périmètre des enveloppes (A, B, N, F, Z), chacun sur son budget et son horizon ; C à part.
	gl := pv.Global
	if gl.BudgetSource != "enveloppe" || gl.Enveloppe != nil || fv(gl.Budget) != 53000 || gl.PPS != 38500 || gl.Consomme != 14550 ||
		gl.ResteAFaire != 18000 || gl.AtterrissagePlan != 32550 || gl.AtterrissageTendance != 36525 || gl.RythmeHebdo != 3575 ||
		gl.PlanHorsEnveloppe != 6500 || gl.ConsommeHorsEnveloppe != 1700 || gl.FinPlan != "2027-01-22" ||
		fv(gl.EcartPlan) != -20450 || fv(gl.EcartTendance) != -16475 || fs(gl.Statut) != domain.PrevisionOK || fv(gl.PctConsomme) != 27.45 {
		t.Errorf("global = %+v", gl)
	}
	// Échéance = fin la plus tardive ; non consommé = Σ des CT (0 + 14 000 + 1 000 + 8 000 + 0).
	if gl.Echeance != "2026-12-31" || gl.SemainesEcheance != 13 || fv(gl.BudgetEcheance) != 53000 || gl.ProjectionPlanEcheance != 32550 ||
		gl.ProjectionTendanceEcheance != 36525 || fv(gl.NonConsomme) != 23000 ||
		fv(gl.RythmeNecessaire) != 2957.69 || !gl.SousConsommation || fv(gl.CibleMin) != 47700 {
		t.Errorf("global échéance = %+v", gl)
	}
	// Séries du global = Σ des séries des CT avec enveloppe, sur l'union des périodes (W01..W53).
	if len(gl.Series) != 53 || gl.Series[0].Week != "2026-W01" || gl.Series[52].Week != "2026-W53" {
		t.Errorf("axe global : %d points", len(gl.Series))
	}
	for _, w := range []string{"2026-W37", "2026-W40", "2026-W45"} {
		want := 0.0
		for _, ct := range []string{"A", "B", "N", "F", "Z"} {
			want += fcPoint(t, findCT(t, pv, ct), w).BudgetCumul
		}
		if pt := fcPoint(t, gl, w); !near(pt.BudgetCumul, want, 0.02) {
			t.Errorf("global %s : budget_cumul %v ≠ Σ %v", w, pt.BudgetCumul, want)
		}
	}
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, Consomme: 1500, AtterrissagePlan: 1500, AtterrissageTendance: 1500}) {
		t.Errorf("hors enveloppe = %+v", pv.HorsEnveloppe)
	}

	want := domain.EnveloppesSynthese{NbCT: 6, NbConfigures: 5, Montant: 53000, Atterrissage: 32550, Ecart: -20450,
		Depassement: 2550, NbDepassement: 2, NonConsomme: 23000, NbSousConsommation: 2, PlanHorsEnveloppe: 6500}
	if pv.Enveloppes != want {
		t.Errorf("synthèse = %+v, attendu %+v", pv.Enveloppes, want)
	}
	checkSynthese(t, pv)
}

func TestPrevisionsEnveloppesSources(t *testing.T) {
	in, s := enveloppesScenario()
	// Enveloppe d'un CT absent des sources seulement : résultat identique à « aucune enveloppe ».
	in.Enveloppes = nil
	sans := Run(in, s).Previsions
	in.Enveloppes = map[string]domain.Enveloppe{"Q": fcEnv("2026-01-01", "2027-12-31", 1)}
	if q := Run(in, s).Previsions; !reflect.DeepEqual(q, sans) {
		t.Errorf("enveloppe hors sources : résultat modifié\n%+v\n%+v", q.Global, sans.Global)
	}
	if sans.Global.BudgetSource != "aucun" || sans.Enveloppes != (domain.EnveloppesSynthese{NbCT: 6}) || sans.HorsEnveloppe.NbCT != 6 {
		t.Errorf("sans enveloppe : %q, %+v, %+v", sans.Global.BudgetSource, sans.Enveloppes, sans.HorsEnveloppe)
	}
	for _, p := range append(sans.ParCT, sans.Global) {
		checkInvariants(t, p, sans.AsOf)
	}

	// Tous les CT configurés → global « enveloppe », rien hors enveloppe ; dates illisibles ou inversées → ignorée.
	in = baseInput()
	onePlan(&in, fcLine("A", 0, 1000, "2026-09-07", "2026-09-11", "FRAIS"), fcLine("B", 0, 1000, "2026-09-07", "2026-09-11", "FRAIS"))
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-09-01", "2026-09-30", 2000), "B": fcEnv("2026-09-01", "2026-09-30", 500)}
	pv := Run(in, s).Previsions
	if pv.Global.BudgetSource != "enveloppe" || fv(pv.Global.Budget) != 2500 || pv.Enveloppes.NbConfigures != 2 || pv.HorsEnveloppe != (domain.HorsEnveloppe{}) {
		t.Errorf("tout configuré : %q, budget %v, %+v", pv.Global.BudgetSource, fv(pv.Global.Budget), pv.Enveloppes)
	}
	in.Enveloppes["B"] = fcEnv("2026-09-30", "2026-09-01", 500)
	in.Enveloppes["A"] = fcEnv("n/a", "2026-09-30", 2000)
	if pv := Run(in, s).Previsions; pv.Global.BudgetSource != "aucun" || pv.Global.Budget != nil || pv.HorsEnveloppe.NbCT != 2 ||
		pv.HorsEnveloppe.AtterrissagePlan != 2000 {
		t.Errorf("enveloppes invalides : %q, budget %v, %+v", pv.Global.BudgetSource, pv.Global.Budget, pv.HorsEnveloppe)
	}
}

func TestEnveloppesQualiteEtAnomalies(t *testing.T) {
	in, s := enveloppesScenario()
	s.SeuilEcartTGEur = 5000
	res := Run(in, s)
	// Règle 1 : référence = montant de l'enveloppe (réalisé hors période compris, toute la version).
	q := findQual(res, "tg_ecart_budget")
	if q == nil || q.Count != 2 || len(q.Details) != 2 || q.Details[0] != "B : réalisé 8700 € / enveloppe 30000 €" ||
		q.Details[1] != "F : réalisé 3000 € / enveloppe 10000 €" {
		t.Errorf("tg_ecart_budget : %+v", q)
	}

	nb := func(s string) string { return strings.ReplaceAll(s, " ", " ") }
	byKey := map[string]domain.Anomalie{}
	for _, a := range res.Anomalies {
		byKey[a.Key] = a
	}
	checkAnomalies(t, res.Anomalies)
	if a := byKey["budget|A"]; nb(a.Titre) != "Atterrissage · A : dépassement prévu (+2 250 €)" ||
		nb(a.Detail) != "Atterrissage prévu 10 250 € pour une enveloppe de 8 000 € (01/09/2026 → 31/12/2026) (tendance 17 250 €) · 1 500 € planifiés hors enveloppe" {
		t.Errorf("anomalie A = %+v", a)
	}
	// Enveloppe de 0 € : dépassement.
	if a := byKey["budget|Z"]; nb(a.Titre) != "Atterrissage · Z : dépassement prévu (+300 €)" ||
		nb(a.Detail) != "Atterrissage prévu 300 € pour une enveloppe de 0 € (01/01/2026 → 31/12/2026) (tendance 1 275 €)" {
		t.Errorf("anomalie Z = %+v", a)
	}
	if a := byKey["budget_sous_conso|B"]; nb(a.Titre) != "Sous-consommation · B : 14 000 € non consommés par le plan de charge et les provisions sécurisées à la fin de l'enveloppe, le 30/10/2026 (47 %)" ||
		nb(a.Detail) != "Enveloppe 30 000 € (07/09/2026 → 30/10/2026) ; atterrissage plan 16 000 € (tendance 16 000 €, repère) ; il faudrait 5 500 €/sem contre 2 000 €/sem" ||
		a.Montant == nil || *a.Montant != 14000 {
		t.Errorf("anomalie B = %+v", a)
	}
	if _, ok := byKey["budget_sous_conso|F"]; !ok {
		t.Error("sous-consommation de F (enveloppe terminée) absente")
	}
	// C (sans enveloppe, réalisé > plan) : aucune anomalie budget.
	if _, ok := byKey["budget|C"]; ok {
		t.Error("anomalie budget sur C (sans enveloppe)")
	}
	a := byKey["budget|A"]
	if a.Fingerprint != fingerprint(string(domain.PrevisionDepassement), fpE(8000), fpE(10250), fpE(17250)) {
		t.Errorf("empreinte A = %s", a.Fingerprint)
	}

	// Sans enveloppe : ni règle 1, ni anomalie budget.
	in.Enveloppes = nil
	res = Run(in, s)
	if q := findQual(res, "tg_ecart_budget"); q != nil {
		t.Errorf("tg_ecart_budget sans enveloppe : %+v", q)
	}
	for _, a := range res.Anomalies {
		if a.Categorie == domain.AnomalieBudget {
			t.Errorf("anomalie budget sans enveloppe : %+v", a)
		}
	}
}

// checkSynthese: dépassement agrégé = Σ ecart_plan des seuls CT en dépassement,
// d'où dépassement > 0 ⇔ nb_depassement > 0 (DECISIONS n° 22) ; non consommé =
// Σ des CT, sans compensation (n° 21).
func checkSynthese(t *testing.T, pv domain.Previsions) {
	t.Helper()
	e := pv.Enveloppes
	dep, nc, nb := 0.0, 0.0, 0
	for _, p := range pv.ParCT {
		if p.Enveloppe == nil {
			continue
		}
		nc += fv(p.NonConsomme)
		if fs(p.Statut) == domain.PrevisionDepassement {
			dep += fv(p.EcartPlan)
			nb++
		}
	}
	if (e.Depassement > 0) != (e.NbDepassement > 0) || e.NbDepassement != nb || !near(e.Depassement, dep, 0.02) {
		t.Errorf("synthèse : dépassement %v pour %d CT, attendu %v pour %d CT", e.Depassement, e.NbDepassement, dep, nb)
	}
	if !near(e.NonConsomme, nc, 0.02) || (pv.Global.NonConsomme != nil && fv(pv.Global.NonConsomme) != e.NonConsomme) {
		t.Errorf("synthèse : non consommé %v, Σ CT %v, global %v", e.NonConsomme, nc, fv(pv.Global.NonConsomme))
	}
}

// TestPrevisionsNonConsommePlanSeul: le non consommé est la part de l'enveloppe
// que le plan de charge ne consommera pas, jamais la tendance (DECISIONS n° 21).
// as_of 01/10/2026 (W40), enveloppes jusqu'au 31/12 (W53) : 13 semaines restantes.
func TestPrevisionsNonConsommePlanSeul(t *testing.T) {
	s := store.DefaultSettings() // 10 % et 5 000 €
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in,
		// T : 10 000 € planifiés sur W41..W50 + 100 € consommés = enveloppe ; rythme 25 €/sem.
		fcLine("T", 0, 10000, "2026-10-05", "2026-12-11", "FRAIS"),
		// U : 10 000 € planifiés sur W41..W50 + 1 000 € consommés > enveloppe de 8 000 € ; rythme 250 €/sem.
		fcLine("U", 0, 10000, "2026-10-05", "2026-12-11", "FRAIS"),
		// V : plan terminé en W39, rien de planifié après as_of.
		fcLine("V", 0, 3000, "2026-09-07", "2026-09-25", "FRAIS"),
	)
	in.Entries = []domain.RealiseEntry{
		fcEntry("T", 100, "2026-10-01"),
		fcEntry("U", 250, "2026-09-08"), fcEntry("U", 250, "2026-09-15"),
		fcEntry("U", 250, "2026-09-22"), fcEntry("U", 250, "2026-09-29"),
		fcEntry("V", 1000, "2026-09-08"), fcEntry("V", 1000, "2026-09-15"), fcEntry("V", 1000, "2026-09-22"),
		fcEntry("W", 500, "2026-09-29"), // W : aucun plan importé pour ce CT
	}
	in.Enveloppes = map[string]domain.Enveloppe{
		"T": fcEnv("2026-09-01", "2026-12-31", 10100),
		"U": fcEnv("2026-09-01", "2026-12-31", 8000),
		"V": fcEnv("2026-09-01", "2026-12-31", 20000),
		"W": fcEnv("2026-09-01", "2026-12-31", 6000),
	}
	res := Run(in, s)
	pv := res.Previsions
	if pv.AsOf != "2026-10-01" {
		t.Fatalf("as_of = %q", pv.AsOf)
	}
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		checkBudget(t, p, s)
	}
	checkSynthese(t, pv)
	byKey := map[string]domain.Anomalie{}
	for _, a := range res.Anomalies {
		byKey[a.Key] = a
	}

	// (a) Plan dans la zone cible (= enveloppe), tendance très basse (100 + 25 × 13 = 425) :
	// rien de non consommé (l'ancienne règle donnait 10 100 − 425 = 9 675 €).
	tc := findCT(t, pv, "T")
	if tc.ProjectionPlanEcheance != 10100 || tc.ProjectionTendanceEcheance != 425 || fv(tc.CibleMin) != 5100 ||
		fv(tc.NonConsomme) != 0 || tc.SousConsommation || fs(tc.Statut) != domain.PrevisionVigilance {
		t.Errorf("T = %+v", tc)
	}
	if a, ok := byKey["budget_sous_conso|T"]; ok {
		t.Errorf("sous-consommation de T portée par la tendance : %+v", a)
	}

	// (b) Plan au-dessus de l'enveloppe (1 000 + 10 000), tendance dedans (1 000 + 250 × 13 = 4 250,
	// dans la zone cible [3 000, 8 000]) : non consommé nul, dépassement = ecart_plan.
	u := findCT(t, pv, "U")
	if u.ProjectionPlanEcheance != 11000 || u.ProjectionTendanceEcheance != 4250 || fv(u.NonConsomme) != 0 ||
		fv(u.EcartPlan) != 3000 || fs(u.Statut) != domain.PrevisionDepassement || u.SousConsommation {
		t.Errorf("U = %+v", u)
	}

	// (c) Rien de planifié après as_of : atterrissage plan = consommé, non consommé =
	// enveloppe − consommé, que le plan soit terminé (V) ou absent (W) ; série plan plate.
	v := findCT(t, pv, "V")
	if v.ResteAFaire != 0 || v.ProjectionPlanEcheance != 3000 || fv(v.NonConsomme) != 20000-v.Consomme ||
		fv(v.NonConsomme) != 17000 || !v.SousConsommation || v.ProjectionTendanceEcheance != 12750 {
		t.Errorf("V = %+v", v)
	}
	if pt := fcPoint(t, v, "2026-W53"); pt.PlanCumul == nil || *pt.PlanCumul != 3000 {
		t.Errorf("V W53 = %+v", pt)
	}
	w := findCT(t, pv, "W")
	if w.PPS != 0 || w.ResteAFaire != 0 || w.ProjectionPlanEcheance != 500 || fv(w.NonConsomme) != 5500 || !w.SousConsommation {
		t.Errorf("W = %+v", w)
	}
	if a := byKey["budget_sous_conso|V"]; a.Montant == nil || *a.Montant != 17000 {
		t.Errorf("anomalie V = %+v", a)
	}

	// Global : Σ des CT (0 + 0 + 17 000 + 5 500), sans compensation.
	if fv(pv.Global.NonConsomme) != 22500 || pv.Enveloppes.NonConsomme != 22500 || pv.Enveloppes.NbSousConsommation != 2 {
		t.Errorf("global non consommé %v, synthèse %+v", fv(pv.Global.NonConsomme), pv.Enveloppes)
	}
}

// TestPrevisionsGlobalNonConsommeSansCompensation: un CT en dépassement ne
// finance pas un CT qui ne consomme pas (DECISIONS n° 21).
func TestPrevisionsGlobalNonConsommeSansCompensation(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in,
		fcLine("A", 0, 8000, "2026-10-05", "2026-10-30", "FRAIS"), // W41..W44
		fcLine("B", 0, 2000, "2026-10-05", "2026-10-16", "FRAIS"), // W41..W42
	)
	in.Entries = []domain.RealiseEntry{fcEntry("X", 100, "2026-10-01")} // as_of, CT sans enveloppe
	in.Enveloppes = map[string]domain.Enveloppe{
		"A": fcEnv("2026-09-01", "2026-12-31", 5000),
		"B": fcEnv("2026-09-01", "2026-12-31", 10000),
	}
	pv := Run(in, s).Previsions
	for _, p := range append(pv.ParCT, pv.Global) {
		checkInvariants(t, p, pv.AsOf)
		checkBudget(t, p, s)
	}
	checkSynthese(t, pv)
	a, b := findCT(t, pv, "A"), findCT(t, pv, "B")
	if fs(a.Statut) != domain.PrevisionDepassement || fv(a.EcartPlan) != 3000 || fv(a.NonConsomme) != 0 {
		t.Errorf("A = %+v", a)
	}
	if fv(b.NonConsomme) != 8000 || !b.SousConsommation {
		t.Errorf("B = %+v", b)
	}
	// Global = non consommé de B seul (8 000), pas l'écart net Σ enveloppes − Σ plan (15 000 − 10 000 = 5 000).
	gl := pv.Global
	if fv(gl.Budget) != 15000 || gl.ProjectionPlanEcheance != 10000 || fv(gl.NonConsomme) != fv(b.NonConsomme) ||
		pv.Enveloppes.NonConsomme != fv(b.NonConsomme) || !gl.SousConsommation {
		t.Errorf("global = non consommé %v (B %v), synthèse %+v", fv(gl.NonConsomme), fv(b.NonConsomme), pv.Enveloppes)
	}
	if pv.Enveloppes.Depassement != 3000 || pv.Enveloppes.NbDepassement != 1 || pv.Enveloppes.Ecart != -5000 {
		t.Errorf("synthèse = %+v", pv.Enveloppes)
	}
}

// TestPrevisionsDepassementAgregue: le dépassement agrégé ne somme que les CT
// en dépassement (DECISIONS n° 22) ; un résidu sous fcTolerance reste lisible
// sur sa ligne mais n'est jamais agrégé (cas « 1 € / 0 CT »).
func TestPrevisionsDepassementAgregue(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in, fcLine("R", 0, 10000.10, "2026-10-05", "2026-10-16", "FRAIS")) // W41..W42
	in.Entries = []domain.RealiseEntry{fcEntry("X", 100, "2026-10-01")}         // as_of, CT sans enveloppe
	in.Enveloppes = map[string]domain.Enveloppe{"R": fcEnv("2026-09-01", "2026-12-31", 10000)}

	pv := Run(in, s).Previsions
	checkSynthese(t, pv)
	r := findCT(t, pv, "R")
	if fv(r.EcartPlan) != 0.1 || fs(r.Statut) == domain.PrevisionDepassement {
		t.Errorf("R = écart %v, statut %s", fv(r.EcartPlan), fs(r.Statut))
	}
	if e := pv.Enveloppes; e.Depassement != 0 || e.NbDepassement != 0 || e.Ecart != 0.1 {
		t.Errorf("résidu seul : synthèse %+v", e)
	}

	// + un CT à +4 000 € : seul celui-ci compte.
	in.Plans[0].Lines = append(in.Plans[0].Lines, fcLine("D", 0, 10000, "2026-10-05", "2026-10-16", "FRAIS"))
	in.Enveloppes["D"] = fcEnv("2026-09-01", "2026-12-31", 6000)
	pv = Run(in, s).Previsions
	checkSynthese(t, pv)
	if r := findCT(t, pv, "R"); fv(r.EcartPlan) != 0.1 || fs(r.Statut) == domain.PrevisionDepassement {
		t.Errorf("R = écart %v, statut %s", fv(r.EcartPlan), fs(r.Statut))
	}
	if d := findCT(t, pv, "D"); fv(d.EcartPlan) != 4000 || fs(d.Statut) != domain.PrevisionDepassement {
		t.Errorf("D = écart %v, statut %s", fv(d.EcartPlan), fs(d.Statut))
	}
	if e := pv.Enveloppes; e.Depassement != 4000 || e.NbDepassement != 1 || e.Ecart != 4000.1 {
		t.Errorf("synthèse %+v, attendu dépassement 4 000 pour 1 CT", e)
	}
}
