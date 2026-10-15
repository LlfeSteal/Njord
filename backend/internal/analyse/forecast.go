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
//   - consommé = Σ TOTAL EN € brut (MO comprise) daté ≤ as_of (+ sans date) ;
//   - reste à faire = dépense prévue (plan seul) des segments datés ≥ D ;
//   - tendance = rythme (réalisé de [D − 28 j, D − 1] ÷ 4) × semaines restantes.
//
// Date de référence (DECISIONS n° 31) : D = date d'effet de la dernière version
// de la timeline (Timeline.DateReference : plus grande date_effet des fenêtres
// non vides) ; sans fenêtre : lendemain du dernier réalisé, à défaut la date du
// jour (Input.Now). as_of = D − 1.
// Un segment de la timeline appartient à une seule fenêtre : il est entièrement
// avant D ou entièrement à partir de D (au jour près ; dates invalides : à partir
// de D s'il appartient à la version de D). Le réalisé daté ≥ D est ignoré
// (DECISIONS n° 32) : ni consommé, ni rythme, ni atterrissage, ni courbe ou
// heures réelles — l'atterrissage est la photo de la reprev. Courbes : le réel
// s'arrête à la semaine d'as_of (réel ≤ as_of, départ commun des projections) ;
// le plan ≥ D de cette semaine est cumulé au point suivant (au plus tard le
// dernier de l'axe).
//
// Budget = enveloppe du fichier, rien d'autre (DECISIONS n° 20) : le PPS est
// informatif (ni budget, ni série de budget).
//
// Provisions (DECISIONS n° 23) : une provision de ligne de coût PROVISIONS POUR
// ALEAS est non sécurisée (aléas : jamais dans l'atterrissage) ; toute autre est
// sécurisée. Sécurisées comptées = datées (date de début, sinon de fin) dans la
// période de l'enveloppe ou sans date ; sans enveloppe : toutes ; datées hors
// période → provisions hors enveloppe (affichées à part). Atterrissage plan
// (atterrissage sécurisé) = consommé + reste à faire + provisions sécurisées
// comptées ; plan_cumul ajoute chacune dans sa semaine (sans date : semaine de
// l'échéance, sinon dernière semaine de l'axe ; jamais avant la semaine qui suit
// as_of, pour que la courbe parte du réel et finisse sur l'atterrissage).
//
// CT avec enveloppe (Input.Enveloppes, DECISIONS n° 19) : budget = montant,
// exercice propre au CT sur sa période [D, E] (ici D = début de l'enveloppe) (semaines ISO WD et WE incluses
// entières) :
//   - consommé = € datés dans [D, E] et ≤ as_of + écritures sans date ; les €
//     datés ≤ as_of hors période vont au réalisé hors enveloppe (exclus du
//     consommé, du rythme et des séries ; les heures réelles restent comptées) ;
//   - prévu des semaines < WD ou > WE (+ PPS hors série) = plan hors
//     enveloppe : ni reste à faire, ni série ;
//   - reste à faire = prévu daté ≥ date de référence des semaines [WD, WE] ;
//     tendance = consommé + rythme (réel de la période) × semaines ]as_of, WE] ;
//   - échéance = E, budget de l'échéance = montant, projections = atterrissages ;
//     non consommé = montant − atterrissage plan (sécurisé), plancher 0
//     (DECISIONS n° 21, 23) : la tendance ne sert qu'aux tracés et à la vigilance ;
//     sous-consommation si non consommé > seuil % du montant et > seuil €
//     (indicateur séparé du statut, n° 17) ; zone cible [cible_min, montant] ;
//   - séries cumulées sur la période seule (0 avant WD, plates après WE) ;
//     l'axe couvre toute la période pour que la tendance atteigne l'atterrissage.
//
// CT sans enveloppe : aucun budget (champs de budget nil), horizon = tout le
// plan ; consommé, atterrissages et séries restent calculés.
//
// ETP (DECISIONS n° 25) : par semaine, Σ des segments MO (ligne de coût ∈
// mo_types) de pourcentage/100 × jours ouvrés (segment ∩ semaine) ÷ jours
// ouvrés de la semaine (0 sans jour ouvré) ; non restreints à la période de
// l'enveloppe (comme heures_plan).
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
//
// Filtre d'année (DECISIONS n° 24, previsionsFor(N)) : année N = semaines ISO
// d'année ISO N, du lundi de N-W01 au dimanche de sa dernière semaine. Une
// enveloppe dont [WD, WE] recoupe N devient une tranche : dates bornées à N,
// montant × jours calendaires de la tranche ÷ jours de la période (arrondi au
// centime) ; € datés dans la tranche (+ sans date au même prorata) ; plan des
// semaines de la tranche ; provisions sécurisées datées dans la tranche (+ sans
// date au prorata) ; les mêmes mécaniques s'appliquent ensuite à la tranche. Le
// plan et le réalisé hors enveloppe ne retiennent que ce qui, hors de la période
// entière, tombe dans les semaines de N (le plan d'une semaine de la période
// située hors de N n'est pas « hors enveloppe » : il relève d'une autre tranche) ;
// le PPS hors série (sans semaine) n'appartient à aucune année. Le rythme reste
// celui des 28 jours avant la date de référence, sur le réel de toute la période
// (un rythme, pas un montant) ; les semaines restantes partent de max(as_of,
// début de N) ; années proposées à partir de celle de la date de référence. CT sans
// enveloppe : semaines de N seules (€ et provisions datés dans N ; les sans
// date, faute de prorata, n'appartiennent à aucune année), horizon borné à la
// fin de N ; un tel CT sans rien dans N et une enveloppe sans tranche sortent
// de par_ct. Séries sur les semaines de N, cumulées depuis 0.

// fcTolerance absorbe les arrondis dans la comparaison atterrissage / budget.
const fcTolerance = 0.5

// fcYear is the year filter of the forecast (DECISIONS n° 24) ; active = false
// pour « Tout ».
type fcYear struct {
	active   bool
	wLo, wHi string // première et dernière semaines ISO de l'année
	dLo, dHi string // lundi de wLo et dimanche de wHi (YYYY-MM-DD)
}

func newFcYear(annee int) fcYear {
	if annee <= 0 || annee > 9999 {
		return fcYear{}
	}
	lo := time.Date(annee, time.January, 4, 0, 0, 0, 0, time.UTC)   // le 4 janvier est toujours en semaine 1
	hi := time.Date(annee, time.December, 28, 0, 0, 0, 0, time.UTC) // le 28 décembre, toujours en dernière semaine
	mLo, err1 := WeekMonday(WeekOf(lo))
	mHi, err2 := WeekMonday(WeekOf(hi))
	if err1 != nil || err2 != nil {
		return fcYear{}
	}
	return fcYear{active: true, wLo: WeekOf(lo), wHi: WeekOf(hi),
		dLo: mLo.Format(time.DateOnly), dHi: mHi.AddDate(0, 0, 6).Format(time.DateOnly)}
}

// week: la semaine ISO w appartient à l'année (toujours vrai pour « Tout »).
func (y fcYear) week(w string) bool { return !y.active || (w >= y.wLo && w <= y.wHi) }

// date: la date d (YYYY-MM-DD) appartient à l'année.
func (y fcYear) date(d string) bool { return !y.active || (d >= y.dLo && d <= y.dHi) }

// fcBucket accumulates the raw (unrounded) figures of one CT.
type fcBucket struct {
	pps, provisions float64
	ppsHorsSerie    float64 // PPS hors série hebdo (spreadPPS nil)
	consomme        float64
	undated         float64            // € d'écritures sans date de dépense valide retenus (comptés au consommé)
	prevu           map[string]float64 // dépense prévue par semaine (tous les segments)
	prevuFutur      map[string]float64 // dépense prévue des segments datés ≥ date de référence (DECISIONS n° 31)
	reel            map[string]float64 // € datés ≤ as_of de la période (de la tranche en année N), par semaine
	rythme4         float64            // € de toute la période datés dans [D − 28 j, D − 1] (rythme, indépendant de l'année)
	hplan           map[string]float64
	hreel           map[string]float64 // heures MO réelles datées ≤ as_of
	etp             map[string]float64 // ETP planifiés par semaine (DECISIONS n° 25)
	fin             string             // max date_fin (YYYY-MM-DD)
	// Enveloppe (DECISIONS n° 19) : période [wd, we] en semaines ISO ; nil = sans budget.
	// En année N, env = tranche et full = enveloppe entière (DECISIONS n° 24).
	env       *domain.Enveloppe
	full      *domain.Enveloppe
	wd, we    string
	consoHors float64 // € datés hors de la période (exclus du consommé)
	// ratio : part retenue des écritures et provisions sans date (1 pour « Tout »,
	// prorata de la tranche, 0 pour un CT sans enveloppe en année N).
	ratio float64
	// Provisions (DECISIONS n° 23).
	provSec, provAleas, provHors float64
	provWeek                     map[string]float64 // sécurisées comptées datées, par semaine
	provUndated                  float64            // sécurisées comptées sans date
	// Année N : skip = enveloppe sans tranche ; active = le CT a quelque chose dans N.
	skip, active bool
}

func newFcBucket() *fcBucket {
	return &fcBucket{prevu: map[string]float64{}, prevuFutur: map[string]float64{}, reel: map[string]float64{},
		hplan: map[string]float64{}, hreel: map[string]float64{}, etp: map[string]float64{},
		provWeek: map[string]float64{}, ratio: 1}
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

// fcSlice cuts an envelope (normalized dates) to the year (DECISIONS n° 24) :
// dates bornées aux jours de l'année, montant × jours calendaires de la tranche
// ÷ jours de la période, arrondi au centime ; ratio = cette même part. false si
// la période ne recoupe pas l'année.
func fcSlice(e domain.Enveloppe, y fcYear) (domain.Enveloppe, float64, bool) {
	s := e
	s.DateDebut, s.DateFin = maxStr(e.DateDebut, y.dLo), minStr(e.DateFin, y.dHi)
	if s.DateDebut > s.DateFin {
		return s, 0, false
	}
	days := func(a, b string) float64 {
		x, _ := ParseDate(a)
		z, _ := ParseDate(b)
		return math.Round(z.Sub(x).Hours()/24) + 1
	}
	ratio := days(s.DateDebut, s.DateFin) / days(e.DateDebut, e.DateFin)
	s.Montant = round2(e.Montant * ratio)
	return s, ratio, true
}

// fcProvisionDate: date d'une provision = date de début, sinon de fin
// (DECISIONS n° 23) ; false sans date valide.
func fcProvisionDate(p *domain.ProvisionLine) (string, bool) {
	for _, d := range []string{p.DateDebut, p.DateFin} {
		if t, ok := ParseDate(d); ok {
			return t.Format(time.DateOnly), true
		}
	}
	return "", false
}

// fcETP returns the planned FTE of a plan segment per ISO week (DECISIONS
// n° 25) : pourcentage/100 × jours ouvrés (segment ∩ semaine) ÷ jours ouvrés de
// la semaine ; une semaine sans jour ouvré (verrouillée, fériés) ne contribue
// pas. jo met en cache les jours ouvrés des semaines.
func (r *run) fcETP(l *domain.PlanLine, jo map[string]int) map[string]float64 {
	a, ok1 := ParseDate(l.DateDebut)
	b, ok2 := ParseDate(l.DateFin)
	if l.Pourcentage == 0 || !ok1 || !ok2 || b.Before(a) || b.Sub(a) > maxLineDays*24*time.Hour {
		return nil
	}
	days := map[string]int{}
	for d := a; !d.After(b); d = d.AddDate(0, 0, 1) {
		if r.cal.IsWorkday(d) {
			days[WeekOf(d)]++
		}
	}
	out := make(map[string]float64, len(days))
	for w, n := range days {
		tot, ok := jo[w]
		if !ok {
			if m, err := WeekMonday(w); err == nil {
				tot = r.cal.weekInfo(m).JoursOuvres
			}
			jo[w] = tot
		}
		if tot > 0 {
			out[w] = float64(l.Pourcentage) / 100 * float64(n) / float64(tot)
		}
	}
	return out
}

// fcCalc is the computed forecast of one bucket (or of the global), raw
// figures and series aligned on the axis.
type fcCalc struct {
	pps, provisions                               float64
	provSec, provAleas, provHors                  float64 // DECISIONS n° 23
	consomme, reste, atterPlan, atterTend, rythme float64
	sr                                            int // semaines restantes (avec budget : jusqu'à l'échéance)
	fin                                           string
	budgetCum, reelCum, planCum, tendCum, hp, hr  []float64
	etp                                           []float64
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

// fcAxis is the weekly axis of a forecast and the as_of landmarks.
type fcAxis struct {
	weeks    []string
	idx      map[string]int
	asIdx    int    // index de la semaine d'as_of, dernier point du réel (-1 : avant l'axe ou sans date de référence ; dernier : après l'axe)
	asOfWeek string // semaine ISO d'as_of
	fromWeek string // départ des semaines restantes (année N : max(as_of, semaine précédant N))
	finMax   string // année N : borne de l'horizon des CT sans enveloppe (dernier jour de N)
}

// index returns the position of w on the axis (bornée à l'axe).
func (ax fcAxis) index(w string) int {
	if i, ok := ax.idx[w]; ok {
		return i
	}
	if len(ax.weeks) > 0 && w < ax.weeks[0] {
		return 0
	}
	return len(ax.weeks) - 1
}

// previsions computes the landing forecast (SPEC_analyse §7.7), « Tout ».
func (r *run) previsions() domain.Previsions { return r.previsionsFor(0) }

// fcReference returns the reference date D (DECISIONS n° 31) : date d'effet de
// la dernière fenêtre non vide de la timeline ; sans fenêtre, lendemain du
// dernier réalisé, à défaut date du jour (Input.Now) ; "" si rien de tout cela.
func (r *run) fcReference() (ref string) {
	dernier := ""
	for i := range r.entries {
		if r.enr[i].ISOWeek == "" {
			continue
		}
		if d := r.entries[i].DateDepense[:10]; d > dernier {
			dernier = d
		}
	}
	switch {
	case r.tl.DateReference() != "":
		ref = r.tl.DateReference()
	case dernier != "":
		ref = addDays(dernier, 1)
	case !r.in.Now.IsZero():
		ref = r.in.Now.Format(time.DateOnly)
	}
	return ref
}

// previsionsFor computes the forecast of the ISO year annee (DECISIONS n° 24) ;
// annee ≤ 0 = « Tout ».
func (r *run) previsionsFor(annee int) domain.Previsions {
	y := newFcYear(annee)
	// Date de référence (DECISIONS n° 31) : as_of = veille de D.
	ref := r.fcReference()
	asOf := dayBefore(ref)
	asOfWeek := WeekOfDate(asOf)
	refVersion := r.tl.VersionAt(ref) // version de D : segments aux dates invalides comptés à partir de D
	buckets := map[string]*fcBucket{}
	get := func(ct string) *fcBucket {
		b := buckets[ct]
		if b == nil {
			b = newFcBucket()
			if e, ok := r.fcEnveloppe(ct); ok {
				full := e
				b.full = &full
				if !y.active {
					b.env = &e
				} else if s, ratio, ok := fcSlice(e, y); ok {
					b.env, b.ratio = &s, ratio
				} else {
					b.skip, b.ratio = true, 0
				}
				if b.env != nil {
					b.wd, b.we = WeekOfDate(b.env.DateDebut), WeekOfDate(b.env.DateFin)
				}
			} else if y.active {
				b.ratio = 0 // sans enveloppe, rien ne permet de rattacher un montant sans date à l'année
			}
			buckets[ct] = b
		}
		return b
	}
	axisMin, axisMax := "", ""
	extend := func(w string) {
		if w == "" || y.active { // année N : axe = semaines de N
			return
		}
		if axisMin == "" || w < axisMin {
			axisMin = w
		}
		if axisMax == "" || w > axisMax {
			axisMax = w
		}
	}

	// Plan : PPS, dépense prévue, heures MO et ETP par semaine (segments de la
	// timeline). Un segment est entier dans une fenêtre : daté ≥ D (dates
	// invalides : version de D) = plan à partir de la référence (reste à faire).
	jo := map[string]int{}
	for i := range r.lines {
		l := &r.lines[i]
		b := get(strings.TrimSpace(l.CT))
		d := day(l.DateDebut)
		futur := ref == "" || (d != "" && d >= ref) || (d == "" && l.VersionID == refVersion)
		if !y.active {
			b.pps += l.PPS
		}
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
		if spread == nil && !y.active {
			b.ppsHorsSerie += l.PPS // hors série : n'appartient à aucune année
		}
		for w, v := range spread {
			if !y.week(w) {
				continue
			}
			if y.active {
				b.pps += v
			}
			b.prevu[w] += v
			if futur {
				b.prevuFutur[w] += v
			}
			b.active = true
			extend(w)
		}
		if !r.en.IsMOLine(l) {
			continue
		}
		if l.ChargeTotale != 0 {
			if hours, ok := r.cal.Distribute(l.DateDebut, l.DateFin, l.ChargeTotale); ok {
				for w, h := range hours {
					if y.week(w) {
						b.hplan[w] += h
						b.active = true
					}
				}
			}
		}
		for w, v := range r.fcETP(l, jo) {
			if y.week(w) {
				b.etp[w] += v
				b.active = true
			}
		}
	}

	// Réalisé : consommé brut (€ datés ≤ as_of), heures MO, rythme (€ de toute la
	// période datés dans [D − 28 j, D − 1], indépendant de l'année). Avec
	// enveloppe, les € datés hors période sont mis à part (heures comptées). Le
	// réalisé daté ≥ D est ignoré (DECISIONS n° 32).
	r4 := addDays(ref, -28)
	for i := range r.entries {
		e := &r.entries[i]
		b := get(strings.TrimSpace(e.TG))
		w := r.enr[i].ISOWeek
		if w == "" {
			if b.ratio != 0 { // année N : au prorata de la tranche
				b.consomme += e.TotalEur * b.ratio
				b.undated += e.TotalEur * b.ratio
				b.active = true
			}
			continue
		}
		d := e.DateDepense[:10]
		if ref != "" && d >= r4 && d < ref && (b.full == nil || (d >= b.full.DateDebut && d <= b.full.DateFin)) {
			b.rythme4 += e.TotalEur
		}
		if !y.week(w) || (ref != "" && d >= ref) {
			continue
		}
		b.active = true
		b.hreel[w] += r.enr[i].Heures
		extend(w)
		if b.env != nil && (d < b.env.DateDebut || d > b.env.DateFin) {
			b.consoHors += e.TotalEur
			continue
		}
		b.consomme += e.TotalEur
		b.reel[w] += e.TotalEur
	}

	// Provisions (DECISIONS n° 23) : aléas à part ; sécurisées comptées si
	// datées dans la période (ou sans date), hors enveloppe sinon.
	for i := range r.provs {
		pv := &r.provs[i]
		b := get(strings.TrimSpace(pv.CT))
		d, dated := fcProvisionDate(pv)
		m := pv.Montant
		switch {
		case !dated:
			m *= b.ratio
			if b.ratio == 0 {
				continue
			}
		case !y.date(d):
			continue
		}
		b.active = true
		b.provisions += m
		switch {
		case isAleas(pv.LigneCout):
			b.provAleas += m
		case !dated:
			b.provSec += m
			b.provUndated += m
		case b.env != nil && (d < b.env.DateDebut || d > b.env.DateFin):
			b.provHors += m
		default:
			b.provSec += m
			b.provWeek[WeekOfDate(d)] += m
		}
	}

	// Axe prolongé à toute la période des enveloppes : la tendance d'un CT
	// configuré court jusqu'à sa fin (même si le plan s'arrête avant) et l'axe
	// du global couvre l'union des périodes ; prolongé aussi jusqu'aux
	// provisions sécurisées comptées les plus tardives (courbe plan).
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
		for w := range b.provWeek {
			if axisMax == "" || w > axisMax {
				extend(w)
			}
		}
	}

	ax := fcAxis{idx: map[string]int{}, asIdx: -1, asOfWeek: asOfWeek, fromWeek: asOfWeek}
	var cov []domain.Couverture
	from, to := axisMin, axisMax
	if y.active {
		from, to = y.wLo, y.wHi
		ax.finMax = y.dHi
		if lo, err := WeekMonday(y.wLo); err == nil && asOfWeek != "" && asOfWeek < y.wLo {
			ax.fromWeek = WeekOf(lo.AddDate(0, 0, -7)) // semaines restantes comptées depuis le début de N
		}
	}
	for _, wi := range r.tl.weeks(r.cal, from, to) {
		ax.idx[wi.Week] = len(ax.weeks)
		ax.weeks = append(ax.weeks, wi.Week)
		cov = append(cov, wi.Couverture)
	}
	n := len(ax.weeks)
	// Index d'une semaine sur l'axe : -1 avant l'axe (ou inconnue), dernier après.
	at := func(w string) int {
		if i, ok := ax.idx[w]; ok {
			return i
		}
		if w != "" && n > 0 && w > ax.weeks[n-1] {
			return n - 1
		}
		return -1
	}
	ax.asIdx = at(asOfWeek) // après l'axe (année passée) : tout est réalisé

	cts := make([]string, 0, len(buckets))
	for ct, b := range buckets {
		// Lignes sans CT / écritures sans TG : hors de toute enveloppe. Année N :
		// enveloppe sans tranche, ou CT sans enveloppe sans rien dans N → hors de par_ct.
		if ct != "" && !(y.active && (b.skip || (b.env == nil && !b.active))) {
			cts = append(cts, ct)
		}
	}
	sort.Strings(cts)

	g := fcCalc{budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n), etp: make([]float64, n)}
	out := domain.Previsions{Annees: r.fcAnnees(ref, buckets), DateReference: ref, AsOf: asOf, AsOfWeek: asOfWeek,
		ParCT: []domain.PrevisionCT{}}
	if y.active {
		out.Annee = annee
	}
	for _, ct := range cts {
		b := buckets[ct]
		c := r.fcCompute(b, ax)
		out.ParCT = append(out.ParCT, r.fcBuild(ct, r.ctLibelle[ct], c, ax, cov, 0, n-1))
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
		g.provSec += c.provSec
		g.provAleas += c.provAleas
		g.provHors += c.provHors
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
			g.etp[i] += c.etp[i]
		}
	}
	h := &out.HorsEnveloppe
	h.Consomme, h.AtterrissagePlan, h.AtterrissageTendance = round2(h.Consomme), round2(h.AtterrissagePlan), round2(h.AtterrissageTendance)

	// Séries du global sur l'union des périodes [min WD, max WE] ; vides sans enveloppe.
	lo, hi := 0, -1
	if g.budgeted {
		g.sr = fcRemaining(ax.weeks, ax.fromWeek, g.echeance)
		lo, hi = n, -1
		for i, w := range ax.weeks {
			if w >= envMin && w <= envMax {
				lo, hi = min(lo, i), i
			}
		}
	}
	out.Global = r.fcBuild("", "Périmètre", g, ax, cov, lo, hi)
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

// fcAnnees lists the selectable years (DECISIONS n° 24) : de l'année ISO de la
// date de référence (DECISIONS n° 31 ; à défaut celle d'Input.Now) à l'année ISO
// de la fin d'enveloppe la plus tardive des CT connus des sources ; [] sans enveloppe.
func (r *run) fcAnnees(ref string, buckets map[string]*fcBucket) []int {
	out := []int{}
	start, end, first := 0, 0, 0
	for ct, b := range buckets {
		if ct == "" || b.full == nil {
			continue
		}
		if t, ok := ParseDate(b.full.DateFin); ok {
			if yy, _ := t.ISOWeek(); yy > end {
				end = yy
			}
		}
		if t, ok := ParseDate(b.full.DateDebut); ok {
			if yy, _ := t.ISOWeek(); first == 0 || yy < first {
				first = yy
			}
		}
	}
	if end == 0 {
		return out
	}
	switch t, ok := ParseDate(ref); {
	case ok:
		start, _ = t.ISOWeek()
	case !r.in.Now.IsZero():
		start, _ = r.in.Now.ISOWeek()
	default:
		start = first
	}
	for yy := start; yy <= end && len(out) < 100; yy++ {
		out = append(out, yy)
	}
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
// Atterrissage plan = consommé + reste + provisions sécurisées comptées (n° 23) ;
// reste = plan daté ≥ date de référence, rythme = réel de [D − 28 j, D − 1] ÷ 4
// (DECISIONS n° 31).
func (r *run) fcCompute(b *fcBucket, ax fcAxis) fcCalc {
	axis, asIdx := ax.weeks, ax.asIdx
	n := len(axis)
	c := fcCalc{pps: b.pps, provisions: b.provisions, consomme: b.consomme, fin: b.fin,
		provSec: b.provSec, provAleas: b.provAleas, provHors: b.provHors,
		budgetCum: make([]float64, n), reelCum: make([]float64, n), planCum: make([]float64, n),
		tendCum: make([]float64, n), hp: make([]float64, n), hr: make([]float64, n), etp: make([]float64, n),
		env: b.env, consoHors: b.consoHors}
	if b.env != nil {
		c.budgeted, c.budget, c.echeance, c.planHors = true, b.env.Montant, b.env.DateFin, b.ppsHorsSerie
	}
	for w, v := range b.prevu {
		if !b.inPeriod(w) {
			c.planHors += v
		}
	}
	for w, v := range b.prevuFutur {
		if b.inPeriod(w) {
			c.reste += v
		}
	}
	c.rythme = b.rythme4 / 4 // réel de la période entière
	if b.env != nil {
		c.sr = fcRemaining(axis, ax.fromWeek, b.env.DateFin)
	} else {
		fin := b.fin
		if ax.finMax != "" && fin > ax.finMax {
			fin = ax.finMax
		}
		c.sr = fcRemaining(axis, ax.fromWeek, fin)
	}
	c.atterPlan = c.consomme + c.reste + c.provSec
	c.atterTend = c.consomme + c.rythme*float64(c.sr)
	if c.budgeted {
		c.nc = fcNonConsomme(c.budget, c.atterPlan)
	}

	// Provisions sécurisées comptées dans la courbe plan : semaine de leur date
	// (sans date : échéance, sinon dernière semaine de l'axe), au plus tôt la
	// semaine qui suit as_of, au plus tard la dernière de l'axe. De même pour le
	// plan daté ≥ D de la semaine d'as_of (DECISIONS n° 31) : les courbes partent
	// toutes du réel ≤ as_of.
	add := make([]float64, n)
	if n > 0 {
		place := func(i int, v float64) {
			i = min(max(i, asIdx+1), n-1)
			add[i] += v
		}
		for w, v := range b.provWeek {
			place(ax.index(w), v)
		}
		if _, ok := ax.idx[ax.asOfWeek]; ok && b.inPeriod(ax.asOfWeek) {
			place(asIdx, b.prevuFutur[ax.asOfWeek])
		}
		if b.provUndated != 0 {
			if b.env != nil {
				place(ax.index(b.we), b.provUndated)
			} else {
				place(n-1, b.provUndated)
			}
		}
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
		c.etp[i] = b.etp[w]
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
			// add[asIdx] ≠ 0 seulement si as_of est la dernière semaine de l'axe.
			plan = base + add[i]
			c.planCum[i], c.tendCum[i] = plan, base
		default:
			if b.inPeriod(w) {
				plan += b.prevuFutur[w]
			}
			plan += add[i]
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
// is past or unknown). Without as_of (aucune date de référence), every week of
// the axis up to fin counts.
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
// budget − atterrissage plan (sécurisé : consommé + reste + provisions
// sécurisées comptées) à l'échéance, plancher 0 (DECISIONS n° 21, 23). La
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

// fcBuild rounds the figures and builds the weekly points of axis[lo..hi] :
// réel jusqu'à la semaine d'as_of (DECISIONS n° 32), projections à partir d'elle.
func (r *run) fcBuild(ct, libelle string, c fcCalc, ax fcAxis, cov []domain.Couverture, lo, hi int) domain.PrevisionCT {
	axis, asIdx := ax.weeks, ax.asIdx
	p := domain.PrevisionCT{
		CT:                      ct,
		CTLibelle:               libelle,
		BudgetSource:            "aucun",
		PPS:                     round2(c.pps),
		Provisions:              round2(c.provisions),
		ProvisionsSecurisees:    round2(c.provSec),
		ProvisionsAleas:         round2(c.provAleas),
		ProvisionsHorsEnveloppe: round2(c.provHors),
		Consomme:                round2(c.consomme),
		ResteAFaire:             round2(c.reste),
		AtterrissagePlan:        round2(c.atterPlan),
		AtterrissageTendance:    round2(c.atterTend),
		RythmeHebdo:             round2(c.rythme),
		SemainesRestantes:       c.sr,
		FinPlan:                 c.fin,
		Series:                  make([]domain.PrevisionPoint, 0, max(0, hi-lo+1)),
		PlanHorsEnveloppe:       round2(c.planHors),
		ConsommeHorsEnveloppe:   round2(c.consoHors),
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
		pt := domain.PrevisionPoint{Week: w, BudgetCumul: round2(c.budgetCum[i]), HeuresPlan: round2(c.hp[i]), Couverture: cov[i],
			ETP: round2(c.etp[i])}
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
