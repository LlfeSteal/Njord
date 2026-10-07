package analyse

import (
	"math"
	"testing"
	"time"

	"njord/internal/domain"
	"njord/internal/store"
)

// plainSettings: calendrier sans férié ni semaine verrouillée (comptes de jours simples).
func plainSettings() domain.Settings {
	s := store.DefaultSettings()
	s.JoursFeries, s.SemainesVerrouillees = nil, nil
	return s
}

// pdc: a plan version imported on day (September 2026) with its date d'effet.
func pdc(id, effet string, day int, lines ...domain.PlanLine) PlanSource {
	v := domain.Version{ID: id, Kind: domain.KindPlan, Intitule: "PDC " + id, Statut: domain.StatutArchivee,
		DateEffet: effet, ImporteeLe: time.Date(2026, 9, day, 10, 0, 0, 0, time.UTC)}
	for i := range lines {
		lines[i].VersionID = id
	}
	return PlanSource{Version: v, Lines: lines}
}

// tlLine: a 100 % MO line of resource nom on ct over [debut, fin].
func tlLine(ct, nom, debut, fin string, charge, pps float64) domain.PlanLine {
	l := planLine(ct, "", nom, nil, charge)
	l.PPS, l.DateDebut, l.DateFin, l.Pourcentage = pps, debut, fin, 100
	return l
}

type segView struct{ ver, ct, res, debut, fin string }

func segViews(tl Timeline) []segView {
	var out []segView
	for _, s := range tl.Segments {
		out = append(out, segView{s.Line.VersionID, s.Line.CT, planLineLabel(&s.Line), s.Line.DateDebut, s.Line.DateFin})
	}
	return out
}

func TestTimelineExempleSpec(t *testing.T) {
	cal := NewCalendar(plainSettings())
	// Sept : 22 j ouvrés ; oct → déc : 66 ; ligne PDC1 = 88 j ouvrés.
	tl := BuildTimeline(cal, []PlanSource{
		pdc("pdc2", "2026-10-01", 30, tlLine("CT2", "DURAND Claire", "2026-10-01", "2026-12-31", 660, 6600)),
		pdc("pdc1", "2026-09-01", 1, tlLine("CT1", "DURAND Claire", "2026-09-01", "2026-12-31", 880, 8800)),
	})
	want := []segView{
		{"pdc1", "CT1", "DURAND Claire", "2026-09-01", "2026-09-30"},
		{"pdc2", "CT2", "DURAND Claire", "2026-10-01", "2026-12-31"},
	}
	if got := segViews(tl); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("segments = %+v", got)
	}
	if s := tl.Segments[0]; !s.Cut || math.Abs(s.Line.ChargeTotale-220) > 1e-9 || math.Abs(s.Line.PPS-2200) > 1e-9 || s.Full.ChargeTotale != 880 {
		t.Errorf("prorata CT1 : %v h, %v €", s.Line.ChargeTotale, s.Line.PPS)
	}
	if s := tl.Segments[1]; s.Line.ChargeTotale != 660 || s.Line.PPS != 6600 {
		t.Errorf("CT2 non coupé : %v h", s.Line.ChargeTotale)
	}
	if len(tl.Windows) != 2 || tl.Windows[0].VersionID != "pdc1" || tl.Windows[0].Debut != "2026-09-01" || tl.Windows[0].Fin != "2026-09-30" ||
		tl.Windows[1].Debut != "2026-10-01" || tl.Windows[1].Fin != "2026-12-31" || tl.Windows[0].DateEffet != "2026-09-01" {
		t.Errorf("fenêtres = %+v", tl.Windows)
	}
	if a, b := tl.Span(); a != "2026-09-01" || b != "2026-12-31" {
		t.Errorf("span %s → %s", a, b)
	}
	if tl.VersionAt("2026-09-30") != "pdc1" || tl.VersionAt("2026-10-01") != "pdc2" || tl.Covered("2027-01-01") || tl.Covered("2026-08-31") {
		t.Error("VersionAt / Covered")
	}
	// Taux conservé : une semaine pleine de septembre vaut 7 h/j × 5 j dans les deux cas.
	full, _ := cal.Distribute("2026-09-01", "2026-12-31", 880)
	cut, _ := cal.Distribute(tl.Segments[0].Line.DateDebut, tl.Segments[0].Line.DateFin, tl.Segments[0].Line.ChargeTotale)
	if math.Abs(full["2026-W38"]-50) > 1e-9 || math.Abs(cut["2026-W38"]-50) > 1e-9 {
		t.Errorf("taux : %v / %v h en W38", full["2026-W38"], cut["2026-W38"])
	}
	// Semaine W40 (28/09 → 04/10) : couverte par pdc1 puis pdc2.
	if c := tl.WeekCoverage(cal, "2026-W40"); c != domain.CouvertureTotale {
		t.Errorf("W40 = %s", c)
	}
}

func TestTimelinePersonneDisparait(t *testing.T) {
	cal := NewCalendar(plainSettings())
	tl := BuildTimeline(cal, []PlanSource{
		pdc("pdc1", "2026-09-01", 1,
			tlLine("CT1", "DURAND Claire", "2026-09-01", "2026-12-31", 880, 0),
			tlLine("CT1", "MARTIN Théo", "2026-09-01", "2026-12-31", 880, 0)),
		pdc("pdc2", "2026-10-01", 30, tlLine("CT1", "DURAND Claire", "2026-10-01", "2026-12-31", 660, 0)),
		// R3 apparaît en novembre.
		pdc("pdc3", "2026-11-01", 31,
			tlLine("CT1", "DURAND Claire", "2026-11-01", "2026-12-31", 440, 0),
			tlLine("CT1", "BLANC Sarah", "2026-11-02", "2026-12-31", 440, 0)),
	})
	got := segViews(tl)
	want := []segView{
		{"pdc1", "CT1", "DURAND Claire", "2026-09-01", "2026-09-30"},
		{"pdc1", "CT1", "MARTIN Théo", "2026-09-01", "2026-09-30"},
		{"pdc2", "CT1", "DURAND Claire", "2026-10-01", "2026-10-31"},
		{"pdc3", "CT1", "DURAND Claire", "2026-11-01", "2026-12-31"},
		{"pdc3", "CT1", "BLANC Sarah", "2026-11-02", "2026-12-31"},
	}
	if len(got) != len(want) {
		t.Fatalf("segments = %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("segment %d = %+v, attendu %+v", i, got[i], want[i])
		}
	}
}

func TestTimelineMemeDateEffetDernierImport(t *testing.T) {
	cal := NewCalendar(plainSettings())
	tl := BuildTimeline(cal, []PlanSource{
		pdc("v1", "2026-09-01", 1, tlLine("CT1", "DURAND Claire", "2026-09-01", "2026-12-31", 880, 0)),
		pdc("v2", "2026-09-01", 2, tlLine("CT9", "DURAND Claire", "2026-09-01", "2026-12-31", 880, 0)), // réimport correctif
	})
	if len(tl.Windows) != 2 || tl.Windows[0].VersionID != "v1" || tl.Windows[0].Debut != "" || tl.Windows[0].Fin != "" ||
		tl.Windows[1].VersionID != "v2" || tl.Windows[1].Debut != "2026-09-01" {
		t.Errorf("fenêtres = %+v", tl.Windows)
	}
	if got := segViews(tl); len(got) != 1 || got[0].ct != "CT9" {
		t.Errorf("segments = %+v", got)
	}
}

func TestTimelineTrouEtFinDePeriode(t *testing.T) {
	cal := NewCalendar(plainSettings())
	tl := BuildTimeline(cal, []PlanSource{
		// pdc1 s'arrête le 16/09 (periode_fin) : trou jusqu'au 30/09.
		pdc("pdc1", "2026-09-01", 1, tlLine("CT1", "DURAND Claire", "2026-09-01", "2026-09-16", 0, 0)),
		// pdc2 : periode_fin = 30/11 (pas de version suivante).
		pdc("pdc2", "2026-10-01", 30, tlLine("CT1", "DURAND Claire", "2026-10-01", "2026-11-30", 0, 0)),
	})
	if tl.Windows[0].Fin != "2026-09-16" || tl.Windows[1].Fin != "2026-11-30" {
		t.Errorf("fenêtres = %+v", tl.Windows)
	}
	for d, want := range map[string]bool{"2026-09-16": true, "2026-09-17": false, "2026-09-30": false, "2026-10-01": true, "2026-12-01": false} {
		if tl.Covered(d) != want {
			t.Errorf("Covered(%s) = %v", d, !want)
		}
	}
	for w, want := range map[string]domain.Couverture{
		"2026-W38": domain.CouverturePartielle, // 14 → 18/09 : lun–mer couverts
		"2026-W39": domain.CouvertureAucune,
		"2026-W40": domain.CouverturePartielle, // jeu–ven couverts
		"2026-W41": domain.CouvertureTotale,
	} {
		if c := tl.WeekCoverage(cal, w); c != want {
			t.Errorf("%s = %s, attendu %s", w, c, want)
		}
	}
	// Semaine verrouillée (0 jour ouvré) : jours calendaires.
	locked := NewCalendar(store.DefaultSettings())
	tl2 := BuildTimeline(locked, []PlanSource{pdc("p", "2026-12-01", 1, tlLine("CT1", "DURAND Claire", "2026-12-01", "2026-12-23", 0, 0))})
	if c := tl2.WeekCoverage(locked, "2026-W52"); c != domain.CouverturePartielle {
		t.Errorf("W52 verrouillée = %s", c)
	}
}

func TestTimelineDateEffetParDefautEtLignesHorsFenetre(t *testing.T) {
	cal := NewCalendar(plainSettings())
	a := pdc("a", "", 1, tlLine("CT1", "DURAND Claire", "2026-09-07", "2026-09-30", 0, 0))
	b := pdc("b", "", 2, tlLine("CT1", "DURAND Claire", "2026-10-05", "2026-10-30", 0, 0))
	b.Version.PeriodeDebut = "2026-10-01"
	// Ligne de c antérieure à sa date d'effet : hors fenêtre. Ligne rejetée : ignorée.
	c := pdc("c", "2026-11-01", 3, tlLine("CT1", "DURAND Claire", "2026-08-01", "2026-08-31", 0, 0), tlLine("CT1", "DURAND Claire", "2026-11-02", "2026-11-30", 0, 0))
	c.Lines = append(c.Lines, domain.PlanLine{CT: "CT1", DateDebut: "2026-11-01", DateFin: "2027-06-30", StatutParsing: domain.ParsingDrop})
	tl := BuildTimeline(cal, []PlanSource{a, b, c})
	if w := tl.Windows; w[0].DateEffet != "2026-09-07" || w[1].DateEffet != "2026-10-01" || w[1].Debut != "2026-10-01" || w[1].Fin != "2026-10-30" ||
		w[2].Fin != "2026-11-30" {
		t.Errorf("fenêtres = %+v", w)
	}
	if got := segViews(tl); len(got) != 3 || got[2].debut != "2026-11-02" {
		t.Errorf("segments = %+v", got)
	}
	// Fin de version antérieure à sa date d'effet → fenêtre vide.
	tl = BuildTimeline(cal, []PlanSource{pdc("d", "2026-12-01", 1, tlLine("CT1", "DURAND Claire", "2026-09-01", "2026-09-30", 0, 0))})
	if tl.Windows[0].Debut != "" || len(tl.Segments) != 0 || tl.Covered("2026-09-15") {
		t.Errorf("fenêtre vide attendue : %+v", tl.Windows)
	}
}

func TestDistributeWindow(t *testing.T) {
	cal := NewCalendar(plainSettings())
	full, _ := cal.Distribute("2026-09-07", "2026-09-18", 100) // 10 j ouvrés
	w, ok := cal.DistributeWindow("2026-09-07", "2026-09-18", 100, "2026-09-10", "2026-09-30")
	if !ok || len(w) != 2 || math.Abs(w["2026-W37"]-20) > 1e-9 || math.Abs(w["2026-W38"]-50) > 1e-9 || full["2026-W38"] != w["2026-W38"] {
		t.Errorf("fenêtre : %v", w)
	}
	if w, ok := cal.DistributeWindow("2026-09-07", "2026-09-18", 100, "2026-10-01", "2026-10-31"); !ok || len(w) != 0 {
		t.Errorf("fenêtre disjointe : %v %v", w, ok)
	}
	if _, ok := cal.DistributeWindow("", "2026-09-18", 100, "2026-09-07", "2026-09-18"); ok {
		t.Error("dates invalides")
	}
}

// timelineScenario: pdc1 (effet 07/09) puis pdc2 (effet 05/10) où MARTIN
// disparaît et DURAND passe sur CT2 ; couverture 07/09 → 30/10.
func timelineScenario() Input {
	in := baseInput()
	in.PlanRef = domain.Version{ID: "pdc2", Kind: domain.KindPlan, Statut: domain.StatutActive}
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire"), personne("p2", "MARTIN Théo")}
	in.Plans = []PlanSource{
		pdc("pdc1", "2026-09-07", 1,
			tlLine("CT1", "DURAND Claire", "2026-09-07", "2026-10-30", 280, 4000), // 40 j, 7 h/j
			tlLine("CT1", "MARTIN Théo", "2026-09-07", "2026-10-30", 280, 1000)),
		pdc("pdc2", "2026-10-05", 30, tlLine("CT2", "DURAND Claire", "2026-10-05", "2026-10-30", 140, 2000)),
	}
	prov := cost("CT1", provisionType, "AUTRES DEPENSES", 100)
	provNC := cost("CT1", provisionType, "AUTRES DEPENSES", 100)
	provNC.DateDepense = "2026-11-03"
	in.Entries = []domain.RealiseEntry{
		mo("CT1", "DURAND Claire Mme", 35, "2026-09-08"), // W37 conforme (pdc1)
		mo("CT1", "DURAND Claire Mme", 20, "2026-10-06"), // W41 : plus de CT1 au plan → 🔴 (pdc2)
		mo("CT2", "DURAND Claire Mme", 35, "2026-10-07"), // W41 conforme (pdc2)
		mo("CT1", "MARTIN Théo M.", 8, "2026-08-31"),     // avant la timeline : non couvert
		mo("CTX", "BARBIER Luc M.", 5, "2026-11-03"),     // après la timeline : non couvert (pas de 🟠)
		prov,   // dérive de provision (couverte)
		provNC, // non couverte : pas de dérive
	}
	in.WeekFrom, in.WeekTo = "2026-W36", "2026-W45"
	return in
}

func TestRunTimeline(t *testing.T) {
	res := Run(timelineScenario(), plainSettings())
	for _, r := range res.Ecarts {
		if r.Semaine == "2026-W36" || r.Semaine == "2026-W45" || r.CT == "CTX" {
			t.Errorf("tuple non couvert : %+v", r)
		}
		if r.PlanVersionID == nil {
			t.Errorf("plan_version_id absent : %+v", r)
		}
		if r.Ressource == "MARTIN Théo" && r.Semaine > "2026-W40" {
			t.Errorf("MARTIN absent de pdc2 encore planifié : %+v", r)
		}
	}
	if r := findRow(t, res, "CT1", "DURAND Claire", "2026-W37"); r.Flag != domain.FlagConforme || r.Prevu != 35 || *r.PlanVersionID != "pdc1" {
		t.Errorf("W37 : %+v", r)
	}
	if r := findRow(t, res, "CT1", "DURAND Claire", "2026-W41"); r.Flag != domain.FlagSurImputation || r.Prevu != 0 || *r.PlanVersionID != "pdc2" {
		t.Errorf("CT1 W41 : %+v", r)
	}
	if r := findRow(t, res, "CT2", "DURAND Claire", "2026-W41"); r.Flag != domain.FlagConforme || r.Prevu != 35 || *r.PlanVersionID != "pdc2" {
		t.Errorf("CT2 W41 : %+v", r)
	}
	if r := findRow(t, res, "CT1", "MARTIN Théo", "2026-W40"); r.Flag != domain.FlagAbsence || r.Prevu != 35 {
		t.Errorf("MARTIN W40 : %+v", r)
	}
	k := res.KPIs
	if k.HeuresNonCouvertes != 13 || k.NbHorsPlan != 0 || k.TotalReelH != 90 {
		t.Errorf("kpis : non couvertes %v, hors plan %d, réel %v", k.HeuresNonCouvertes, k.NbHorsPlan, k.TotalReelH)
	}
	for _, c := range res.Correspondances {
		if c.NomPrenom == "BARBIER Luc" {
			t.Errorf("correspondance non couverte : %+v", c)
		}
	}
	// Les prévisions (€) portent sur tout le réalisé : seule l'anomalie budget de CTX subsiste.
	for _, a := range res.Anomalies {
		if a.Ressource == "BARBIER Luc" || (a.CT == "CTX" && a.Categorie != domain.AnomalieBudget) {
			t.Errorf("anomalie non couverte : %+v", a)
		}
	}
	if len(res.Alertes.DeriveProvision) != 1 || res.Alertes.DeriveProvision[0].DateDepense != "2026-09-08" {
		t.Errorf("dérive : %+v", res.Alertes.DeriveProvision)
	}
	weeks := map[string]domain.Couverture{}
	for _, w := range res.Meta.Weeks {
		weeks[w.Week] = w.Couverture
	}
	if len(res.Meta.Weeks) != 10 || weeks["2026-W36"] != domain.CouvertureAucune || weeks["2026-W37"] != domain.CouvertureTotale ||
		weeks["2026-W44"] != domain.CouvertureTotale || weeks["2026-W45"] != domain.CouvertureAucune {
		t.Errorf("semaines : %v", weeks)
	}
	if len(res.Meta.Timeline) != 2 || res.Meta.Timeline[0].Fin != "2026-10-04" || res.Meta.ArchivedWarning || res.Meta.PlanVersion.ID != "pdc2" {
		t.Errorf("meta : %+v", res.Meta)
	}

	// Budget et prévisions sur les segments : CT1 = (4 000 + 1 000) × 20 / 40.
	var ct1 domain.BudgetCT
	for _, b := range res.Budget.ParCT {
		if b.CT == "CT1" {
			ct1 = b
		}
	}
	if ct1.PPSPlan != 2500 {
		t.Errorf("PPS CT1 = %v", ct1.PPSPlan)
	}
	pps := 0.0
	for _, n := range res.Budget.ParNature {
		pps += n.PPS
	}
	pv := res.Previsions
	if p := findCT(t, pv, "CT1"); p.Budget != 2500 || p.FinPlan != "2026-10-04" {
		t.Errorf("prévision CT1 : budget %v, fin %s", p.Budget, p.FinPlan)
	}
	if pv.Global.Budget != 4500 || pps != 4500 {
		t.Errorf("budget global %v, natures %v", pv.Global.Budget, pps)
	}
	cov := map[string]domain.Couverture{}
	for _, pt := range pv.Global.Series {
		cov[pt.Week] = pt.Couverture
	}
	if cov["2026-W36"] != domain.CouvertureAucune || cov["2026-W38"] != domain.CouvertureTotale || cov["2026-W45"] != domain.CouvertureAucune {
		t.Errorf("couverture des prévisions : %v", cov)
	}

	// Période par défaut = timeline ∩ réalisé.
	in := timelineScenario()
	in.WeekFrom, in.WeekTo = "", ""
	if m := Run(in, plainSettings()).Meta; m.WeekFrom != "2026-W37" || m.WeekTo != "2026-W44" {
		t.Errorf("période par défaut %s → %s", m.WeekFrom, m.WeekTo)
	}
	// Plan remplacé par une version plus récente → avertissement.
	in.PlanSuperseded = true
	if !Run(in, plainSettings()).Meta.ArchivedWarning {
		t.Error("archived_warning attendu")
	}
}
