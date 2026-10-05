package analyse

import (
	"math"
	"testing"

	"njord/internal/store"
)

func TestWeekMonday(t *testing.T) {
	cases := []struct {
		week, monday string
		err          bool
	}{
		{"2026-W36", "2026-08-31", false},
		{"2026-W01", "2025-12-29", false},
		{"2026-W1", "2025-12-29", false},
		{"2026-W53", "2026-12-28", false}, // 2026 a 53 semaines
		{"2025-W53", "", true},
		{"2026-W00", "", true},
		{"S36", "", true},
	}
	for _, c := range cases {
		m, err := WeekMonday(c.week)
		if (err != nil) != c.err {
			t.Fatalf("%s: err=%v", c.week, err)
		}
		if !c.err && m.Format(dateLayout) != c.monday {
			t.Errorf("%s: lundi %s, attendu %s", c.week, m.Format(dateLayout), c.monday)
		}
	}
	if w, _ := NormalizeWeek("2026-W1"); w != "2026-W01" {
		t.Errorf("NormalizeWeek = %s", w)
	}
}

func TestWeeksCalendar(t *testing.T) {
	s := store.DefaultSettings()
	weeks := Weeks("2026-W45", "2026-W53", s)
	want := map[string]struct {
		jo     int
		locked bool
	}{
		"2026-W45": {5, false}, // 02 → 08/11
		"2026-W46": {4, false}, // 11/11 férié
		"2026-W50": {5, false},
		"2026-W51": {0, true},  // verrouillée
		"2026-W52": {0, true},  // verrouillée (25/12 dedans)
		"2026-W53": {4, false}, // 01/01/2027 férié
	}
	if len(weeks) != 9 {
		t.Fatalf("nb semaines = %d", len(weeks))
	}
	for _, w := range weeks {
		if exp, ok := want[w.Week]; ok {
			if w.JoursOuvres != exp.jo || w.Verrouillee != exp.locked {
				t.Errorf("%s: jo=%d locked=%v, attendu %+v", w.Week, w.JoursOuvres, w.Verrouillee, exp)
			}
		}
	}
	if weeks[0].Debut != "2026-11-02" || weeks[0].Fin != "2026-11-08" {
		t.Errorf("bornes W45 = %s → %s", weeks[0].Debut, weeks[0].Fin)
	}
	if Weeks("x", "2026-W01", s) != nil {
		t.Error("borne invalide doit donner nil")
	}
}

func TestDistribute(t *testing.T) {
	cal := NewCalendar(store.DefaultSettings())
	cases := []struct {
		name       string
		debut, fin string
		charge     float64
		ok         bool
		wantSum    float64
		check      map[string]float64
	}{
		{
			name: "ligne démo 01/09 → 30/11", debut: "2026-09-01", fin: "2026-11-30", charge: 219, ok: true, wantSum: 219,
			// 64 jours ouvrés (65 lun–ven − 11/11) : W36 = 4 j (01/09 mardi), W46 = 4 j (11/11).
			check: map[string]float64{"2026-W36": 219 * 4.0 / 64, "2026-W37": 219 * 5.0 / 64, "2026-W46": 219 * 4.0 / 64, "2026-W49": 219 * 1.0 / 64},
		},
		{
			name: "chevauche S51/S52 verrouillées", debut: "2026-12-07", fin: "2027-01-08", charge: 100, ok: true, wantSum: 100,
			check: map[string]float64{"2026-W51": 0, "2026-W52": 0, "2026-W50": 100 * 5.0 / 14},
		},
		{name: "uniquement S51/S52", debut: "2026-12-14", fin: "2026-12-27", charge: 80, ok: true, wantSum: 0},
		{name: "dates inversées", debut: "2026-10-01", fin: "2026-09-01", charge: 10, ok: false},
		{name: "date absente", debut: "", fin: "2026-09-01", charge: 10, ok: false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := cal.Distribute(c.debut, c.fin, c.charge)
			if ok != c.ok {
				t.Fatalf("ok=%v", ok)
			}
			if !ok {
				return
			}
			sum := 0.0
			for _, v := range got {
				sum += v
			}
			if math.Abs(sum-c.wantSum) > 0.5 {
				t.Errorf("Σ hebdo = %.3f, attendu %.3f ±0.5", sum, c.wantSum)
			}
			for w, exp := range c.check {
				if math.Abs(got[w]-exp) > 1e-9 {
					t.Errorf("%s = %.4f, attendu %.4f", w, got[w], exp)
				}
			}
		})
	}
}

func TestDefaultPeriod(t *testing.T) {
	cases := []struct {
		pMin, pMax, rMin, rMax string
		from, to               string
		disjoint               bool
	}{
		// démo : plan 01/09 → 30/11, réalisé 27/08 → 03/10 → W36..W40
		{"2026-09-01", "2026-11-30", "2026-08-27", "2026-10-03", "2026-W36", "2026-W40", false},
		{"2026-09-01", "2026-11-30", "", "", "2026-W36", "2026-W49", false},
		{"2026-01-05", "2026-01-30", "2026-06-01", "2026-06-30", "2026-W02", "2026-W27", true},
	}
	for _, c := range cases {
		f, to, d := DefaultPeriod(c.pMin, c.pMax, c.rMin, c.rMax)
		if f != c.from || to != c.to || d != c.disjoint {
			t.Errorf("DefaultPeriod(%v) = %s %s %v", c, f, to, d)
		}
	}
}
