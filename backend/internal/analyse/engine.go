// Package analyse croise le plan de charge (prévu) et le réalisé (imputé) :
// écarts par CT × ressource × semaine ISO, synthèse budgétaire, KPI, alertes
// et contrôles qualité (SPEC_analyse + docs/DECISIONS.md).
//
// Le moteur (Run) est pur et déterministe : aucune I/O, aucun log.
package analyse

import (
	"math"
	"sort"
	"strings"
	"time"

	"njord/internal/domain"
)

// Input is everything the engine needs. Lines/entries in statut drop must be
// excluded by the caller (the repo does it); they are ignored here anyway.
type Input struct {
	Plan      domain.Version
	Realise   domain.Version
	PlanLines []domain.PlanLine
	Entries   []domain.RealiseEntry
	Personnes []domain.Personne // référentiel (clé nom_normalise = names.Key)
	Squads    []domain.Squad
	// Période d'analyse en semaines ISO "2026-W36" ; "" = défaut (semaines communes).
	WeekFrom, WeekTo string
	IncludeInactive  bool
	Now              time.Time
}

type tupleKey struct{ CT, Key, Week string }

type tuple struct {
	prevu, reel float64
	hasPlan     bool
	hasReal     bool
	warn        bool
	inactive    bool
	conf        domain.Confidence // confiance des écritures (même clé → même confiance)
	squadID     *string
}

type resInfo struct {
	personneID *string
	ressource  string // « NOM Prénom » ; libellé (ligne non nominative) ; nom brut (illisible)
	label      string // nom de la fiche personne si elle existe, sinon ressource
	squadID    *string
	inactive   bool
}

type run struct {
	in   Input
	s    domain.Settings
	cal  Calendar
	en   Enricher
	m    *matcher
	q    *qualite
	from string
	to   string

	lines     []domain.PlanLine
	entries   []domain.RealiseEntry
	enr       []Enrichment
	ids       []*identity // résolution des écritures MO (heures ≠ 0), nil sinon
	personnes map[string]*domain.Personne
	squads    map[string]string
	info      map[string]*resInfo
	tuples    map[tupleKey]*tuple
	ctLibelle map[string]string
	corr      map[string]*domain.Correspondance // par nom réalisé brut
}

// Run produces the full analysis.
func Run(in Input, s domain.Settings) domain.AnalyseResult {
	r := &run{
		in:        in,
		s:         s,
		cal:       NewCalendar(s),
		en:        NewEnricher(s),
		q:         newQualite(),
		personnes: map[string]*domain.Personne{},
		squads:    map[string]string{},
		info:      map[string]*resInfo{},
		tuples:    map[tupleKey]*tuple{},
		ctLibelle: map[string]string{},
		corr:      map[string]*domain.Correspondance{},
	}
	for _, l := range in.PlanLines {
		if l.StatutParsing != domain.ParsingDrop {
			r.lines = append(r.lines, l)
		}
	}
	for _, e := range in.Entries {
		if e.StatutParsing != domain.ParsingDrop {
			r.entries = append(r.entries, e)
		}
	}
	sort.SliceStable(r.lines, func(i, j int) bool { return r.lines[i].RowNum < r.lines[j].RowNum })
	sort.SliceStable(r.entries, func(i, j int) bool { return r.entries[i].RowNum < r.entries[j].RowNum })
	for i := range in.Personnes {
		r.personnes[in.Personnes[i].ID] = &in.Personnes[i]
	}
	for _, sq := range in.Squads {
		r.squads[sq.ID] = sq.NomCanonique
	}
	r.m = newMatcher(in.Personnes, r.lines)

	r.enrich()
	r.period()
	r.planSide()
	r.realSide()
	ecarts, kpis := r.rows()
	budget, alertes := r.budget()
	kpis.PctSecurise = budget.Global.PctSecurite
	kpis.NbCTRisque = len(alertes.CTRisque)
	r.dataQuality()

	corr := make([]domain.Correspondance, 0, len(r.corr))
	for _, c := range r.corr {
		c.Heures = round2(c.Heures)
		corr = append(corr, *c)
	}
	sortCorrespondances(corr)

	plan, real := in.Plan, in.Realise
	res := domain.AnalyseResult{
		Meta: domain.AnalyseMeta{
			PlanVersion:     &plan,
			RealiseVersion:  &real,
			ArchivedWarning: plan.Statut == domain.StatutArchivee || real.Statut == domain.StatutArchivee,
			WeekFrom:        r.from,
			WeekTo:          r.to,
			Weeks:           nonNilWeeks(r.cal.Weeks(r.from, r.to)),
			IncludeInactive: in.IncludeInactive,
			GeneratedAt:     in.Now,
		},
		KPIs:            kpis,
		Ecarts:          ecarts,
		Budget:          budget,
		Alertes:         alertes,
		Qualite:         r.q.list(),
		Correspondances: corr,
	}
	res.Previsions = r.previsions()
	res.Anomalies = r.anomalies(&res)
	return res
}

func nonNilWeeks(w []domain.WeekInfo) []domain.WeekInfo {
	if w == nil {
		return []domain.WeekInfo{}
	}
	return w
}

func round2(v float64) float64 {
	r := math.Round(v*100) / 100
	if r == 0 {
		return 0 // pas de -0
	}
	return r
}

func (r *run) inPeriod(week string) bool {
	return week != "" && r.from != "" && week >= r.from && week <= r.to
}

// enrich computes §3 for every entry and resolves the identity of MO entries.
func (r *run) enrich() {
	r.enr = make([]Enrichment, len(r.entries))
	r.ids = make([]*identity, len(r.entries))
	for i := range r.entries {
		e := &r.entries[i]
		r.enr[i] = r.en.Enrich(e)
		tg := strings.TrimSpace(e.TG)
		if tg != "" && r.ctLibelle[tg] == "" && strings.TrimSpace(e.TGLibelle) != "" {
			r.ctLibelle[tg] = ctLabel(tg, e.TGLibelle)
		}
		if r.enr[i].MO && r.enr[i].Heures != 0 { // contre-passations (heures < 0) incluses
			id := r.m.resolve(e.NomPrenom, entryName(e))
			r.ids[i] = &id
		}
	}
}

// period sets r.from / r.to (explicit bounds win, defaults otherwise).
func (r *run) period() {
	var pMin, pMax, rMin, rMax string
	for _, l := range r.lines {
		if _, ok := ParseDate(l.DateDebut); ok && (pMin == "" || l.DateDebut[:10] < pMin) {
			pMin = l.DateDebut[:10]
		}
		if _, ok := ParseDate(l.DateFin); ok && (pMax == "" || l.DateFin[:10] > pMax) {
			pMax = l.DateFin[:10]
		}
	}
	for _, e := range r.entries {
		if _, ok := ParseDate(e.DateDepense); ok {
			d := e.DateDepense[:10]
			if rMin == "" || d < rMin {
				rMin = d
			}
			if rMax == "" || d > rMax {
				rMax = d
			}
		}
	}
	defFrom, defTo, disjoint := DefaultPeriod(pMin, pMax, rMin, rMax)
	from, err1 := NormalizeWeek(r.in.WeekFrom)
	to, err2 := NormalizeWeek(r.in.WeekTo)
	if err1 != nil {
		from = defFrom
	}
	if err2 != nil {
		to = defTo
	}
	if disjoint && (err1 != nil || err2 != nil) {
		r.q.add("periode_disjointe", "")
	}
	if from == "" {
		from = to
	}
	if to == "" {
		to = from
	}
	if from > to {
		from, to = to, from
	}
	r.from, r.to = from, to
}

func (r *run) tuple(ct, key, week string) *tuple {
	k := tupleKey{ct, key, week}
	t := r.tuples[k]
	if t == nil {
		t = &tuple{}
		r.tuples[k] = t
	}
	return t
}

// planSide unfolds every plan line per week (§4) and checks §4.2.
func (r *run) planSide() {
	for i := range r.lines {
		l := &r.lines[i]
		key := planLineKey(l)
		ct := strings.TrimSpace(l.CT)
		inf := r.info[key]
		if inf == nil {
			inf = &resInfo{ressource: planLineLabel(l)}
			inf.label = inf.ressource
			if strings.HasPrefix(key, "N:") {
				p := r.m.personne(key)
				if p == nil && l.PersonneID != nil {
					p = r.personnes[*l.PersonneID]
				}
				if p != nil {
					pid := p.ID
					inf.personneID = &pid
					if strings.TrimSpace(p.DisplayName) != "" {
						inf.label = p.DisplayName
					}
					inf.squadID = p.SquadID
				}
			}
			r.info[key] = inf
		}
		if l.SquadID != nil && inf.squadID == nil {
			inf.squadID = l.SquadID
		}
		inf.inactive = inf.inactive || l.Inactive

		if l.ChargeTotale == 0 || !r.en.IsMOLine(l) {
			continue
		}
		weeks, ok := r.cal.Distribute(l.DateDebut, l.DateFin, l.ChargeTotale)
		if !ok {
			r.q.add("plan_repartition", lineRef(l)+" : dates invalides, charge non répartie")
			continue
		}
		sum := 0.0
		for _, v := range weeks {
			sum += v
		}
		if math.Abs(sum-l.ChargeTotale) > 0.5 {
			r.q.add("plan_repartition", lineRef(l)+" : "+fmtH(sum)+" h répartis pour "+fmtH(l.ChargeTotale)+" h")
		}
		wk := make([]string, 0, len(weeks))
		for w := range weeks {
			wk = append(wk, w)
		}
		sort.Strings(wk)
		for _, w := range wk {
			if !r.inPeriod(w) || weeks[w] == 0 {
				continue
			}
			t := r.tuple(ct, key, w)
			t.prevu += weeks[w]
			t.hasPlan = true
			if t.squadID == nil && l.SquadID != nil {
				t.squadID = l.SquadID
			}
			t.inactive = t.inactive || l.Inactive
			t.warn = t.warn || l.StatutParsing == domain.ParsingWarn
		}
	}
}

func lineRef(l *domain.PlanLine) string {
	return "ligne " + itoa(l.RowNum) + " (" + strings.TrimSpace(l.CT) + ")"
}

// realSide aggregates the MO hours of the period per (CT, ressource, semaine).
func (r *run) realSide() {
	weekly := map[[2]string]float64{} // (key, week) → Σ heures (règle 2)
	weeklyLabel := map[string]string{}
	for i := range r.entries {
		id := r.ids[i]
		if id == nil {
			continue
		}
		e := &r.entries[i]
		en := r.enr[i]
		tg := strings.TrimSpace(e.TG)
		if tg == "" {
			continue // compté dans sans_tg
		}
		if en.ISOWeek == "" {
			r.q.add("sans_date", "ligne "+itoa(e.RowNum))
			continue
		}
		if !r.inPeriod(en.ISOWeek) {
			continue
		}
		name := entryName(e)
		switch {
		case id.Key == "X:":
			r.q.add("mo_sans_nom", "ligne "+itoa(e.RowNum)+" ("+tg+")")
		case strings.HasPrefix(id.Key, "U:"):
			r.q.add("mo_sans_nom", "ligne "+itoa(e.RowNum)+" ("+tg+") : « "+name+" »")
		}
		inf := r.info[id.Key]
		if inf == nil {
			inf = &resInfo{personneID: id.PersonneID}
			switch {
			case strings.HasPrefix(id.Key, "N:"):
				inf.ressource = strings.TrimSpace(e.NomPrenom)
			case name != "":
				inf.ressource = name
			default:
				inf.ressource = noName
			}
			inf.label = inf.ressource
			if p := r.m.personne(id.Key); p != nil {
				if strings.TrimSpace(p.DisplayName) != "" {
					inf.label = p.DisplayName
				}
				inf.squadID = p.SquadID
			}
			r.info[id.Key] = inf
		}

		t := r.tuple(tg, id.Key, en.ISOWeek)
		t.reel += en.Heures
		t.hasReal = true
		t.conf = id.Confidence
		t.warn = t.warn || e.StatutParsing == domain.ParsingWarn

		wk := [2]string{id.Key, en.ISOWeek}
		weekly[wk] += en.Heures
		weeklyLabel[id.Key] = inf.label

		c := r.corr[name]
		if c == nil {
			c = &domain.Correspondance{
				NomRealise: name,
				NomPrenom:  strings.TrimSpace(e.NomPrenom),
				PersonneID: id.PersonneID,
				Confidence: id.Confidence,
			}
			if id.matched() || id.PersonneID != nil {
				c.PersonneNom = inf.label
			}
			r.corr[name] = c
		}
		c.NbEcritures++
		c.Heures += en.Heures
	}
	keys := make([][2]string, 0, len(weekly))
	for k, v := range weekly {
		if v > r.s.SeuilQuantiteSemaineH {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i][1] != keys[j][1] {
			return keys[i][1] < keys[j][1]
		}
		return keys[i][0] < keys[j][0]
	})
	for _, k := range keys {
		r.q.add("mo_quantite_semaine", weeklyLabel[k[0]]+" — "+k[1]+" : "+fmtH(weekly[k])+" h")
	}
}

// rows evaluates the flags (§6) and the aggregates (§6.1).
func (r *run) rows() ([]domain.EcartRow, domain.KPIs) {
	personReel := map[string]float64{}
	personPrevu := map[string]float64{}
	for k, t := range r.tuples {
		personReel[k.Key] += t.reel
		personPrevu[k.Key] += t.prevu
	}
	var k domain.KPIs
	rows := make([]domain.EcartRow, 0, len(r.tuples))
	for tk, t := range r.tuples {
		inf := r.info[tk.Key]
		if inf == nil {
			inf = &resInfo{ressource: tk.Key}
		}
		row := domain.EcartRow{
			PersonneID:     inf.personneID,
			Ressource:      inf.ressource,
			RessourceLabel: inf.label,
			CT:             tk.CT,
			CTLibelle:      r.ctLibelle[tk.CT],
			Semaine:        tk.Week,
			Prevu:          round2(t.prevu),
			Reel:           round2(t.reel),
			Warn:           t.warn,
			SquadID:        t.squadID,
		}
		if t.hasPlan {
			row.Inactive = t.inactive
		} else {
			row.Inactive = inf.inactive
		}
		if row.SquadID == nil {
			row.SquadID = inf.squadID
		}
		if row.SquadID != nil {
			row.SquadNom = r.squads[*row.SquadID]
		}
		row.Ecart = round2(row.Reel - row.Prevu)
		if t.hasReal {
			row.Confidence = t.conf
		} else {
			row.Confidence = domain.ConfPlan
		}

		monday, _ := WeekMonday(tk.Week)
		switch {
		case t.hasReal && t.conf == domain.ConfNone:
			row.Flag = domain.FlagHorsPlan
		case row.Reel != 0 && r.cal.IsLockedWeek(monday):
			row.Flag = domain.FlagHorsPlan
		case row.Reel == 0 && row.Prevu > 0 && personReel[tk.Key] == 0:
			row.Flag = domain.FlagAbsence
		case row.Ecart > r.s.SeuilSurImputationH:
			row.Flag = domain.FlagSurImputation
		case row.Ecart < -r.s.SeuilSousImputationH:
			row.Flag = domain.FlagSousImputation
		default:
			row.Flag = domain.FlagConforme
		}

		switch row.Flag {
		case domain.FlagHorsPlan:
			k.NbHorsPlan++
			k.HeuresHorsPlan += t.reel
		case domain.FlagAbsence:
			k.NbAbsence++
		case domain.FlagSurImputation:
			k.NbSurImputation++
		case domain.FlagSousImputation:
			k.NbSousImputation++
		}
		if row.Flag != domain.FlagHorsPlan && (!row.Inactive || r.in.IncludeInactive) {
			k.NbTuplesCompares++
			if row.Flag == domain.FlagConforme {
				k.NbConformes++
			}
		}
		k.TotalPrevuH += t.prevu
		k.TotalReelH += t.reel
		rows = append(rows, row)
	}
	SortEcarts(rows)

	k.HeuresHorsPlan = round2(k.HeuresHorsPlan)
	k.TotalPrevuH = round2(k.TotalPrevuH)
	k.TotalReelH = round2(k.TotalReelH)
	k.PointsSurImputation = 2 * k.NbSurImputation
	k.PointsSousImputation = k.NbSousImputation
	k.PointsAbsence = 2 * k.NbAbsence
	if r.s.DiviseurHorsPlanH > 0 {
		k.PointsHorsPlan = int(math.Floor(k.HeuresHorsPlan / r.s.DiviseurHorsPlanH))
	}
	k.PointsTotal = k.PointsSurImputation + k.PointsSousImputation + k.PointsAbsence + k.PointsHorsPlan
	if k.NbTuplesCompares > 0 {
		v := float64(k.NbConformes) / float64(k.NbTuplesCompares)
		k.TauxConformite = &v
	}
	// Personnes = clés nominatives (« N: ») ; une ligne non nominative n'est pas une personne.
	for key, p := range personPrevu {
		if p > 0 && strings.HasPrefix(key, "N:") {
			k.NbPersonnesPlanifiees++
			if personReel[key] == 0 {
				k.NbPersonnesAbsentes++
			}
		}
	}
	if k.NbPersonnesPlanifiees > 0 {
		v := float64(k.NbPersonnesAbsentes) / float64(k.NbPersonnesPlanifiees)
		k.TauxAbsence = &v
	}
	return rows, k
}

// SortEcarts applies the default order: severity desc, |écart| desc, then
// CT / ressource / semaine for determinism.
func SortEcarts(rows []domain.EcartRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if sa, sb := domain.FlagSeverity[a.Flag], domain.FlagSeverity[b.Flag]; sa != sb {
			return sa > sb
		}
		if ea, eb := math.Abs(a.Ecart), math.Abs(b.Ecart); ea != eb {
			return ea > eb
		}
		if a.CT != b.CT {
			return a.CT < b.CT
		}
		if a.Ressource != b.Ressource {
			return a.Ressource < b.Ressource
		}
		if a.Semaine != b.Semaine {
			return a.Semaine < b.Semaine
		}
		return a.RessourceLabel < b.RessourceLabel
	})
}

// ctLabel retire le code en tête du libellé TG du réalisé (« Y99F900011 - Réserve… » → « Réserve… »),
// le code étant toujours affiché à côté.
func ctLabel(tg, libelle string) string {
	l := strings.TrimSpace(libelle)
	if rest, ok := strings.CutPrefix(l, tg); ok {
		if t := strings.TrimLeft(rest, " -–—:"); t != "" {
			return t
		}
	}
	return l
}
