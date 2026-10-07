package analyse

import (
	"sort"
	"time"

	"njord/internal/domain"
)

// Timeline du plan de charge (SPEC_analyse §4.3, DECISIONS n° 13) : chaque
// version de plan fait référence sur sa fenêtre
// [date_effet, min(date_effet suivante − 1 j, periode_fin)] et remplace
// intégralement les précédentes ; ses lignes sont coupées à cette fenêtre
// (charge et PPS au prorata des jours ouvrés). Hors fenêtres = non couvert.

// PlanSource is one plan version of the timeline with its lines (drop lines
// are ignored).
type PlanSource struct {
	Version domain.Version
	Lines   []domain.PlanLine
}

// Segment is a plan line cut to the window of its version.
type Segment struct {
	Line domain.PlanLine  // ligne coupée : dates, charge et PPS au prorata ; VersionID = version de la fenêtre
	Full *domain.PlanLine // ligne source entière
	Cut  bool             // false : dates invalides, ligne conservée entière (version à fenêtre non vide)
}

// Timeline is the merged plan: windows (every version, sorted) and segments.
type Timeline struct {
	Windows  []domain.TimelineWindow
	Segments []Segment
	spans    []span // fenêtres non vides, disjointes, triées
}

type span struct{ from, to, versionID string }

// day returns the "YYYY-MM-DD" part of a valid date ("" otherwise).
func day(s string) string {
	if _, ok := ParseDate(s); ok {
		return s[:10]
	}
	return ""
}

func dayBefore(d string) string {
	t, ok := ParseDate(d)
	if !ok {
		return ""
	}
	return t.AddDate(0, 0, -1).Format(dateLayout)
}

// BuildTimeline merges the plan versions (SPEC_analyse §4.3). Pure and
// deterministic: versions sorted by (date_effet, importee_le, id); date_effet
// absente → periode_debut → plus petite date de début des lignes ;
// periode_fin = plus grande date de fin des lignes non rejetées.
func BuildTimeline(cal Calendar, plans []PlanSource) Timeline {
	type vinfo struct {
		src   *PlanSource
		lines []domain.PlanLine
		effet string
		fin   string
		from  string // fenêtre ("" = vide)
		to    string
	}
	vs := make([]*vinfo, 0, len(plans))
	for i := range plans {
		p := &plans[i]
		v := &vinfo{src: p}
		pmin := ""
		for _, l := range p.Lines {
			if l.StatutParsing == domain.ParsingDrop {
				continue
			}
			v.lines = append(v.lines, l)
			if d := day(l.DateDebut); d != "" && (pmin == "" || d < pmin) {
				pmin = d
			}
			if d := day(l.DateFin); d > v.fin {
				v.fin = d
			}
		}
		sort.SliceStable(v.lines, func(a, b int) bool { return v.lines[a].RowNum < v.lines[b].RowNum })
		switch {
		case day(p.Version.DateEffet) != "":
			v.effet = day(p.Version.DateEffet)
		case day(p.Version.PeriodeDebut) != "":
			v.effet = day(p.Version.PeriodeDebut)
		default:
			v.effet = pmin
		}
		vs = append(vs, v)
	}
	sort.SliceStable(vs, func(a, b int) bool {
		x, y := vs[a].src.Version, vs[b].src.Version
		if vs[a].effet != vs[b].effet {
			return vs[a].effet < vs[b].effet
		}
		if !x.ImporteeLe.Equal(y.ImporteeLe) {
			return x.ImporteeLe.Before(y.ImporteeLe)
		}
		return x.ID < y.ID
	})

	tl := Timeline{Windows: make([]domain.TimelineWindow, 0, len(vs)), Segments: []Segment{}}
	for i, v := range vs {
		if v.effet != "" && v.fin != "" && (i+1 == len(vs) || vs[i+1].effet != v.effet) {
			to := v.fin
			if i+1 < len(vs) {
				// Versions triées : la suivante a une date d'effet strictement postérieure.
				if prev := dayBefore(vs[i+1].effet); prev < to {
					to = prev
				}
			}
			if to >= v.effet {
				v.from, v.to = v.effet, to
			}
		}
		ver := v.src.Version
		tl.Windows = append(tl.Windows, domain.TimelineWindow{
			VersionID: ver.ID, Intitule: ver.Intitule, Statut: ver.Statut,
			DateEffet: v.effet, Debut: v.from, Fin: v.to,
		})
		if v.from == "" {
			continue
		}
		tl.spans = append(tl.spans, span{v.from, v.to, ver.ID})
		for j := range v.lines {
			if sg, ok := cutLine(cal, &v.lines[j], v.from, v.to); ok {
				sg.Line.VersionID = ver.ID
				tl.Segments = append(tl.Segments, sg)
			}
		}
	}
	return tl
}

// cutLine returns l ∩ [from, to] with its charge and PPS prorated on the
// working days of the line (calendar days when the line has none).
func cutLine(cal Calendar, l *domain.PlanLine, from, to string) (Segment, bool) {
	sg := Segment{Line: *l, Full: l}
	d, f := day(l.DateDebut), day(l.DateFin)
	a, _ := ParseDate(d)
	b, _ := ParseDate(f)
	if d == "" || f == "" || f < d || b.Sub(a) > maxLineDays*24*time.Hour {
		return sg, true // dates invalides : ligne entière (signalée par plan_repartition)
	}
	lo, hi := maxStr(d, from), minStr(f, to)
	if lo > hi {
		return sg, false
	}
	sg.Cut = true
	sg.Line.DateDebut, sg.Line.DateFin = lo, hi
	if lo == d && hi == f {
		return sg, true
	}
	ratio := 0.0
	if w, ok := cal.DistributeWindow(d, f, 1, lo, hi); ok && len(w) > 0 {
		for _, v := range w {
			ratio += v
		}
	} else if jl, _ := cal.DistributeWindow(d, f, 1, d, f); len(jl) == 0 {
		// Ligne sans jour ouvré : prorata des jours calendaires.
		x, _ := ParseDate(lo)
		y, _ := ParseDate(hi)
		ratio = (y.Sub(x).Hours()/24 + 1) / (b.Sub(a).Hours()/24 + 1)
	}
	sg.Line.ChargeTotale = l.ChargeTotale * ratio
	sg.Line.PPS = l.PPS * ratio
	return sg, true
}

// Span returns the first and last covered days ("" if nothing is covered).
func (t Timeline) Span() (string, string) {
	if len(t.spans) == 0 {
		return "", ""
	}
	return t.spans[0].from, t.spans[len(t.spans)-1].to
}

// VersionAt returns the plan version governing a date ("" = non couvert).
func (t Timeline) VersionAt(date string) string {
	d := day(date)
	if d == "" {
		return ""
	}
	for _, s := range t.spans {
		if d >= s.from && d <= s.to {
			return s.versionID
		}
	}
	return ""
}

// Covered reports whether a date lies in a window of the timeline.
func (t Timeline) Covered(date string) bool { return t.VersionAt(date) != "" }

// WeekCoverage: part of the working days of the week covered by the timeline
// (calendar days for a week without working day, e.g. locked).
func (t Timeline) WeekCoverage(cal Calendar, week string) domain.Couverture {
	monday, err := WeekMonday(week)
	if err != nil {
		return domain.CouvertureAucune
	}
	var work, workCov, cov int
	for i := 0; i < 7; i++ {
		d := monday.AddDate(0, 0, i)
		c := t.Covered(d.Format(dateLayout))
		if c {
			cov++
		}
		if cal.IsWorkday(d) {
			work++
			if c {
				workCov++
			}
		}
	}
	n, total := workCov, work
	if work == 0 {
		n, total = cov, 7
	}
	switch {
	case n == 0:
		return domain.CouvertureAucune
	case n == total:
		return domain.CouvertureTotale
	}
	return domain.CouverturePartielle
}

// weeks lists the ISO weeks from..to with their coverage.
func (t Timeline) weeks(cal Calendar, from, to string) []domain.WeekInfo {
	ws := nonNilWeeks(cal.Weeks(from, to))
	for i := range ws {
		ws[i].Couverture = t.WeekCoverage(cal, ws[i].Week)
	}
	return ws
}
