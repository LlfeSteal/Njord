package analyse

import (
	"math"
	"sort"
	"strings"
	"time"

	"njord/internal/domain"
)

// Prévisions budgétaires (SPEC_analyse §7.7) : atterrissage par CT,
// indépendamment de la période d'analyse (r.from/r.to).
//
//   - dépense prévue hebdo d'une ligne = PPS × heures de la semaine ÷ heures de
//     la ligne (répartition en jours ouvrés, Calendar.Distribute) ;
//   - consommé = Σ TOTAL EN € brut (MO comprise) ;
//   - reste à faire = dépense prévue (plan seul) des semaines > as_of_week ;
//   - tendance = rythme moyen des 4 dernières semaines × semaines restantes.
//
// Budget = enveloppe du fichier, rien d'autre (DECISIONS n° 20) : PPS et
// provisions ne sont qu'informatifs (ni budget, ni reste à faire, ni série).
//
// CT avec enveloppe (Input.Enveloppes, DECISIONS n° 19) : budget = montant,
// exercice propre au CT sur sa période [D, E] (semaines ISO WD et WE incluses
// entières) :
//   - consommé = € datés dans [D, E] + écritures sans date ; les € datés hors
//     période vont au réalisé hors enveloppe (exclus du consommé, du rythme et
//     des séries ; les heures réelles restent comptées) ;
//   - prévu des semaines < WD ou > WE (+ PPS hors série) = plan hors
//     enveloppe : ni reste à faire, ni série ;
//   - reste à faire = prévu des semaines ]as_of, WE] ∩ ≥ WD ; tendance =
//     consommé + rythme (réel de la période) × semaines ]as_of, WE] ;
//   - échéance = E, budget de l'échéance = montant, projections = atterrissages ;
//     non consommé = montant − atterrissage plan, plancher 0 (DECISIONS n° 21) :
//     la tendance ne sert qu'aux tracés et à la vigilance ;
//     sous-consommation si non consommé > seuil % du montant et > seuil €
//     (indicateur séparé du statut, n° 17) ; zone cible [cible_min, montant] ;
//   - séries cumulées sur la période seule (0 avant WD, plates après WE) ;
//     l'axe couvre toute la période pour que la tendance atteigne l'atterrissage.
//
// CT sans enveloppe : aucun budget (champs de budget nil), horizon = tout le
// plan ; consommé, atterrissages et séries restent calculés.
//
// Global = périmètre des CT avec enveloppe, chacun sur son budget et son
// horizon : sommes, puis mêmes formules (statut, écarts, seuils) sur les sommes,
// sauf le non consommé = Σ des CT, sans compensation avec les dépassements (n° 21) ;
// séries sur l'union des périodes. Les CT sans enveloppe sont résumés à part
// (Previsions.HorsEnveloppe).
//
// Synthèse des enveloppes (Previsions.Enveloppes) : dépassement = Σ ecart_plan
// des seuls CT en statut dépassement (DECISIONS n° 22), d'où dépassement > 0 ⇔
// nb_depassement > 0 ; non consommé = Σ des CT, sans compensation.

// fcTolerance absorbe les arrondis dans la comparaison atterrissage / budget.
const fcTolerance = 0.5

// fcBucket accumulates the raw (unrounded) figures of one CT.
type fcBucket struct {
	pps, provisions float64
	ppsHorsSerie    float64 // PPS hors série hebdo (spreadPPS nil)
	consomme        float64
	undated         float64 // € d'écritures sans date de dépense valide (comptés au consommé)
	prevu           map[string]float64
	reel            map[string]float64
	hplan           map[string]float64
	hreel           map[string]float64
	fin             string // max date_fin (YYYY-MM-DD)
	// Enveloppe (DECISIONS n° 19) : période [wd, we] en semaines ISO ; nil = sans budget.
	env       *domain.Enveloppe
	wd, we    string
	consoHors float64 // € datés hors de la période (exclus du consommé)
}

func newFcBucket() *fcBucket {
	return &fcBucket{prevu: map[string]float64{}, reel: map[string]float64{}, hplan: map[string]float64{}, hreel: map[string]float64{}}
}

// inPeriod: la semaine w compte pour le CT (toujours sans enveloppe).
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

// fcCalc is the computed forecast of one bucket (or of the global), raw
// figures and series aligned on the axis.
type fcCalc struct {
	pps, provisions                               float64
	consomme, reste, atterPlan, atterTend, rythme float64
	sr                                            int // semaines restantes (avec budget : jusqu'à l'échéance)
	fin                                           string
	budgetCum, reelCum, planCum, tendCum, hp, hr  []float64
	// Budget (DECISIONS n° 20) : montant de l'enveloppe (global : Σ montants) ;
	// budgeted = false sans enveloppe. Projections à l'échéance = atterrissages.
	budgeted bool
	budget   float64
	echeance string  // fin de l'enveloppe (global : la plus tardive)
	nc       float64 // non consommé (global : Σ des CT, sans compensation)
	// Enveloppe (DECISIONS n° 19).
	env                 *domain.Enveloppe
	planHors, consoHors float64
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

	// Provisions : informatives (marge disponible), sans série.
	for i := range r.provs {
		pv := &r.provs[i]
		get(strings.TrimSpace(pv.CT)).provisions += pv.Montant
	}

	// Axe prolongé à toute la période des enveloppes : la tendance d'un CT
	// configuré court jusqu'à sa fin (même si le plan s'arrête avant) et l'axe
	// du global couvre l'union des périodes.
	envMin, envMax := "", ""
	for _, b := range buckets {
		if b.env != nil {
			extend(b.wd)
			extend(b.we)
			if envMin == "" || b.wd < envMin {
				envMin = b.wd
			}
			if b.we > envMax {
				envMax = b.we
			}
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
		if ct != "" { // lignes sans CT / écritures sans TG : hors de toute enveloppe
			cts = append(cts, ct)
		}
	}
	sort.Strings(cts)

	n := len(axis)
	g := fcCalc{budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n)}
	out := domain.Previsions{AsOf: asOf, AsOfWeek: asOfWeek, ParCT: []domain.PrevisionCT{}}
	for _, ct := range cts {
		b := buckets[ct]
		c := r.fcCompute(b, axis, asIdx, asOfWeek, last4)
		out.ParCT = append(out.ParCT, r.fcBuild(ct, r.ctLibelle[ct], c, axis, cov, asIdx, 0, n-1))
		if !c.budgeted {
			h := &out.HorsEnveloppe
			h.NbCT++
			h.Consomme += c.consomme
			h.AtterrissagePlan += c.atterPlan
			h.AtterrissageTendance += c.atterTend
			continue
		}
		// Global = périmètre des enveloppes, chaque CT sur son budget et son horizon.
		g.budgeted = true
		g.budget += c.budget
		g.nc += round2(c.nc) // Σ des montants affichés par CT : global = synthèse au centime (n° 21)
		if c.echeance > g.echeance {
			g.echeance = c.echeance
		}
		g.planHors += c.planHors
		g.consoHors += c.consoHors
		g.pps += c.pps
		g.provisions += c.provisions
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
	}
	h := &out.HorsEnveloppe
	h.Consomme, h.AtterrissagePlan, h.AtterrissageTendance = round2(h.Consomme), round2(h.AtterrissagePlan), round2(h.AtterrissageTendance)

	// Séries du global sur l'union des périodes [min WD, max WE] ; vides sans enveloppe.
	lo, hi := 0, -1
	if g.budgeted {
		g.sr = fcRemaining(axis, asOfWeek, g.echeance)
		lo, hi = n, -1
		for i, w := range axis {
			if w >= envMin && w <= envMax {
				lo, hi = min(lo, i), i
			}
		}
	}
	out.Global = r.fcBuild("", "Périmètre", g, axis, cov, asIdx, lo, hi)
	out.Enveloppes = fcSynthese(out.ParCT)

	// Tri : CT avec enveloppe par statut (dépassement d'abord) puis écart plan
	// décroissant ; CT sans enveloppe en dernier, atterrissage plan décroissant.
	rank := map[domain.PrevisionStatut]int{domain.PrevisionDepassement: 0, domain.PrevisionVigilance: 1, domain.PrevisionOK: 2}
	sort.SliceStable(out.ParCT, func(i, j int) bool {
		a, b := out.ParCT[i], out.ParCT[j]
		if (a.Statut == nil) != (b.Statut == nil) {
			return a.Statut != nil
		}
		if a.Statut == nil {
			if a.AtterrissagePlan != b.AtterrissagePlan {
				return a.AtterrissagePlan > b.AtterrissagePlan
			}
			return a.CT < b.CT
		}
		if rank[*a.Statut] != rank[*b.Statut] {
			return rank[*a.Statut] < rank[*b.Statut]
		}
		if *a.EcartPlan != *b.EcartPlan {
			return *a.EcartPlan > *b.EcartPlan
		}
		return a.CT < b.CT
	})
	return out
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
// semaines restantes jusqu'à la fin de l'enveloppe, non consommé à sa fin.
func (r *run) fcCompute(b *fcBucket, axis []string, asIdx int, asOfWeek string, last4 []string) fcCalc {
	n := len(axis)
	c := fcCalc{pps: b.pps, provisions: b.provisions, consomme: b.consomme, fin: b.fin,
		budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n),
		env: b.env, consoHors: b.consoHors}
	if b.env != nil {
		c.budgeted, c.budget, c.echeance, c.planHors = true, b.env.Montant, b.env.DateFin, b.ppsHorsSerie
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
	if c.budgeted {
		c.nc = fcNonConsomme(c.budget, c.atterPlan)
	}

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
// Sert aussi aux semaines restantes jusqu'à l'échéance (fin de l'enveloppe).
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

// fcNonConsomme: part du budget que le plan de charge ne consommera pas =
// budget − atterrissage plan à l'échéance, plancher 0 (DECISIONS n° 21). La
// tendance n'y entre jamais.
func fcNonConsomme(budget, atterPlan float64) float64 {
	return math.Max(0, budget-atterPlan)
}

// fcStatut: dépassement si atterrissage plan > budget ; vigilance si tendance
// > budget ou plan > 95 % du budget.
func fcStatut(c fcCalc) domain.PrevisionStatut {
	switch {
	case c.atterPlan > c.budget+fcTolerance:
		return domain.PrevisionDepassement
	case c.atterTend > c.budget+fcTolerance, c.atterPlan > 0.95*c.budget+fcTolerance:
		return domain.PrevisionVigilance
	}
	return domain.PrevisionOK
}

// fcCibleMin: bas de la zone cible [cible_min, budget] (DECISIONS n° 20) =
// budget − max(seuil % × budget, seuil €), plancher 0. Atterrir en dessous =
// sous-consommation (mêmes seuils).
func fcCibleMin(budget float64, s domain.Settings) float64 {
	return math.Max(0, budget-math.Max(s.SeuilSousConsoPct/100*budget, s.SeuilSousConsoEur))
}

func fcPtr(v float64) *float64 {
	v = round2(v)
	return &v
}

// fcBudget fills the budget fields (DECISIONS n° 19 et 20) : écarts, statut,
// % consommé, échéance (fin de l'enveloppe), non consommé face à l'atterrissage
// plan (n° 21), seuils % et €, zone cible.
func fcBudget(p *domain.PrevisionCT, c fcCalc, s domain.Settings) {
	statut := fcStatut(c)
	necessaire := 0.0
	if c.sr > 0 {
		necessaire = math.Max(0, (c.budget-c.consomme)/float64(c.sr))
	}
	p.BudgetSource = "enveloppe"
	p.Budget = fcPtr(c.budget)
	p.PctConsomme = pct(c.consomme, c.budget)
	p.EcartPlan = fcPtr(c.atterPlan - c.budget)
	p.EcartTendance = fcPtr(c.atterTend - c.budget)
	p.Statut = &statut
	p.Echeance = c.echeance
	p.BudgetEcheance = fcPtr(c.budget)
	p.ProjectionPlanEcheance = round2(c.atterPlan)
	p.ProjectionTendanceEcheance = round2(c.atterTend)
	p.NonConsomme = fcPtr(c.nc)
	p.RythmeNecessaire = fcPtr(necessaire)
	p.SemainesEcheance = c.sr
	p.SousConsommation = c.nc > s.SeuilSousConsoPct/100*c.budget+fcTolerance && c.nc > s.SeuilSousConsoEur+fcTolerance
	p.CibleMin = fcPtr(fcCibleMin(c.budget, s))
}

// fcBuild rounds the figures and builds the weekly points of axis[lo..hi].
func (r *run) fcBuild(ct, libelle string, c fcCalc, axis []string, cov []domain.Couverture, asIdx, lo, hi int) domain.PrevisionCT {
	p := domain.PrevisionCT{
		CT:                    ct,
		CTLibelle:             libelle,
		BudgetSource:          "aucun",
		PPS:                   round2(c.pps),
		Provisions:            round2(c.provisions),
		Consomme:              round2(c.consomme),
		ResteAFaire:           round2(c.reste),
		AtterrissagePlan:      round2(c.atterPlan),
		AtterrissageTendance:  round2(c.atterTend),
		RythmeHebdo:           round2(c.rythme),
		SemainesRestantes:     c.sr,
		FinPlan:               c.fin,
		Series:                make([]domain.PrevisionPoint, 0, max(0, hi-lo+1)),
		PlanHorsEnveloppe:     round2(c.planHors),
		ConsommeHorsEnveloppe: round2(c.consoHors),
	}
	if c.env != nil {
		e := *c.env
		p.Enveloppe = &e
	}
	if c.budgeted {
		fcBudget(&p, c, r.s)
	}
	for i := lo; i <= hi; i++ {
		w := axis[i]
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

// fcSynthese: lecture brute des CT configurés de par_ct (DECISIONS n° 19),
// sans compensation entre CT pour le dépassement et le non consommé. Le
// dépassement ne somme que les CT en statut dépassement (n° 22) : un résidu
// d'arrondi (≤ fcTolerance) reste lisible sur sa ligne mais n'est pas agrégé.
func fcSynthese(par []domain.PrevisionCT) domain.EnveloppesSynthese {
	out := domain.EnveloppesSynthese{NbCT: len(par)}
	for _, p := range par {
		if p.Enveloppe == nil {
			continue
		}
		out.NbConfigures++
		out.Montant += p.Enveloppe.Montant
		out.Atterrissage += p.AtterrissagePlan
		out.NonConsomme += *p.NonConsomme
		out.PlanHorsEnveloppe += p.PlanHorsEnveloppe
		if *p.Statut == domain.PrevisionDepassement {
			out.NbDepassement++
			out.Depassement += *p.EcartPlan
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
