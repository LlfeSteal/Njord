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
//
// Enveloppes (DECISIONS n° 19) : un CT configuré (Input.Enveloppes) a pour
// budget le montant de son enveloppe et pour exercice sa période [D, E]
// (semaines ISO WD et WE incluses entières) :
//   - consommé = € datés dans [D, E] + écritures sans date ; les € datés hors
//     période vont au réalisé hors enveloppe (exclus du consommé, du rythme et
//     des séries ; les heures réelles restent comptées) ;
//   - prévu des semaines < WD ou > WE (+ PPS hors série) = plan hors
//     enveloppe : ni reste à faire, ni budget de l'échéance, ni série ;
//   - reste à faire = prévu des semaines ]as_of, WE] ∩ ≥ WD ; tendance =
//     consommé + rythme (réel de la période) × semaines ]as_of, WE] ;
//   - échéance = E, budget de l'échéance = montant, projections = atterrissages ;
//     provisions (datées ≤ E ou sans date) seulement informatives ;
//   - séries cumulées sur la période seule (0 avant WD, plates après WE) ;
//     l'axe est prolongé jusqu'à WE pour que la tendance atteigne l'atterrissage.
// Un CT non configuré garde la charge max. Global = somme des CT, chacun sur
// son budget et son horizon (pièces de l'échéance sommées CT par CT) ; sans
// aucune enveloppe, mêmes formules que ci-dessus sur les sommes.

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
	// Enveloppe (DECISIONS n° 19) : période [wd, we] en semaines ISO ; nil = charge max.
	env       *domain.Enveloppe
	wd, we    string
	consoHors float64 // € datés hors de la période (exclus du consommé)
}

func newFcBucket() *fcBucket {
	return &fcBucket{prevu: map[string]float64{}, reel: map[string]float64{}, hplan: map[string]float64{}, hreel: map[string]float64{}}
}

// inPeriod: la semaine w compte pour le budget du CT (toujours sans enveloppe).
func (b *fcBucket) inPeriod(w string) bool {
	return b.env == nil || (w >= b.wd && w <= b.we)
}

// fcEnveloppe returns the envelope of ct with normalized dates (YYYY-MM-DD) ;
// false si le CT n'en a pas ou si ses dates sont illisibles ou inversées.
func (r *run) fcEnveloppe(ct string) (domain.Enveloppe, bool) {
	e, ok := r.in.Enveloppes[ct]
	if !ok || ct == "" {
		return e, false
	}
	d, ok1 := ParseDate(e.DateDebut)
	f, ok2 := ParseDate(e.DateFin)
	if !ok1 || !ok2 || f.Before(d) {
		return e, false
	}
	e.DateDebut, e.DateFin = d.Format(time.DateOnly), f.Format(time.DateOnly)
	return e, true
}

// fcCalc is the computed forecast of one bucket, series aligned on the axis.
type fcCalc struct {
	pps, provisions, budget                       float64 // budget = montant de l'enveloppe, sinon pps + provisions (charge max)
	consomme, reste, atterPlan, atterTend, rythme float64
	sr                                            int
	fin                                           string
	// Fin d'exercice (bruts, non arrondis).
	ppsEch, provEch, prevuEch                    float64 // prevuEch = prévu des semaines ]as_of, WE]
	se                                           int     // semaines ]as_of, WE]
	echeance                                     string
	budgetCum, reelCum, planCum, tendCum, hp, hr []float64
	// Enveloppe (DECISIONS n° 19).
	env                 *domain.Enveloppe
	planHors, consoHors float64
	ech                 *fcEch // pièces de l'échéance précalculées (enveloppe, global avec enveloppes) ; nil = n° 17
}

// fcEch: budget de l'échéance et projections à l'échéance (bruts).
type fcEch struct{ budget, plan, tend float64 }

// echeancePieces returns the raw end-of-period budget and projections :
// précalculés (c.ech), sinon formules du n° 17 sur les pièces.
func (c fcCalc) echeancePieces() fcEch {
	if c.ech != nil {
		return *c.ech
	}
	return fcEch{c.ppsEch + c.provEch, c.consomme + c.prevuEch, c.consomme + c.rythme*float64(c.se)}
}

// previsions computes the landing forecast (SPEC_analyse §7.7).
func (r *run) previsions() domain.Previsions {
	buckets := map[string]*fcBucket{}
	get := func(ct string) *fcBucket {
		b := buckets[ct]
		if b == nil {
			b = newFcBucket()
			if e, ok := r.fcEnveloppe(ct); ok {
				b.env, b.wd, b.we = &e, WeekOfDate(e.DateDebut), WeekOfDate(e.DateFin)
			}
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

	// Réalisé : consommé brut, heures MO, as_of. Avec enveloppe, les € datés
	// hors période sont mis à part (heures comptées).
	asOf := ""
	for i := range r.entries {
		e := &r.entries[i]
		b := get(strings.TrimSpace(e.TG))
		w := r.enr[i].ISOWeek
		if w == "" {
			b.consomme += e.TotalEur
			b.undated += e.TotalEur
			continue
		}
		d := e.DateDepense[:10]
		if d > asOf {
			asOf = d
		}
		b.hreel[w] += r.enr[i].Heures
		extend(w)
		if b.env != nil && (d < b.env.DateDebut || d > b.env.DateFin) {
			b.consoHors += e.TotalEur
			continue
		}
		b.consomme += e.TotalEur
		b.reel[w] += e.TotalEur
	}
	asOfWeek := WeekOfDate(asOf)
	echeance := r.echeance(asOf)
	echWeek := WeekOfDate(echeance)

	// Provisions : budget disponible du CT, sans série ; celles datées après
	// l'échéance (fin de l'enveloppe le cas échéant) relèvent de l'exercice
	// suivant (hors budget de l'exercice).
	for i := range r.provs {
		pv := &r.provs[i]
		b := get(strings.TrimSpace(pv.CT))
		b.provisions += pv.Montant
		lim := echeance
		if b.env != nil {
			lim = b.env.DateFin
		}
		if _, ok := ParseDate(pv.DateDebut); !ok || pv.DateDebut[:10] <= lim {
			b.provEcheance += pv.Montant
		}
	}

	// Axe prolongé jusqu'à la fin des enveloppes : la tendance d'un CT configuré
	// court jusqu'à sa fin (même si le plan s'arrête avant).
	for _, b := range buckets {
		if b.env != nil {
			extend(b.we)
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
	var gEch fcEch // pièces de l'échéance sommées CT par CT
	nbEnv := 0
	for _, ct := range cts {
		b := buckets[ct]
		c := r.fcCompute(b, axis, asIdx, asOfWeek, last4)
		c.provEch = b.provEcheance
		if b.env != nil {
			// Exercice propre au CT : échéance = fin de l'enveloppe, budget = montant,
			// projections = atterrissages (déjà restreints à la période).
			nbEnv++
			c.echeance, c.se = b.env.DateFin, c.sr
			for w, v := range b.prevu {
				if b.inPeriod(w) {
					c.ppsEch += v
				}
			}
			c.prevuEch = c.reste
			c.ech = &fcEch{b.env.Montant, c.atterPlan, c.atterTend}
		} else {
			c.echeance, c.se = echeance, se
			c.ppsEch = b.ppsHorsSerie
			for w, v := range b.prevu {
				if w <= echWeek {
					c.ppsEch += v
					if asOfWeek == "" || w > asOfWeek {
						c.prevuEch += v
					}
				}
			}
		}
		pe := c.echeancePieces()
		gEch.budget += pe.budget
		gEch.plan += pe.plan
		gEch.tend += pe.tend
		g.planHors += c.planHors
		g.consoHors += c.consoHors
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
	if nbEnv > 0 {
		g.ech = &gEch // chaque CT sur son budget et son horizon
	}
	out.Global = r.fcBuild("", "Périmètre", g, axis, cov, asIdx)
	out.Global.BudgetSource = fcBudgetSource(out.ParCT)
	out.Enveloppes = fcSynthese(out.ParCT)

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
// Avec enveloppe : budget = montant, prévu et réel restreints à la période,
// semaines restantes jusqu'à la fin de l'enveloppe.
func (r *run) fcCompute(b *fcBucket, axis []string, asIdx int, asOfWeek string, last4 []string) fcCalc {
	n := len(axis)
	c := fcCalc{pps: b.pps, provisions: b.provisions, budget: b.pps + b.provisions, consomme: b.consomme, fin: b.fin,
		budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n),
		env: b.env, consoHors: b.consoHors}
	if b.env != nil {
		c.budget, c.planHors = b.env.Montant, b.ppsHorsSerie
	}
	for w, v := range b.prevu {
		switch {
		case !b.inPeriod(w):
			c.planHors += v
		case asOfWeek == "" || w > asOfWeek:
			c.reste += v
		}
	}
	for _, w := range last4 {
		c.rythme += b.reel[w] // réel de la période seule (b.reel)
	}
	c.rythme /= 4
	if b.env != nil {
		c.sr = fcRemaining(axis, asOfWeek, b.env.DateFin)
	} else {
		c.sr = fcRemaining(axis, asOfWeek, b.fin)
	}
	c.atterPlan = c.consomme + c.reste
	c.atterTend = c.consomme + c.rythme*float64(c.sr)

	budgetCum, reelCum := 0.0, b.undated
	base := b.undated // cumul réel à as_of (point de départ des projections)
	for i, w := range axis {
		if b.inPeriod(w) {
			budgetCum += b.prevu[w]
		}
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
			if b.inPeriod(w) {
				plan += b.prevu[w]
			}
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

// fcStatut: dépassement si atterrissage plan > budget (enveloppe ou charge max) ou CT sans
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
// Avec enveloppe (n° 19) : fin de l'enveloppe, budget = montant.
func fcEcheance(p *domain.PrevisionCT, c fcCalc, s domain.Settings) {
	pe := c.echeancePieces()
	budget, projPlan, projTend := pe.budget, pe.plan, pe.tend
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
		CT:                    ct,
		CTLibelle:             libelle,
		Budget:                round2(c.budget),
		BudgetSource:          "charge_max",
		ChargeMax:             round2(c.pps + c.provisions),
		PPS:                   round2(c.pps),
		Provisions:            round2(c.provisions),
		Consomme:              round2(c.consomme),
		PctConsomme:           pct(c.consomme, c.budget),
		ResteAFaire:           round2(c.reste),
		AtterrissagePlan:      round2(c.atterPlan),
		AtterrissageTendance:  round2(c.atterTend),
		EcartPlan:             round2(c.atterPlan - c.budget),
		EcartTendance:         round2(c.atterTend - c.budget),
		RythmeHebdo:           round2(c.rythme),
		SemainesRestantes:     c.sr,
		FinPlan:               c.fin,
		Statut:                fcStatut(c),
		Series:                make([]domain.PrevisionPoint, 0, len(axis)),
		PlanHorsEnveloppe:     round2(c.planHors),
		ConsommeHorsEnveloppe: round2(c.consoHors),
	}
	if c.env != nil {
		e := *c.env
		p.BudgetSource, p.Enveloppe = "enveloppe", &e
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

// fcBudgetSource: source du budget global — enveloppe si tous les CT de par_ct
// en ont une, charge_max si aucun, mixte sinon.
func fcBudgetSource(par []domain.PrevisionCT) string {
	nb := 0
	for _, p := range par {
		if p.Enveloppe != nil {
			nb++
		}
	}
	switch {
	case nb == 0:
		return "charge_max"
	case nb == len(par):
		return "enveloppe"
	}
	return "mixte"
}

// fcSynthese: lecture brute des CT configurés de par_ct (DECISIONS n° 19),
// sans compensation entre CT pour le dépassement et le non consommé.
func fcSynthese(par []domain.PrevisionCT) domain.EnveloppesSynthese {
	out := domain.EnveloppesSynthese{NbCT: len(par)}
	for _, p := range par {
		if p.Enveloppe == nil {
			continue
		}
		out.NbConfigures++
		out.Montant += p.Enveloppe.Montant
		out.Atterrissage += p.AtterrissagePlan
		out.Depassement += math.Max(0, p.EcartPlan)
		out.NonConsomme += p.NonConsomme
		out.PlanHorsEnveloppe += p.PlanHorsEnveloppe
		if p.Statut == domain.PrevisionDepassement {
			out.NbDepassement++
		}
		if p.SousConsommation {
			out.NbSousConsommation++
		}
	}
	out.Ecart = round2(out.Atterrissage - out.Montant)
	out.Montant, out.Atterrissage = round2(out.Montant), round2(out.Atterrissage)
	out.Depassement, out.NonConsomme = round2(out.Depassement), round2(out.NonConsomme)
	out.PlanHorsEnveloppe = round2(out.PlanHorsEnveloppe)
	return out
}
