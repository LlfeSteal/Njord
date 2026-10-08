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
	// Timeline du plan (SPEC_analyse §4.3) : versions retenues (importées au
	// plus tard avec PlanRef) et leurs lignes.
	Plans   []PlanSource
	PlanRef domain.Version // version choisie (meta.plan_version)
	// PlanSuperseded : une version de plan non purgée a été importée après
	// PlanRef (meta.archived_warning).
	PlanSuperseded bool
	Realise        domain.Version
	Entries        []domain.RealiseEntry
	Personnes      []domain.Personne // référentiel (clé nom_normalise = names.Key)
	Squads         []domain.Squad
	// Provisions (DECISIONS n° 16) : version retenue (nil = aucune, budget = Σ PPS)
	// et ses lignes ; charge max d'un CT = Σ PPS + Σ provisions.
	ProvisionVersion *domain.Version
	Provisions       []domain.ProvisionLine
	// Période d'analyse en semaines ISO "2026-W36" ; "" = défaut (semaines communes).
	WeekFrom, WeekTo string
	IncludeInactive  bool
	Now              time.Time
}

type tupleKey struct{ CT, Key, Week string }

type tuple struct {
	prevu, reel float64
	hasPlan     bool
	versionID   string // version de plan qui régit la semaine
	realDate    string // dernière date réalisée (version des tuples sans plan)
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
	tl   Timeline
	from string
	to   string

	lines     []domain.PlanLine // segments de la timeline (lignes coupées), dans l'ordre de la timeline
	full      []*domain.PlanLine
	multi     bool // plusieurs versions dans la timeline (références de ligne qualifiées)
	nonCouv   float64
	entries   []domain.RealiseEntry
	provs     []domain.ProvisionLine // lignes de provision non drop
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
	r.tl = BuildTimeline(r.cal, in.Plans)
	for _, sg := range r.tl.Segments {
		r.lines = append(r.lines, sg.Line)
		r.full = append(r.full, sg.Full)
	}
	r.multi = len(in.Plans) > 1
	for _, e := range in.Entries {
		if e.StatutParsing != domain.ParsingDrop {
			r.entries = append(r.entries, e)
		}
	}
	sort.SliceStable(r.entries, func(i, j int) bool { return r.entries[i].RowNum < r.entries[j].RowNum })
	for _, p := range in.Provisions {
		if p.StatutParsing != domain.ParsingDrop {
			r.provs = append(r.provs, p)
		}
	}
	for i := range in.Personnes {
		r.personnes[in.Personnes[i].ID] = &in.Personnes[i]
	}
	for _, sq := range in.Squads {
		r.squads[sq.ID] = sq.NomCanonique
	}
	r.m = newMatcher(in.Personnes, r.lines)

	r.enrich()
	r.provisionLibelles()
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

	kpis.HeuresNonCouvertes = round2(r.nonCouv)

	plan, real := in.PlanRef, in.Realise
	res := domain.AnalyseResult{
		Meta: domain.AnalyseMeta{
			PlanVersion:      &plan,
			RealiseVersion:   &real,
			ProvisionVersion: in.ProvisionVersion,
			ArchivedWarning:  in.PlanSuperseded || real.Statut == domain.StatutArchivee,
			WeekFrom:         r.from,
			WeekTo:           r.to,
			Weeks:            r.tl.weeks(r.cal, r.from, r.to),
			IncludeInactive:  in.IncludeInactive,
			GeneratedAt:      in.Now,
			Timeline:         r.tl.Windows,
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

// provisionLibelles: libellé des CT sans libellé réalisé = dernier segment du
// groupe de leurs lignes de provision (le sous-projet de l'export est le CT).
func (r *run) provisionLibelles() {
	for i := range r.provs {
		p := &r.provs[i]
		ct := strings.TrimSpace(p.CT)
		if ct == "" || r.ctLibelle[ct] != "" {
			continue
		}
		g := p.Groupe
		if k := strings.LastIndex(g, ">"); k >= 0 {
			g = g[k+1:]
		}
		if g = strings.TrimSpace(g); g != "" {
			r.ctLibelle[ct] = g
		}
	}
}

// period sets r.from / r.to (explicit bounds win, defaults otherwise).
func (r *run) period() {
	var rMin, rMax string
	pMin, pMax := r.tl.Span()
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
		// Contrôle §4.2 sur la ligne entière ; répartition sur le segment.
		full := r.full[i]
		all, ok := r.cal.Distribute(full.DateDebut, full.DateFin, full.ChargeTotale)
		if !ok {
			r.q.add("plan_repartition", r.lineRef(l)+" : dates invalides, charge non répartie")
			continue
		}
		sum := 0.0
		for _, v := range all {
			sum += v
		}
		if math.Abs(sum-full.ChargeTotale) > 0.5 {
			r.q.add("plan_repartition", r.lineRef(l)+" : "+fmtH(sum)+" h répartis pour "+fmtH(full.ChargeTotale)+" h")
		}
		weeks, _ := r.cal.Distribute(l.DateDebut, l.DateFin, l.ChargeTotale)
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
			t.versionID = l.VersionID // semaine à cheval : la version la plus récente l'emporte
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

// lineRef qualifies the line with its version when the timeline has several.
func (r *run) lineRef(l *domain.PlanLine) string {
	if !r.multi {
		return lineRef(l)
	}
	for _, w := range r.tl.Windows {
		if w.VersionID == l.VersionID && w.Intitule != "" {
			return lineRef(l) + " — " + w.Intitule
		}
	}
	return lineRef(l)
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
		// Jour non couvert par la timeline : ni écart, ni hors plan, ni anomalie.
		date := e.DateDepense[:10]
		vid := r.tl.VersionAt(date)
		if vid == "" {
			r.nonCouv += en.Heures
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
		if !t.hasPlan && date >= t.realDate {
			t.versionID, t.realDate = vid, date
		}
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

// rows evaluates the flags (§6), the erreurs de CT (§6.2) and the aggregates (§6.1).
func (r *run) rows() ([]domain.EcartRow, domain.KPIs) {
	personReel := map[string]float64{}
	personPrevu := map[string]float64{}
	tks := make([]tupleKey, 0, len(r.tuples))
	for k, t := range r.tuples {
		personReel[k.Key] += t.reel
		personPrevu[k.Key] += t.prevu
		tks = append(tks, k)
	}
	// Ordre stable (CT, ressource, semaine) : les maps sont aléatoires et la
	// réaffectation des erreurs de CT dépend de l'ordre des sommes.
	sort.Slice(tks, func(i, j int) bool {
		a, b := tks[i], tks[j]
		if a.CT != b.CT {
			return a.CT < b.CT
		}
		if a.Key != b.Key {
			return a.Key < b.Key
		}
		return a.Week < b.Week
	})
	rows := make([]domain.EcartRow, 0, len(tks))
	evals := make([]flagEval, 0, len(tks))
	for _, tk := range tks {
		t := r.tuples[tk]
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
			CTsLies:        []string{},
		}
		if t.versionID != "" {
			vid := t.versionID
			row.PlanVersionID = &vid
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
		ev := flagEval{tk: tk, t: t, locked: r.cal.IsLockedWeek(monday), personReel: personReel[tk.Key]}
		row.Flag = r.flagOf(ev, row.Reel, row.Prevu, row.Ecart)
		rows = append(rows, row)
		evals = append(evals, ev)
	}
	r.erreursCT(rows, evals)

	var k domain.KPIs
	for i := range rows {
		row, t := &rows[i], evals[i].t
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
		case domain.FlagErreurCT:
			k.NbErreurCT++
			if row.Prevu == 0 { // côté CT imputé à tort
				k.PointsErreurCT++
				k.HeuresErreurCT += t.reel
			}
		}
		if row.Flag != domain.FlagHorsPlan && (!row.Inactive || r.in.IncludeInactive) {
			k.NbTuplesCompares++
			if row.Flag == domain.FlagConforme {
				k.NbConformes++
			}
		}
		k.TotalPrevuH += t.prevu
		k.TotalReelH += t.reel
	}
	SortEcarts(rows)

	k.HeuresHorsPlan = round2(k.HeuresHorsPlan)
	k.HeuresErreurCT = round2(k.HeuresErreurCT)
	k.TotalPrevuH = round2(k.TotalPrevuH)
	k.TotalReelH = round2(k.TotalReelH)
	k.PointsSurImputation = 2 * k.NbSurImputation
	k.PointsSousImputation = k.NbSousImputation
	k.PointsAbsence = 2 * k.NbAbsence
	if r.s.DiviseurHorsPlanH > 0 {
		k.PointsHorsPlan = int(math.Floor(k.HeuresHorsPlan / r.s.DiviseurHorsPlanH))
	}
	k.PointsTotal = k.PointsSurImputation + k.PointsSousImputation + k.PointsAbsence + k.PointsHorsPlan + k.PointsErreurCT
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

// flagEval is what the flag of a tuple depends on, besides its gap.
type flagEval struct {
	tk         tupleKey
	t          *tuple
	locked     bool    // semaine verrouillée
	personReel float64 // Σ réel de la ressource sur la période
}

// flagOf evaluates §6 on a gap (brut, ou ajusté par la réaffectation §6.2) ;
// reel / prevu restent les valeurs brutes du tuple.
func (r *run) flagOf(ev flagEval, reel, prevu, ecart float64) domain.Flag {
	switch {
	case ev.t.hasReal && ev.t.conf == domain.ConfNone:
		return domain.FlagHorsPlan
	case reel != 0 && ev.locked:
		return domain.FlagHorsPlan
	case reel == 0 && prevu > 0 && ev.personReel == 0:
		return domain.FlagAbsence
	case ecart > r.s.SeuilSurImputationH:
		return domain.FlagSurImputation
	case ecart < -r.s.SeuilSousImputationH:
		return domain.FlagSousImputation
	default:
		return domain.FlagConforme
	}
}

// erreursCT détecte les erreurs de CT (SPEC_analyse §6.2, DECISIONS n° 14) :
// même personne × semaine non verrouillée, des heures imputées sur des CT non
// planifiés (prévu = 0, excédent = réel) compensent le manque des CT planifiés
// (manque = prévu − réel). T = min(Σ excédents, Σ manques) est réparti au
// prorata de chaque côté ; si l'écart ajusté rend conforme au moins un tuple
// en sur/sous, les tuples devenus conformes passent en erreur_ct et les autres
// prennent le flag du résidu. Côté planifié, si un CT est en sous-imputation,
// seuls les CT en sous-imputation passent en erreur_ct (un CT déjà conforme qui
// reçoit une part du transfert reste conforme, avec la note). Réaffecte / CTsLies sont renseignés dès que T > 0.
// rows et evals sont parallèles, dans l'ordre (CT, ressource, semaine).
func (r *run) erreursCT(rows []domain.EcartRow, evals []flagEval) {
	type part struct {
		i int
		h float64 // excédent ou manque
	}
	type group struct{ exces, manques []part }
	groups := map[[2]string]*group{}
	var keys [][2]string
	for i, ev := range evals {
		row := &rows[i]
		if !strings.HasPrefix(ev.tk.Key, "N:") || ev.locked || (ev.t.hasReal && ev.t.conf != domain.ConfNom) {
			continue
		}
		exces := row.Prevu == 0 && row.Reel > 0
		manque := row.Prevu > 0 && row.Reel < row.Prevu
		if !exces && !manque {
			continue
		}
		gk := [2]string{ev.tk.Key, ev.tk.Week}
		g := groups[gk]
		if g == nil {
			g = &group{}
			groups[gk] = g
			keys = append(keys, gk)
		}
		if exces {
			g.exces = append(g.exces, part{i, row.Reel})
		} else {
			g.manques = append(g.manques, part{i, row.Prevu - row.Reel})
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i][0] != keys[j][0] {
			return keys[i][0] < keys[j][0]
		}
		return keys[i][1] < keys[j][1]
	})

	sum := func(ps []part) float64 {
		s := 0.0
		for _, p := range ps {
			s += p.h
		}
		return s
	}
	cts := func(ps []part) []string {
		out := make([]string, 0, len(ps))
		for _, p := range ps {
			out = append(out, rows[p.i].CT)
		}
		sort.Strings(out)
		return out
	}
	for _, gk := range keys {
		g := groups[gk]
		se, sm := sum(g.exces), sum(g.manques)
		tot := math.Min(se, sm)
		if len(g.exces) == 0 || len(g.manques) == 0 || round2(tot) == 0 {
			continue
		}
		type adj struct {
			i     int
			flag  domain.Flag // flag de l'écart ajusté
			garde bool        // CT planifié conforme alors qu'un autre est en sous-imputation : il reste conforme
		}
		var adjs []adj
		resolves := false
		sous := false // un CT planifié est en sous-imputation : c'est lui que l'erreur explique
		for _, p := range g.manques {
			sous = sous || rows[p.i].Flag == domain.FlagSousImputation
		}
		apply := func(ps, autres []part, total, sign float64) {
			for _, p := range ps {
				row := &rows[p.i]
				t := tot * p.h / total
				row.Reaffecte = round2(t)
				row.CTsLies = cts(autres)
				f := r.flagOf(evals[p.i], row.Reel, row.Prevu, round2(row.Reel-row.Prevu+sign*t))
				if f == domain.FlagConforme && (row.Flag == domain.FlagSurImputation || row.Flag == domain.FlagSousImputation) {
					resolves = true
				}
				adjs = append(adjs, adj{p.i, f, sign > 0 && sous && row.Flag == domain.FlagConforme})
			}
		}
		apply(g.exces, g.manques, se, -1) // excédent : réel − t
		apply(g.manques, g.exces, sm, +1) // manque : réel − prévu + t
		if !resolves {
			continue
		}
		for _, a := range adjs {
			switch {
			case a.garde:
			case a.flag == domain.FlagConforme:
				rows[a.i].Flag = domain.FlagErreurCT
			default:
				rows[a.i].Flag = a.flag
			}
		}
	}
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
