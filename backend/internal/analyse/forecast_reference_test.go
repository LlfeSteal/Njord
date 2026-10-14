package analyse

import (
	"reflect"
	"testing"
	"time"

	"njord/internal/domain"
	"njord/internal/store"
)

// Date de référence = date d'effet du dernier plan (DECISIONS n° 31).

// TestPrevisionsReferenceMiSemaine: D un jeudi — consommé ≤ as_of, reste à faire
// au jour près, réalisé ≥ D à part, courbes raccordées au point d'as_of_week.
func TestPrevisionsReferenceMiSemaine(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	// A : 10 000 € sur W37..W46 (50 jours ouvrés, 200 €/jour) ; reprev en effet le jeudi 01/10.
	onePlan(&in, fcLine("A", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	refPlan(&in, "2026-10-01")
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-09-01", "2026-11-13", 20000)}
	in.Entries = []domain.RealiseEntry{
		fcEntry("A", 200, "2026-09-02"), // W36, avant D − 28 : consommé, hors rythme
		fcEntry("A", 100, "2026-09-03"), // D − 28 : dans le rythme
		fcEntry("A", 1000, "2026-09-08"), fcEntry("A", 1000, "2026-09-15"), fcEntry("A", 1000, "2026-09-22"),
		fcEntry("A", 500, "2026-09-29"),           // W40, ≤ as_of (mercredi 30/09)
		fcEntry("A", 300, "2026-10-02"),           // W40, ≥ D : réalisé depuis la référence
		mo("A", "DURAND Claire", 7, "2026-10-06"), // W41, ≥ D : 700 €, 7 h
		fcEntry("A", 50, "2026-11-20"),            // ≥ D mais hors période : hors enveloppe d'abord
		fcEntry("H", 250, "2026-10-05"),           // CT sans enveloppe, ≥ D
		fcEntry("H", 40, "2026-09-30"),            // CT sans enveloppe, ≤ as_of
	}
	pv := Run(in, s).Previsions
	if pv.DateReference != "2026-10-01" || pv.AsOf != "2026-09-30" || pv.AsOfWeek != "2026-W40" || pv.DernierRealise != "2026-11-20" {
		t.Fatalf("référence %q, as_of %q / %q, dernier réalisé %q", pv.DateReference, pv.AsOf, pv.AsOfWeek, pv.DernierRealise)
	}
	a := findCT(t, pv, "A")
	// Consommé = 200 + 100 + 3 000 + 500 ; reste = jeudi et vendredi de W40 (400) + W41..W46 (6 000) ;
	// rythme = [03/09, 30/09] ÷ 4 = 3 600 / 4 ; tendance = 3 800 + 900 × 6.
	if a.Consomme != 3800 || a.ResteAFaire != 6400 || a.AtterrissagePlan != 10200 || a.RythmeHebdo != 900 ||
		a.SemainesRestantes != 6 || a.AtterrissageTendance != 9200 || a.RealiseDepuisReference != 1000 ||
		a.ConsommeHorsEnveloppe != 50 || fv(a.NonConsomme) != 9800 {
		t.Errorf("A = %+v", a)
	}
	checkBudget(t, a, s)
	// Courbes : réel ≤ as_of au point de W40 (= consommé, départ des projections) ; le
	// réalisé ≥ D (300 €) et le plan ≥ D (400 €) de W40 sont cumulés au point suivant.
	want := []struct {
		w          string
		reel       float64 // NaN : pas de réel
		plan, tend float64 // NaN : pas de projection
		hr         float64
	}{
		{"2026-W36", 300, nan, nan, 0},
		{"2026-W39", 3300, nan, nan, 0},
		{"2026-W40", 3800, 3800, 3800, 0},
		{"2026-W41", 3800 + 300 + 700, 3800 + 400 + 1000, 4700, 7},
		{"2026-W42", 4800, 6200, 5600, 0},
		{"2026-W46", 4800, 10200, 9200, 0},
		{"2026-W47", 4800, 10200, 9200, 0}, // semaine du dernier réalisé (hors période) : réel plat
	}
	for _, x := range want {
		pt := fcPoint(t, a, x.w)
		if !sameF(pt.ReelCumul, x.reel) || !sameF(pt.PlanCumul, x.plan) || !sameF(pt.TendanceCumul, x.tend) ||
			(pt.HeuresReel != nil && *pt.HeuresReel != x.hr) {
			t.Errorf("A %s = réel %v plan %v tendance %v heures %v", x.w, fv(pt.ReelCumul), fv(pt.PlanCumul), fv(pt.TendanceCumul), fv(pt.HeuresReel))
		}
	}
	if pt := fcPoint(t, a, "2026-W40"); pt.BudgetCumul != 4000 {
		t.Errorf("budget_cumul W40 = %v (plan de toutes les versions)", pt.BudgetCumul)
	}
	// Global = A seul ; hors enveloppe = H.
	if g := pv.Global; g.RealiseDepuisReference != 1000 || g.Consomme != 3800 || g.ResteAFaire != 6400 ||
		fv(fcPoint(t, g, "2026-W41").ReelCumul) != 4800 {
		t.Errorf("global = %+v", g)
	}
	if pv.HorsEnveloppe != (domain.HorsEnveloppe{NbCT: 1, Consomme: 40, RealiseDepuisReference: 250, AtterrissagePlan: 40, AtterrissageTendance: 40}) {
		t.Errorf("hors enveloppe = %+v", pv.HorsEnveloppe)
	}
	if h := findCT(t, pv, "H"); h.RealiseDepuisReference != 250 || h.Consomme != 40 || h.RythmeHebdo != 10 {
		t.Errorf("H = %+v", h)
	}

	// Le réalisé ≥ D ne bouge pas l'atterrissage (photo de la reprev) ; seul le réalisé
	// antérieur à D (correction) le fait.
	in.Entries = append(in.Entries, fcEntry("A", 5000, "2026-10-08"))
	if b := findCT(t, Run(in, s).Previsions, "A"); b.AtterrissagePlan != 10200 || b.RealiseDepuisReference != 6000 || b.RythmeHebdo != 900 {
		t.Errorf("A après réalisé ≥ D = %+v", b)
	}
	in.Entries = append(in.Entries, fcEntry("A", 100, "2026-09-30"))
	if b := findCT(t, Run(in, s).Previsions, "A"); b.AtterrissagePlan != 10300 || b.Consomme != 3900 {
		t.Errorf("A après correction antérieure à D = %+v", b)
	}
}

var nan = fv(nil)

// sameF compares a nullable figure with want (NaN = nil attendu).
func sameF(p *float64, want float64) bool {
	if want != want {
		return p == nil
	}
	return p != nil && *p == want
}

// TestPrevisionsReferenceRythme: rythme = réalisé daté dans [D − 28 j, D − 1] ÷ 4,
// bornes comprises ; D exclu (réalisé depuis la référence).
// TestPrevisionsReferenceDernierDansSemaine: dernier réalisé dans la semaine
// d'as_of — le réel ≥ D de cette semaine, cumulé au point suivant, reste tracé.
func TestPrevisionsReferenceDernierDansSemaine(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	onePlan(&in, fcLine("A", 0, 10000, "2026-09-07", "2026-11-13", "FRAIS"))
	refPlan(&in, "2026-10-01")
	in.Enveloppes = map[string]domain.Enveloppe{"A": fcEnv("2026-09-01", "2026-11-13", 20000)}
	in.Entries = []domain.RealiseEntry{
		fcEntry("A", 500, "2026-09-29"), // W40, ≤ as_of
		fcEntry("A", 300, "2026-10-02"), // W40, ≥ D : dernier réalisé
	}
	pv := Run(in, s).Previsions
	if pv.DernierRealise != "2026-10-02" {
		t.Fatalf("dernier réalisé %q", pv.DernierRealise)
	}
	a := findCT(t, pv, "A")
	if p := fcPoint(t, a, "2026-W40"); !sameF(p.ReelCumul, 500) {
		t.Errorf("W40 réel %v, attendu 500 (≤ as_of)", fv(p.ReelCumul))
	}
	if p := fcPoint(t, a, "2026-W41"); !sameF(p.ReelCumul, 800) {
		t.Errorf("W41 réel %v, attendu 800 (réel ≥ D de W40 au point suivant)", fv(p.ReelCumul))
	}
	if p := fcPoint(t, a, "2026-W42"); p.ReelCumul != nil {
		t.Errorf("W42 réel %v, attendu null", fv(p.ReelCumul))
	}
}

func TestPrevisionsReferenceRythme(t *testing.T) {
	in := baseInput()
	onePlan(&in, fcLine("R", 0, 1000, "2026-09-01", "2026-12-31", "FRAIS"))
	refPlan(&in, "2026-10-15")
	in.Entries = []domain.RealiseEntry{
		fcEntry("R", 10000, "2026-09-16"), // D − 29
		fcEntry("R", 400, "2026-09-17"),   // D − 28
		fcEntry("R", 800, "2026-10-14"),   // D − 1
		fcEntry("R", 5000, "2026-10-15"),  // D
	}
	r := findCT(t, Run(in, store.DefaultSettings()).Previsions, "R")
	if r.RythmeHebdo != 300 || r.Consomme != 11200 || r.RealiseDepuisReference != 5000 {
		t.Errorf("R = %+v", r)
	}
}

// TestPrevisionsReferenceRetroactive: D = plus grande date d'effet des fenêtres
// non vides, quel que soit l'ordre d'import ; une version à fenêtre vide ne compte pas.
func TestPrevisionsReferenceRetroactive(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries = nil
	in := baseInput()
	at := func(d string) time.Time { tm, _ := time.Parse(time.DateOnly, d); return tm }
	// PDC octobre (1 000 €/sem., 200 €/jour) importé le 01/10, puis un plan rétroactif en
	// effet au 15/09 (2 000 €/sem.) importé le 10/10 : il gouverne [15/09, 30/09] seulement.
	oct := domain.Version{ID: "oct", Kind: domain.KindPlan, DateEffet: "2026-10-01", ImporteeLe: at("2026-10-01")}
	retro := domain.Version{ID: "retro", Kind: domain.KindPlan, DateEffet: "2026-09-15", ImporteeLe: at("2026-10-10")}
	in.Plans = []PlanSource{
		{Version: oct, Lines: []domain.PlanLine{fcLine("A", 0, 8000, "2026-09-07", "2026-10-30", "FRAIS")}},
		{Version: retro, Lines: []domain.PlanLine{fcLine("A", 0, 16000, "2026-09-07", "2026-10-30", "FRAIS")}},
	}
	in.Entries = []domain.RealiseEntry{fcEntry("A", 500, "2026-10-09")}
	pv := Run(in, s).Previsions
	if tl := BuildTimeline(NewCalendar(s), in.Plans); tl.DateReference() != "2026-10-01" || pv.DateReference != "2026-10-01" || pv.AsOf != "2026-09-30" {
		t.Fatalf("référence %q / %q, as_of %q", tl.DateReference(), pv.DateReference, pv.AsOf)
	}
	// Reste = plan d'octobre à partir du jeudi 01/10 : 2 jours de W40 + W41..W44.
	if a := findCT(t, pv, "A"); a.ResteAFaire != 4400 || a.Consomme != 0 || a.RealiseDepuisReference != 500 {
		t.Errorf("A = %+v", a)
	}
	// Version en effet après la fin de tout plan : fenêtre vide, sans effet sur D.
	late := domain.Version{ID: "late", Kind: domain.KindPlan, DateEffet: "2026-12-01", ImporteeLe: at("2026-10-12")}
	in.Plans = append(in.Plans, PlanSource{Version: late, Lines: []domain.PlanLine{fcLine("A", 0, 100, "2026-09-07", "2026-09-11", "FRAIS")}})
	if pv := Run(in, s).Previsions; pv.DateReference != "2026-10-01" {
		t.Errorf("référence avec fenêtre vide = %q", pv.DateReference)
	}
}

// TestPrevisionsReferenceAnnee: filtre d'année avec D (années proposées depuis
// l'année de D, semaines restantes, réalisé depuis la référence par tranche).
func TestPrevisionsReferenceAnnee(t *testing.T) {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	in := baseInput()
	onePlan(&in, fcLine("Y", 0, 51000, "2026-07-06", "2027-06-25", "FRAIS")) // 1 000 €/sem., 2026-W28..2027-W25
	refPlan(&in, "2026-10-01")
	in.Enveloppes = map[string]domain.Enveloppe{"Y": fcEnv("2026-07-01", "2027-06-30", 36500)}
	in.Entries = []domain.RealiseEntry{
		fcEntry("Y", 1000, "2026-09-29"),
		fcEntry("Y", 300, "2026-10-02"), // ≥ D, en 2026
		fcEntry("Y", 500, "2027-01-12"), // ≥ D, en 2027-W02 (dernier réalisé)
	}
	tout := Run(in, s).Previsions
	if !reflect.DeepEqual(tout.Annees, []int{2026, 2027}) || tout.DernierRealise != "2027-01-12" {
		t.Errorf("annees %v, dernier réalisé %q", tout.Annees, tout.DernierRealise)
	}
	p26, p27 := RunPrevisions(in, s, 2026), RunPrevisions(in, s, 2027)
	y, y26, y27 := findCT(t, tout, "Y"), findCT(t, p26, "Y"), findCT(t, p27, "Y")
	// 2026 : reste = jeudi-vendredi de W40 + W41..W53 ; 13 semaines restantes.
	if y26.Consomme != 1000 || y26.ResteAFaire != 13400 || y26.RealiseDepuisReference != 300 || y26.SemainesRestantes != 13 || y26.RythmeHebdo != 250 {
		t.Errorf("Y 2026 = %+v", y26)
	}
	// 2027 : semaines restantes depuis le début de N (26), reste W01..W25.
	if y27.Consomme != 0 || y27.ResteAFaire != 25000 || y27.RealiseDepuisReference != 500 || y27.SemainesRestantes != 26 || y27.RythmeHebdo != 250 {
		t.Errorf("Y 2027 = %+v", y27)
	}
	if !near(y26.ResteAFaire+y27.ResteAFaire, y.ResteAFaire, 0.02) || y.RealiseDepuisReference != 800 {
		t.Errorf("tranches ≠ tout : %v + %v ≠ %v", y26.ResteAFaire, y27.ResteAFaire, y.ResteAFaire)
	}
	// 2027 : as_of avant l'année, réel jusqu'à la semaine du dernier réalisé (cumulé depuis 0).
	if w1, w2, w3 := fcPoint(t, y27, "2027-W01"), fcPoint(t, y27, "2027-W02"), fcPoint(t, y27, "2027-W03"); fv(w1.ReelCumul) != 0 ||
		fv(w2.ReelCumul) != 500 || w3.ReelCumul != nil || fv(w1.PlanCumul) != 1000 {
		t.Errorf("Y 2027 séries : %v %v %v / plan %v", fv(w1.ReelCumul), fv(w2.ReelCumul), w3.ReelCumul, fv(w1.PlanCumul))
	}
	// 2026 : W40 = consommé ; W41 = + réalisé ≥ D de W40 ; réel jusqu'à la fin de l'année (dernier réalisé en 2027).
	if w40, w41, w53 := fcPoint(t, y26, "2026-W40"), fcPoint(t, y26, "2026-W41"), fcPoint(t, y26, "2026-W53"); fv(w40.ReelCumul) != 1000 ||
		fv(w40.PlanCumul) != 1000 || fv(w41.ReelCumul) != 1300 || fv(w41.PlanCumul) != 2400 || fv(w53.ReelCumul) != 1300 ||
		fv(w53.PlanCumul) != 14400 {
		t.Errorf("Y 2026 séries : W40 %v/%v, W41 %v/%v, W53 %v/%v", fv(w40.ReelCumul), fv(w40.PlanCumul), fv(w41.ReelCumul),
			fv(w41.PlanCumul), fv(w53.ReelCumul), fv(w53.PlanCumul))
	}
	if p26.Global.RealiseDepuisReference != 300 || p27.Global.RealiseDepuisReference != 500 {
		t.Errorf("global : %v / %v", p26.Global.RealiseDepuisReference, p27.Global.RealiseDepuisReference)
	}
}

// TestPrevisionsReferenceSansPlan: sans fenêtre de plan, D = lendemain du dernier
// réalisé, à défaut la date du jour.
func TestPrevisionsReferenceSansPlan(t *testing.T) {
	s := store.DefaultSettings()
	in := baseInput() // Now = 05/10/2026
	in.Entries = []domain.RealiseEntry{fcEntry("A", 100, "2026-09-08"), fcEntry("A", 200, "2026-10-02"), fcEntry("A", 50, "")}
	pv := Run(in, s).Previsions
	if pv.DateReference != "2026-10-03" || pv.AsOf != "2026-10-02" || pv.AsOfWeek != "2026-W40" || pv.DernierRealise != "2026-10-02" {
		t.Fatalf("référence %q, as_of %q / %q, dernier réalisé %q", pv.DateReference, pv.AsOf, pv.AsOfWeek, pv.DernierRealise)
	}
	if a := findCT(t, pv, "A"); a.Consomme != 350 || a.RealiseDepuisReference != 0 || a.RythmeHebdo != 75 {
		t.Errorf("A = %+v", a)
	}
	// Plan sans fenêtre (lignes toutes rejetées) : idem.
	drop := fcLine("A", 0, 1000, "2026-09-07", "2026-09-11", "FRAIS")
	drop.StatutParsing = domain.ParsingDrop
	onePlan(&in, drop)
	if pv := Run(in, s).Previsions; pv.DateReference != "2026-10-03" {
		t.Errorf("plan sans fenêtre : référence %q", pv.DateReference)
	}
	// Ni plan ni réalisé : date du jour.
	if pv := Run(baseInput(), s).Previsions; pv.DateReference != "2026-10-05" || pv.AsOf != "2026-10-04" || pv.DernierRealise != "" {
		t.Errorf("vide : référence %q, as_of %q, dernier réalisé %q", pv.DateReference, pv.AsOf, pv.DernierRealise)
	}
}
