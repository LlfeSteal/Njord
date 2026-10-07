package analyse

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"njord/internal/domain"
)

const dateLayout = "2006-01-02"

// Calendar is the reference business calendar (DECISIONS « Calendrier ») :
// jours ouvrés = lundi–vendredi hors jours fériés ; les semaines ISO dont le
// numéro est verrouillé (S51/S52 par défaut) comptent 0 jour ouvré.
type Calendar struct {
	feries map[string]bool
	locked map[int]bool
}

// NewCalendar builds the calendar from the settings.
func NewCalendar(s domain.Settings) Calendar {
	c := Calendar{feries: map[string]bool{}, locked: map[int]bool{}}
	for _, d := range s.JoursFeries {
		if t, ok := ParseDate(d); ok {
			c.feries[t.Format(dateLayout)] = true
		}
	}
	for _, w := range s.SemainesVerrouillees {
		c.locked[w] = true
	}
	return c
}

// IsLockedWeek reports whether the ISO week containing t is locked.
func (c Calendar) IsLockedWeek(t time.Time) bool {
	_, w := t.ISOWeek()
	return c.locked[w]
}

// IsWorkday: lun–ven, non férié, semaine non verrouillée.
func (c Calendar) IsWorkday(t time.Time) bool {
	switch t.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	}
	if c.feries[t.Format(dateLayout)] {
		return false
	}
	return !c.IsLockedWeek(t)
}

// ParseDate parses "YYYY-MM-DD" (extra trailing characters such as a time part are ignored).
func ParseDate(s string) (time.Time, bool) {
	if len(s) < 10 {
		return time.Time{}, false
	}
	t, err := time.Parse(dateLayout, s[:10])
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// WeekOf returns the ISO 8601 week of t as "YYYY-Www".
func WeekOf(t time.Time) string {
	y, w := t.ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

// WeekOfDate returns the ISO week of a "YYYY-MM-DD" date ("" if invalid).
func WeekOfDate(s string) string {
	t, ok := ParseDate(s)
	if !ok {
		return ""
	}
	return WeekOf(t)
}

var weekRe = regexp.MustCompile(`^(\d{4})-?W(\d{1,2})$`)

// WeekMonday returns the Monday of an ISO week "YYYY-Www".
func WeekMonday(week string) (time.Time, error) {
	m := weekRe.FindStringSubmatch(week)
	if m == nil {
		return time.Time{}, fmt.Errorf("semaine invalide « %s » (format attendu AAAA-Wss)", week)
	}
	y, _ := strconv.Atoi(m[1])
	w, _ := strconv.Atoi(m[2])
	if w < 1 || w > 53 {
		return time.Time{}, fmt.Errorf("semaine invalide « %s »", week)
	}
	jan4 := time.Date(y, time.January, 4, 0, 0, 0, 0, time.UTC)
	wd := (int(jan4.Weekday()) + 6) % 7 // lundi = 0
	monday := jan4.AddDate(0, 0, -wd+(w-1)*7)
	if yy, ww := monday.ISOWeek(); yy != y || ww != w {
		return time.Time{}, fmt.Errorf("semaine inexistante « %s »", week)
	}
	return monday, nil
}

// NormalizeWeek validates a week and returns its canonical form "YYYY-Www".
func NormalizeWeek(week string) (string, error) {
	m, err := WeekMonday(week)
	if err != nil {
		return "", err
	}
	return WeekOf(m), nil
}

// weekInfo describes the ISO week starting on monday.
func (c Calendar) weekInfo(monday time.Time) domain.WeekInfo {
	wi := domain.WeekInfo{
		Week:        WeekOf(monday),
		Debut:       monday.Format(dateLayout),
		Fin:         monday.AddDate(0, 0, 6).Format(dateLayout),
		Verrouillee: c.IsLockedWeek(monday),
	}
	for d := 0; d < 7; d++ {
		if c.IsWorkday(monday.AddDate(0, 0, d)) {
			wi.JoursOuvres++
		}
	}
	return wi
}

// Weeks lists the ISO weeks from..to (inclusive, "YYYY-Www") with their
// working days. Invalid bounds → nil; reversed bounds are swapped.
func Weeks(from, to string, s domain.Settings) []domain.WeekInfo {
	return NewCalendar(s).Weeks(from, to)
}

// maxWeeks bounds the calendar listing (≈ 20 years).
const maxWeeks = 1100

func (c Calendar) Weeks(from, to string) []domain.WeekInfo {
	a, err1 := WeekMonday(from)
	b, err2 := WeekMonday(to)
	if err1 != nil || err2 != nil {
		return nil
	}
	if b.Before(a) {
		a, b = b, a
	}
	out := []domain.WeekInfo{}
	for d := a; !d.After(b) && len(out) < maxWeeks; d = d.AddDate(0, 0, 7) {
		out = append(out, c.weekInfo(d))
	}
	return out
}

// maxLineDays bounds the day iteration of a plan line (≈ 30 years).
const maxLineDays = 11000

// Distribute spreads charge over the ISO weeks of [debut, fin]:
// charge_hebdo = charge × jo(ligne ∩ semaine) / jo(ligne).
// ok=false when the dates are missing/invalid/reversed. A line without any
// working day returns an empty map (ok=true): the §4.2 check reports it.
func (c Calendar) Distribute(debut, fin string, charge float64) (map[string]float64, bool) {
	return c.DistributeWindow(debut, fin, charge, debut, fin)
}

// DistributeWindow is Distribute restricted to the days of [winFrom, winTo]
// (timeline, SPEC_analyse §4.3) : le dénominateur reste jo(ligne), seuls les
// jours de la fenêtre sont répartis (le taux est conservé). Fenêtre invalide
// ou disjointe → map vide (ok=true).
func (c Calendar) DistributeWindow(debut, fin string, charge float64, winFrom, winTo string) (map[string]float64, bool) {
	a, ok1 := ParseDate(debut)
	b, ok2 := ParseDate(fin)
	if !ok1 || !ok2 || b.Before(a) || b.Sub(a) > maxLineDays*24*time.Hour {
		return nil, false
	}
	wa, okA := ParseDate(winFrom)
	wb, okB := ParseDate(winTo)
	days := map[string]int{}
	total := 0
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		if c.IsWorkday(d) {
			total++
			if okA && okB && !d.Before(wa) && !d.After(wb) {
				days[WeekOf(d)]++
			}
		}
	}
	out := make(map[string]float64, len(days))
	if total == 0 {
		return out, true
	}
	for w, n := range days {
		out[w] = charge * float64(n) / float64(total)
	}
	return out, true
}

// DefaultPeriod returns the default analysis weeks: intersection of the plan
// period [planMin, planMax] and of the réalisé period [realMin, realMax]
// (dates "YYYY-MM-DD"). If one side is unknown, the other is used. If the two
// periods are disjoint, their union is returned with disjoint=true.
func DefaultPeriod(planMin, planMax, realMin, realMax string) (from, to string, disjoint bool) {
	pf, pt := WeekOfDate(planMin), WeekOfDate(planMax)
	rf, rt := WeekOfDate(realMin), WeekOfDate(realMax)
	havePlan := pf != "" && pt != ""
	haveReal := rf != "" && rt != ""
	switch {
	case havePlan && haveReal:
		from, to = maxStr(pf, rf), minStr(pt, rt)
		if from > to {
			return minStr(pf, rf), maxStr(pt, rt), true
		}
		return from, to, false
	case havePlan:
		return pf, pt, false
	case haveReal:
		return rf, rt, false
	}
	return "", "", false
}

func minStr(a, b string) string {
	if a < b {
		return a
	}
	return b
}

func maxStr(a, b string) string {
	if a > b {
		return a
	}
	return b
}
