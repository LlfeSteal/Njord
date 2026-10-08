package analyse

import (
	"math"
	"sort"
	"strings"
	"time"

	"njord/internal/domain"
)

// Prévisions budgétaires (SPEC_analyse §7.7) : atterrissage par CT sur tout
// l'horizon du plan, indépendamment de la période d'analyse (r.from/r.to).
//
//   - dépense prévue hebdo d'une ligne = PPS × heures de la semaine ÷ heures de
//     la ligne (répartition en jours ouvrés, Calendar.Distribute) ;
//   - budget = charge max = Σ PPS des segments + Σ provisions du CT
//     (DECISIONS n° 16) ; c'est la référence des écarts, du % consommé et du statut ;
//   - consommé = Σ TOTAL EN € brut (MO comprise) ;
//   - reste à faire = dépense prévue (plan seul) des semaines > as_of_week ;
//   - tendance = rythme moyen des 4 dernières semaines × semaines restantes.
//
// Les provisions ne sont qu'un budget disponible : ni reste à faire, ni
// atterrissage, ni série (budget_cumul = dépense prévue cumulée du plan seul) ;
// leurs dates ne servent qu'au budget de l'exercice.
//
// Fin d'exercice (DECISIONS n° 17) : le budget non consommé à l'échéance E est
// perdu. Semaine WE de E incluse :
//   - budget de l'exercice = PPS prévu des semaines ≤ WE (+ PPS hors série,
//     compté entier) + provisions datées ≤ E ou sans date lisible ;
//   - projections à E : plan (consommé + prévu des semaines ]as_of, WE]) et
//     tendance (consommé + rythme × semaines ]as_of, WE]) ;
//   - non consommé = budget de l'exercice − la plus basse des deux, plancher 0 ;
//   - sous-consommation si non consommé > seuil % du budget de l'exercice et
//     > seuil € (indicateur séparé du statut).
// Global = enveloppe commune : mêmes formules sur les sommes des CT.

// fcTolerance absorbe les arrondis dans la comparaison atterrissage / budget.
const fcTolerance = 0.5

// fcBucket accumulates the raw (unrounded) figures of one CT.
type fcBucket struct {
	pps, provisions float64
	ppsHorsSerie    float64 // PPS dans le budget mais hors série hebdo (spreadPPS nil)
	provEcheance    float64 // provisions datées ≤ échéance ou sans date lisible
	consomme        float64
	undated         float64 // € d'écritures sans date de dépense valide (comptés au consommé)
	prevu           map[string]float64
	reel            map[string]float64
	hplan           map[string]float64
	hreel           map[string]float64
	fin             string // max date_fin (YYYY-MM-DD)
}

func newFcBucket() *fcBucket {
	return &fcBucket{prevu: map[string]float64{}, reel: map[string]float64{}, hplan: map[string]float64{}, hreel: map[string]float64{}}
}

// fcCalc is the computed forecast of one bucket, series aligned on the axis.
type fcCalc struct {
	pps, provisions, budget                       float64 // budget = pps + provisions (charge max)
	consomme, reste, atterPlan, atterTend, rythme float64
	sr                                            int
	fin                                           string
	// Fin d'exercice (bruts, non arrondis).
	ppsEch, provEch, prevuEch                    float64 // prevuEch = prévu des semaines ]as_of, WE]
	se                                           int     // semaines ]as_of, WE]
	echeance                                     string
	budgetCum, reelCum, planCum, tendCum, hp, hr []float64
}

// previsions computes the landing forecast (SPEC_analyse §7.7).
func (r *run) previsions() domain.Previsions {
	buckets := map[string]*fcBucket{}
	get := func(ct string) *fcBucket {
		b := buckets[ct]
		if b == nil {
			b = newFcBucket()
			buckets[ct] = b
		}
		return b
	}
	axisMin, axisMax := "", ""
	extend := func(w string) {
		if w == "" {
			return
		}
		if axisMin == "" || w < axisMin {
			axisMin = w
		}
		if axisMax == "" || w > axisMax {
			axisMax = w
		}
	}

	// Plan : PPS, dépense prévue et heures MO par semaine (segments de la timeline).
	for i := range r.lines {
		l := &r.lines[i]
		b := get(strings.TrimSpace(l.CT))
		b.pps += l.PPS
		if _, ok := ParseDate(l.DateDebut); ok {
			extend(WeekOfDate(l.DateDebut))
		}
		if _, ok := ParseDate(l.DateFin); ok {
			extend(WeekOfDate(l.DateFin))
			if d := l.DateFin[:10]; d > b.fin {
				b.fin = d
			}
		}
		spread := r.spreadPPS(l)
		if spread == nil {
			b.ppsHorsSerie += l.PPS
		}
		for w, v := range spread {
			b.prevu[w] += v
			extend(w)
		}
		if l.ChargeTotale != 0 && r.en.IsMOLine(l) {
			if hours, ok := r.cal.Distribute(l.DateDebut, l.DateFin, l.ChargeTotale); ok {
				for w, h := range hours {
					b.hplan[w] += h
				}
			}
		}
	}

	// Réalisé : consommé brut, heures MO, as_of.
	asOf := ""
	for i := range r.entries {
		e := &r.entries[i]
		b := get(strings.TrimSpace(e.TG))
		b.consomme += e.TotalEur
		w := r.enr[i].ISOWeek
		if w == "" {
			b.undated += e.TotalEur
			continue
		}
		if d := e.DateDepense[:10]; d > asOf {
			asOf = d
		}
		b.reel[w] += e.TotalEur
		b.hreel[w] += r.enr[i].Heures
		extend(w)
	}
	asOfWeek := WeekOfDate(asOf)
	echeance := r.echeance(asOf)
	echWeek := WeekOfDate(echeance)

	// Provisions : budget disponible du CT, sans série ; celles datées après
	// l'échéance relèvent de l'exercice suivant (hors budget de l'exercice).
	for i := range r.provs {
		pv := &r.provs[i]
		b := get(strings.TrimSpace(pv.CT))
		b.provisions += pv.Montant
		if _, ok := ParseDate(pv.DateDebut); !ok || pv.DateDebut[:10] <= echeance {
			b.provEcheance += pv.Montant
		}
	}

	var axis []string
	var cov []domain.Couverture
	for _, wi := range r.tl.weeks(r.cal, axisMin, axisMax) {
		axis = append(axis, wi.Week)
		cov = append(cov, wi.Couverture)
	}
	asIdx := -1
	for i, w := range axis {
		if w == asOfWeek {
			asIdx = i
		}
	}

	// Rythme : 4 dernières semaines ISO jusqu'à as_of_week incluse.
	var last4 []string
	if m, err := WeekMonday(asOfWeek); err == nil {
		for k := 0; k < 4; k++ {
			last4 = append(last4, WeekOf(m.AddDate(0, 0, -7*k)))
		}
	}

	cts := make([]string, 0, len(buckets))
	for ct := range buckets {
		cts = append(cts, ct)
	}
	sort.Strings(cts)

	n := len(axis)
	g := fcCalc{budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n)}
	g.echeance = echeance
	se := fcRemaining(axis, asOfWeek, echeance)
	g.se = se
	out := domain.Previsions{AsOf: asOf, AsOfWeek: asOfWeek, ParCT: []domain.PrevisionCT{}}
	for _, ct := range cts {
		c := r.fcCompute(buckets[ct], axis, asIdx, asOfWeek, last4)
		c.echeance, c.se = echeance, se
		c.ppsEch, c.provEch = buckets[ct].ppsHorsSerie, buckets[ct].provEcheance
		for w, v := range buckets[ct].prevu {
			if w <= echWeek {
				c.ppsEch += v
				if asOfWeek == "" || w > asOfWeek {
					c.prevuEch += v
				}
			}
		}
		g.ppsEch += c.ppsEch
		g.provEch += c.provEch
		g.prevuEch += c.prevuEch
		g.pps += c.pps
		g.provisions += c.provisions
		g.budget += c.budget
		g.consomme += c.consomme
		g.reste += c.reste
		g.atterPlan += c.atterPlan
		g.atterTend += c.atterTend
		g.rythme += c.rythme
		if c.fin > g.fin {
			g.fin = c.fin
		}
		for i := 0; i < n; i++ {
			g.budgetCum[i] += c.budgetCum[i]
			g.reelCum[i] += c.reelCum[i]
			g.planCum[i] += c.planCum[i]
			g.tendCum[i] += c.tendCum[i]
			g.hp[i] += c.hp[i]
			g.hr[i] += c.hr[i]
		}
		if ct == "" {
			continue // lignes sans CT / écritures sans TG : comptées dans le global seulement
		}
		out.ParCT = append(out.ParCT, r.fcBuild(ct, r.ctLibelle[ct], c, axis, cov, asIdx))
	}
	g.sr = fcRemaining(axis, asOfWeek, g.fin)
	out.Global = r.fcBuild("", "Périmètre", g, axis, cov, asIdx)

	rank := map[domain.PrevisionStatut]int{domain.PrevisionDepassement: 0, domain.PrevisionVigilance: 1, domain.PrevisionOK: 2}
	sort.SliceStable(out.ParCT, func(i, j int) bool {
		a, b := out.ParCT[i], out.ParCT[j]
		if rank[a.Statut] != rank[b.Statut] {
			return rank[a.Statut] < rank[b.Statut]
		}
		if a.EcartPlan != b.EcartPlan {
			return a.EcartPlan > b.EcartPlan
		}
		return a.CT < b.CT
	})
	return out
}

// echeance returns the end of the fiscal year (YYYY-MM-DD): settings.fin_exercice,
// à défaut le 31/12 de l'année de as_of (sans réalisé : de l'année de Input.Now).
func (r *run) echeance(asOf string) string {
	if t, ok := ParseDate(r.s.FinExercice); ok {
		return t.Format(time.DateOnly)
	}
	year := r.in.Now.Year()
	if t, ok := ParseDate(asOf); ok {
		year = t.Year()
	} else if r.in.Now.IsZero() {
		year = time.Now().Year()
	}
	return time.Date(year, time.December, 31, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
}

// spreadPPS returns the planned spend of a line per ISO week:
// PPS × heures de la semaine ÷ heures de la ligne. Sans charge (ou sans jour
// ouvré), le PPS est réparti au prorata des jours ouvrés de la ligne, à défaut
// uniformément sur ses semaines ; dates invalides → semaine de début ; sinon
// rien (le PPS reste dans le budget, hors série).
func (r *run) spreadPPS(l *domain.PlanLine) map[string]float64 {
	if l.PPS == 0 {
		return nil
	}
	prorata := func(w map[string]float64) map[string]float64 {
		sum := 0.0
		for _, v := range w {
			sum += v
		}
		if sum == 0 {
			return nil
		}
		out := make(map[string]float64, len(w))
		for k, v := range w {
			out[k] = l.PPS * v / sum
		}
		return out
	}
	if l.ChargeTotale != 0 {
		if hours, ok := r.cal.Distribute(l.DateDebut, l.DateFin, l.ChargeTotale); ok {
			if out := prorata(hours); out != nil {
				return out
			}
		}
	}
	if days, ok := r.cal.Distribute(l.DateDebut, l.DateFin, 1); ok {
		if out := prorata(days); out != nil {
			return out
		}
		weeks := r.cal.Weeks(WeekOfDate(l.DateDebut), WeekOfDate(l.DateFin))
		if len(weeks) > 0 {
			out := make(map[string]float64, len(weeks))
			for _, wi := range weeks {
				out[wi.Week] = l.PPS / float64(len(weeks))
			}
			return out
		}
	}
	if w := WeekOfDate(l.DateDebut); w != "" {
		return map[string]float64{w: l.PPS}
	}
	return nil
}

// fcCompute derives the figures and the raw cumulative series of one bucket.
func (r *run) fcCompute(b *fcBucket, axis []string, asIdx int, asOfWeek string, last4 []string) fcCalc {
	n := len(axis)
	c := fcCalc{pps: b.pps, provisions: b.provisions, budget: b.pps + b.provisions, consomme: b.consomme, fin: b.fin,
		budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n)}
	for w, v := range b.prevu {
		if asOfWeek == "" || w > asOfWeek {
			c.reste += v
		}
	}
	for _, w := range last4 {
		c.rythme += b.reel[w]
	}
	c.rythme /= 4
	c.sr = fcRemaining(axis, asOfWeek, b.fin)
	c.atterPlan = c.consomme + c.reste
	c.atterTend = c.consomme + c.rythme*float64(c.sr)

	budgetCum, reelCum := 0.0, b.undated
	base := b.undated // cumul réel à as_of (point de départ des projections)
	for i, w := range axis {
		budgetCum += b.prevu[w]
		reelCum += b.reel[w]
		c.budgetCum[i] = budgetCum
		c.hp[i] = b.hplan[w]
		if i <= asIdx {
			c.reelCum[i] = reelCum
			c.hr[i] = b.hreel[w]
		}
		if i == asIdx {
			base = reelCum
		}
	}
	plan := base
	for i, w := range axis {
		switch {
		case i < asIdx:
			continue
		case i == asIdx:
			c.planCum[i], c.tendCum[i] = base, base
		default:
			plan += b.prevu[w]
			c.planCum[i] = plan
			k := i - asIdx
			if k > c.sr {
				k = c.sr
			}
			c.tendCum[i] = base + c.rythme*float64(k)
		}
	}
	return c
}

// fcRemaining counts the weeks after asOfWeek up to the week of fin (0 if fin
// is past or unknown). Without réalisé, every week of the axis up to fin counts.
// Sert aussi aux semaines restantes jusqu'à l'échéance (fin = fin d'exercice).
func fcRemaining(axis []string, asOfWeek, fin string) int {
	finWeek := WeekOfDate(fin)
	if finWeek == "" {
		return 0
	}
	from := asOfWeek
	extra := 0
	if from == "" {
		if len(axis) == 0 {
			return 0
		}
		from, extra = axis[0], 1
	}
	a, err1 := WeekMonday(from)
	z, err2 := WeekMonday(finWeek)
	if err1 != nil || err2 != nil || z.Before(a) {
		return 0
	}
	return int(z.Sub(a).Hours()/24/7+0.5) + extra
}

// fcStatut: dépassement si atterrissage plan > budget (charge max) ou CT sans
// budget consommé ; vigilance si tendance > budget ou plan > 95 % du budget.
func fcStatut(c fcCalc) domain.PrevisionStatut {
	switch {
	case c.atterPlan > c.budget+fcTolerance, c.budget == 0 && c.consomme > 0:
		return domain.PrevisionDepassement
	case c.atterTend > c.budget+fcTolerance, c.atterPlan > 0.95*c.budget+fcTolerance:
		return domain.PrevisionVigilance
	}
	return domain.PrevisionOK
}

func fcPtr(v float64) *float64 {
	v = round2(v)
	return &v
}

// fcEcheance fills the end-of-fiscal-year figures (DECISIONS n° 17) from the raw
// pieces : non consommé face à la pire des deux projections, seuils % et €.
func fcEcheance(p *domain.PrevisionCT, c fcCalc, s domain.Settings) {
	budget := c.ppsEch + c.provEch
	projPlan := c.consomme + c.prevuEch
	projTend := c.consomme + c.rythme*float64(c.se)
	worst, source := projPlan, "plan"
	if round2(projTend) < round2(projPlan) {
		worst, source = projTend, "tendance"
	}
	nc := math.Max(0, budget-worst)
	if round2(nc) == 0 {
		nc, source = 0, ""
	}
	necessaire := 0.0
	if c.se > 0 {
		necessaire = math.Max(0, (budget-c.consomme)/float64(c.se))
	}
	p.Echeance = c.echeance
	p.BudgetEcheance = round2(budget)
	p.PPSEcheance = round2(c.ppsEch)
	p.ProvisionsEcheance = round2(c.provEch)
	p.ProjectionPlanEcheance = round2(projPlan)
	p.ProjectionTendanceEcheance = round2(projTend)
	p.NonConsomme = round2(nc)
	p.NonConsommeSource = source
	p.RythmeNecessaire = round2(necessaire)
	p.SemainesEcheance = c.se
	p.SousConsommation = nc > s.SeuilSousConsoPct/100*budget+fcTolerance && nc > s.SeuilSousConsoEur+fcTolerance
}

// fcBuild rounds the figures and builds the weekly points.
func (r *run) fcBuild(ct, libelle string, c fcCalc, axis []string, cov []domain.Couverture, asIdx int) domain.PrevisionCT {
	p := domain.PrevisionCT{
		CT:                   ct,
		CTLibelle:            libelle,
		Budget:               round2(c.budget),
		PPS:                  round2(c.pps),
		Provisions:           round2(c.provisions),
		Consomme:             round2(c.consomme),
		PctConsomme:          pct(c.consomme, c.budget),
		ResteAFaire:          round2(c.reste),
		AtterrissagePlan:     round2(c.atterPlan),
		AtterrissageTendance: round2(c.atterTend),
		EcartPlan:            round2(c.atterPlan - c.budget),
		EcartTendance:        round2(c.atterTend - c.budget),
		RythmeHebdo:          round2(c.rythme),
		SemainesRestantes:    c.sr,
		FinPlan:              c.fin,
		Statut:               fcStatut(c),
		Series:               make([]domain.PrevisionPoint, 0, len(axis)),
	}
	fcEcheance(&p, c, r.s)
	for i, w := range axis {
		pt := domain.PrevisionPoint{Week: w, BudgetCumul: round2(c.budgetCum[i]), HeuresPlan: round2(c.hp[i]), Couverture: cov[i]}
		if m, err := WeekMonday(w); err == nil {
			pt.Debut = m.Format(time.DateOnly)
		}
		if i <= asIdx {
			pt.ReelCumul = fcPtr(c.reelCum[i])
			pt.HeuresReel = fcPtr(c.hr[i])
		}
		if i >= asIdx {
			pt.PlanCumul = fcPtr(c.planCum[i])
			pt.TendanceCumul = fcPtr(c.tendCum[i])
		}
		p.Series = append(p.Series, pt)
	}
	return p
}
