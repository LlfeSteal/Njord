package analyse

import (
	"math"
	"strings"
	"testing"
	"time"

	"njord/internal/domain"
	"njord/internal/names"
	"njord/internal/store"
)

// ---------------------------------------------------------------- builders

func sp(s string) *string { return &s }

// personne: a référentiel record whose key is names.KeyOf(nom) (as the import does).
func personne(id, nom string) domain.Personne {
	return domain.Personne{ID: id, DisplayName: nom, NomNormalise: names.KeyOf(nom), Statut: "brouillon"}
}

// libelleNomPrenom mimics the plan import: « NOM Prénom » of the libellé, "" if non nominative.
func libelleNomPrenom(libelle string) string {
	person, _ := names.SplitLibelle(libelle, nil)
	if np, st := names.ParseNomPrenom(person); st == names.NomPrenomOK {
		return np.String()
	}
	return ""
}

// realiseNomPrenom mimics the réalisé import: « NOM Prénom » without civilité, "" if unreadable.
func realiseNomPrenom(nom string) string {
	if np, ok := names.ParseRealise(nom); ok {
		return np.String()
	}
	return ""
}

var rowSeq int

// planLine: a plan line on a single week by default (W37 = 07 → 11/09/2026, 5 j ouvrés).
// res is the raw Ressource code (no identity role); NomPrenom is extracted from the libellé.
func planLine(ct, res, libelle string, pid *string, charge float64) domain.PlanLine {
	rowSeq++
	return domain.PlanLine{RowNum: rowSeq, CT: ct, Ressource: res, Libelle: libelle, NomPrenom: libelleNomPrenom(libelle),
		PersonneID: pid, ChargeTotale: charge,
		LigneCout: "MAIN D'OEUVRE SUR SITE", DateDebut: "2026-09-07", DateFin: "2026-09-11", StatutParsing: domain.ParsingOK}
}

// mo: an hour-based MO entry.
func mo(ct, nom string, h float64, date string) domain.RealiseEntry {
	rowSeq++
	return domain.RealiseEntry{RowNum: rowSeq, TG: ct, TGLibelle: ct + " - Libellé " + ct, Categorie: "MAIN D'OEUVRE",
		Type: "MAIN D'OEUVRE SUR SITE", EmployeFournisseur: nom, NomPrenom: realiseNomPrenom(nom), Quantite: h, TotalEur: h * 100, DateDepense: date,
		PeriodeComptable: date, StatutParsing: domain.ParsingOK}
}

// cost: a non-MO entry.
func cost(ct, typ, cat string, eur float64) domain.RealiseEntry {
	rowSeq++
	return domain.RealiseEntry{RowNum: rowSeq, TG: ct, Categorie: cat, Type: typ, Quantite: 1, TotalEur: eur,
		DateDepense: "2026-09-08", PeriodeComptable: "2026-09-30", StatutParsing: domain.ParsingOK}
}

func baseInput() Input {
	return Input{
		PlanRef: domain.Version{ID: "plan1", Kind: domain.KindPlan, Statut: domain.StatutActive},
		Realise: domain.Version{ID: "real1", Kind: domain.KindRealise, Statut: domain.StatutActive},
		Now:     time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC),
	}
}

// coverLine: a non-MO plan line without charge nor PPS that only extends the
// timeline coverage (SPEC_analyse §4.3) to [debut, fin].
func coverLine(ct, debut, fin string) domain.PlanLine {
	l := planLine(ct, "", "Frais divers", nil, 0)
	l.LigneCout, l.DateDebut, l.DateFin = "FRAIS DE MISSION", debut, fin
	return l
}

// onePlan sets a timeline made of the single version in.PlanRef.
func onePlan(in *Input, lines ...domain.PlanLine) {
	in.Plans = []PlanSource{{Version: in.PlanRef, Lines: lines}}
}

func findRow(t *testing.T, res domain.AnalyseResult, ct, ressource, week string) domain.EcartRow {
	t.Helper()
	for _, r := range res.Ecarts {
		if r.CT == ct && r.Ressource == ressource && r.Semaine == week {
			return r
		}
	}
	t.Fatalf("tuple (%s, %s, %s) introuvable dans %d lignes", ct, ressource, week, len(res.Ecarts))
	return domain.EcartRow{}
}

func findQual(res domain.AnalyseResult, code string) *domain.QualiteWarning {
	for i := range res.Qualite {
		if res.Qualite[i].Code == code {
			return &res.Qualite[i]
		}
	}
	return nil
}

// ---------------------------------------------------------------- scénario de flags

func flagsScenario() Input {
	in := baseInput()
	in.Personnes = []domain.Personne{
		personne("p1", "DURAND Claire"),
		personne("p2", "Antoine De La Tour"),
		personne("p3", "MARTIN Théo"),
		personne("p4", "Sarah Blanc"),
	}
	onePlan(&in,
		planLine("CTA", "DURANDC", "DURAND Claire / Squad Alpha", sp("p1"), 10),
		planLine("CTB", "MARTINT", "MARTIN Théo / Squad Alpha", sp("p3"), 40),
		planLine("CTC", "DELATOURA", "Antoine De La Tour", sp("p2"), 20),
		planLine("CTA", "BLANCS", "Sarah Blanc", sp("p4"), 20),
		planLine("CTD", "MARTINT", "MARTIN Théo", sp("p3"), 20),
		coverLine("CTA", "2026-09-07", "2026-12-31"),
	)
	in.Entries = []domain.RealiseEntry{
		mo("CTA", "DURAND Claire Mme", 26, "2026-09-08"),        // +16 → 🔴
		mo("CTB", "MARTIN Théo M.", 9, "2026-09-09"),            // −31 → 🟣
		mo("CTC", "DE LA TOUR Antoine Mr.", 25, "2026-09-10"),   // +5 → 🟢 (même NOM Prénom, ordre inversé au plan)
		mo("CTE", "BARBIER Luc M.", 13, "2026-09-10"),           // non apparié → 🟠
		mo("CTA", "DURAND Claire Mme", 8, "2026-12-15"),         // S51 verrouillée → 🟠
		cost("CTA", "FRAIS DE MISSION", "FRAIS DE MISSION", 50), // pas d'heures
	}
	in.WeekFrom, in.WeekTo = "2026-W37", "2026-W51"
	return in
}

func TestFlags(t *testing.T) {
	res := Run(flagsScenario(), store.DefaultSettings())
	cases := []struct {
		name, ct, res, week string
		flag                domain.Flag
		prevu, reel, ecart  float64
		conf                domain.Confidence
	}{
		{"🔴 sur-imputation +16", "CTA", "DURAND Claire", "2026-W37", domain.FlagSurImputation, 10, 26, 16, domain.ConfNom},
		{"🟣 sous-imputation −31", "CTB", "MARTIN Théo", "2026-W37", domain.FlagSousImputation, 40, 9, -31, domain.ConfNom},
		{"🟢 conforme", "CTC", "DE LA TOUR Antoine", "2026-W37", domain.FlagConforme, 20, 25, 5, domain.ConfNom},
		{"⚫ absence (aucun réel)", "CTA", "BLANC Sarah", "2026-W37", domain.FlagAbsence, 20, 0, -20, domain.ConfPlan},
		{"non-⚫ si réel ailleurs", "CTD", "MARTIN Théo", "2026-W37", domain.FlagConforme, 20, 0, -20, domain.ConfPlan},
		{"🟠 non apparié", "CTE", "BARBIER Luc", "2026-W37", domain.FlagHorsPlan, 0, 13, 13, domain.ConfNone},
		{"🟠 semaine verrouillée", "CTA", "DURAND Claire", "2026-W51", domain.FlagHorsPlan, 0, 8, 8, domain.ConfNom},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := findRow(t, res, c.ct, c.res, c.week)
			if r.Flag != c.flag || r.Prevu != c.prevu || r.Reel != c.reel || r.Ecart != c.ecart || r.Confidence != c.conf {
				t.Errorf("got flag=%s prevu=%v reel=%v ecart=%v conf=%s", r.Flag, r.Prevu, r.Reel, r.Ecart, r.Confidence)
			}
		})
	}
	if len(res.Ecarts) != len(cases) {
		t.Errorf("nb tuples = %d, attendu %d", len(res.Ecarts), len(cases))
	}
	// Libellés & CT.
	r := findRow(t, res, "CTC", "DE LA TOUR Antoine", "2026-W37")
	if r.RessourceLabel != "Antoine De La Tour" || r.PersonneID == nil || *r.PersonneID != "p2" || r.CTLibelle != "Libellé CTC" {
		t.Errorf("row enrichie incorrecte: %+v", r)
	}
	if hp := findRow(t, res, "CTE", "BARBIER Luc", "2026-W37"); hp.PersonneID != nil || hp.RessourceLabel != "BARBIER Luc" {
		t.Error("hors plan sans personne attendu")
	}
	// Tri : gravité desc puis |écart| desc.
	if res.Ecarts[0].Flag != domain.FlagAbsence || res.Ecarts[1].Flag != domain.FlagHorsPlan || res.Ecarts[1].Reel != 13 {
		t.Errorf("tri incorrect: %s/%v, %s/%v", res.Ecarts[0].Flag, res.Ecarts[0].Ecart, res.Ecarts[1].Flag, res.Ecarts[1].Ecart)
	}
	for i := 1; i < len(res.Ecarts); i++ {
		a, b := res.Ecarts[i-1], res.Ecarts[i]
		if domain.FlagSeverity[a.Flag] < domain.FlagSeverity[b.Flag] ||
			(a.Flag == b.Flag && math.Abs(a.Ecart) < math.Abs(b.Ecart)) {
			t.Errorf("tri cassé en %d", i)
		}
	}
}

func TestPointsEtTaux(t *testing.T) {
	k := Run(flagsScenario(), store.DefaultSettings()).KPIs
	if k.NbSurImputation != 1 || k.NbSousImputation != 1 || k.NbAbsence != 1 || k.NbHorsPlan != 2 || k.NbConformes != 2 {
		t.Fatalf("comptes: %+v", k)
	}
	if k.PointsSurImputation != 2 || k.PointsSousImputation != 1 || k.PointsAbsence != 2 {
		t.Errorf("points: %+v", k)
	}
	// 13 + 8 = 21 h hors plan → floor(21/12) = 1
	if k.HeuresHorsPlan != 21 || k.PointsHorsPlan != 1 || k.PointsTotal != 6 {
		t.Errorf("hors plan: %v h, %d pts, total %d", k.HeuresHorsPlan, k.PointsHorsPlan, k.PointsTotal)
	}
	// conformité : 2 🟢 / 5 tuples comparés (🟠 exclus)
	if k.NbTuplesCompares != 5 || k.TauxConformite == nil || math.Abs(*k.TauxConformite-0.4) > 1e-9 {
		t.Errorf("taux conformité: %d %v", k.NbTuplesCompares, k.TauxConformite)
	}
	// absence : 1 personne (Blanc) sur 4 planifiées
	if k.NbPersonnesPlanifiees != 4 || k.NbPersonnesAbsentes != 1 || k.TauxAbsence == nil || *k.TauxAbsence != 0.25 {
		t.Errorf("taux absence: %d/%d", k.NbPersonnesAbsentes, k.NbPersonnesPlanifiees)
	}
	if k.TotalPrevuH != 110 || k.TotalReelH != 81 {
		t.Errorf("totaux %v / %v", k.TotalPrevuH, k.TotalReelH)
	}
}

func TestSeuilsParametrables(t *testing.T) {
	s := store.DefaultSettings()
	s.SeuilSurImputationH = 20
	s.SeuilSousImputationH = 35
	s.DiviseurHorsPlanH = 7
	res := Run(flagsScenario(), s)
	if f := findRow(t, res, "CTA", "DURAND Claire", "2026-W37").Flag; f != domain.FlagConforme {
		t.Errorf("+16 avec seuil 20 → conforme, got %s", f)
	}
	if f := findRow(t, res, "CTB", "MARTIN Théo", "2026-W37").Flag; f != domain.FlagConforme {
		t.Errorf("−31 avec seuil 35 → conforme, got %s", f)
	}
	if res.KPIs.PointsHorsPlan != 3 {
		t.Errorf("21/7 = 3 points, got %d", res.KPIs.PointsHorsPlan)
	}
}

func TestInactifsTauxConformite(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire"), personne("p9", "OLD Ancien")}
	l := planLine("CTA", "OLDA", "OLD Ancien", sp("p9"), 40)
	l.Inactive = true
	onePlan(&in, planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 10), l)
	in.Entries = []domain.RealiseEntry{
		mo("CTA", "DURAND Claire", 10, "2026-09-08"),
		mo("CTA", "OLD Ancien", 1, "2026-09-08"), // −39 → 🟣 inactif
	}
	for _, c := range []struct {
		include bool
		nb      int
		taux    float64
	}{{false, 1, 1}, {true, 2, 0.5}} {
		in.IncludeInactive = c.include
		res := Run(in, store.DefaultSettings())
		row := findRow(t, res, "CTA", "OLD Ancien", "2026-W37")
		if !row.Inactive || row.Flag != domain.FlagSousImputation {
			t.Errorf("ligne inactive conservée avec flag: %+v", row)
		}
		k := res.KPIs
		if k.NbTuplesCompares != c.nb || *k.TauxConformite != c.taux || res.Meta.IncludeInactive != c.include {
			t.Errorf("include=%v: %d comparés, taux %v", c.include, k.NbTuplesCompares, *k.TauxConformite)
		}
	}
}

// ---------------------------------------------------------------- correspondance

func TestMatchingNomPrenom(t *testing.T) {
	ps := []domain.Personne{
		personne("p1", "DURAND Claire"),
		personne("p7", "GIRARD Paul"), // fiche existante, non planifiée
	}
	lines := []domain.PlanLine{
		planLine("CT1", "DURANDC", "DURAND Claire / Squad Alpha", sp("p1"), 10),
		planLine("CT1", "DELATOURA", "Antoine De La Tour", nil, 10),
		planLine("CT1", "ROUXM", "ROUX Marc (support)", nil, 10),
		planLine("CT1", "2GI_BETA", "Squad Beta", nil, 10), // non nominative
	}
	m := newMatcher(ps, lines)
	if !m.planned["L:Squad Beta"] || !m.planned["N:DURAND|CLAIRE"] || !m.planned["N:DE LA TOUR|ANTOINE"] {
		t.Fatalf("clés du plan : %v", m.planned)
	}
	cases := []struct {
		name, nom, key string
		conf           domain.Confidence
		pid            string
	}{
		{"NOM Prénom + civilité", "DURAND Claire Mme", "N:DURAND|CLAIRE", domain.ConfNom, "p1"},
		{"tout en majuscules", "DURAND CLAIRE Mme", "N:DURAND|CLAIRE", domain.ConfNom, "p1"},
		{"ordre inversé → hors plan", "CLAIRE DURAND Mme", "N:CLAIRE|DURAND", domain.ConfNone, ""},
		{"nom composé (plan « Prénom NOM »)", "DE LA TOUR Antoine Mr.", "N:DE LA TOUR|ANTOINE", domain.ConfNom, ""},
		{"libellé avec note", "ROUX Marc M.", "N:ROUX|MARC", domain.ConfNom, ""},
		{"fiche existante non planifiée", "GIRARD Paul M.", "N:GIRARD|PAUL", domain.ConfNone, "p7"},
		{"inconnu", "BARBIER Luc M.", "N:BARBIER|LUC", domain.ConfNone, ""},
		{"ligne non nominative jamais rapprochée", "Squad Beta", "N:BETA|SQUAD", domain.ConfNone, ""},
		{"nom illisible", "SKYFARE", "U:SKYFARE", domain.ConfNone, ""},
		{"sans nom", "", "X:", domain.ConfNone, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id := m.resolve(realiseNomPrenom(c.nom), c.nom)
			if id.Key != c.key || id.Confidence != c.conf || id.matched() != (c.conf == domain.ConfNom) {
				t.Errorf("got %s/%s, attendu %s/%s", id.Key, id.Confidence, c.key, c.conf)
			}
			got := ""
			if id.PersonneID != nil {
				got = *id.PersonneID
			}
			if got != c.pid {
				t.Errorf("personne %q, attendu %q", got, c.pid)
			}
		})
	}
}

func TestPlanNonNominatif(t *testing.T) {
	in := baseInput()
	beta := planLine("CTA", "2GI_BETA", "Squad Beta", nil, 10)
	vide := planLine("CTA", "", "", nil, 5)
	onePlan(&in, beta, vide, planLine("CTA", "DURANDC", "DURAND Claire", nil, 10))
	in.Entries = []domain.RealiseEntry{
		mo("CTA", "Squad Beta", 10, "2026-09-08"), // même texte que le libellé : jamais rapproché
		mo("CTA", "DURAND Claire Mme", 10, "2026-09-08"),
	}
	res := Run(in, store.DefaultSettings())
	if r := findRow(t, res, "CTA", "Squad Beta", "2026-W37"); r.Confidence != domain.ConfPlan || r.Flag != domain.FlagAbsence || r.PersonneID != nil || r.Reel != 0 {
		t.Errorf("ligne non nominative : %+v", r)
	}
	if r := findRow(t, res, "CTA", noLibelle, "2026-W37"); r.Prevu != 5 || r.Confidence != domain.ConfPlan {
		t.Errorf("ligne sans libellé : %+v", r)
	}
	if r := findRow(t, res, "CTA", "BETA Squad", "2026-W37"); r.Flag != domain.FlagHorsPlan || r.Confidence != domain.ConfNone || r.Reel != 10 {
		t.Errorf("réalisé « Squad Beta » : %+v", r)
	}
	if r := findRow(t, res, "CTA", "DURAND Claire", "2026-W37"); r.Confidence != domain.ConfNom || r.Flag != domain.FlagConforme {
		t.Errorf("DURAND : %+v", r)
	}
	if len(res.Ecarts) != 4 {
		t.Errorf("%d tuples, attendu 4", len(res.Ecarts))
	}
	// Seule DURAND Claire est une personne : les lignes non nominatives (absentes) ne comptent pas.
	if k := res.KPIs; k.NbPersonnesPlanifiees != 1 || k.NbPersonnesAbsentes != 0 {
		t.Errorf("personnes : %d absentes / %d planifiées, attendu 0/1", k.NbPersonnesAbsentes, k.NbPersonnesPlanifiees)
	}
}

func TestCorrespondances(t *testing.T) {
	in := flagsScenario()
	in.Entries = append(in.Entries, mo("CTA", "CLAIRE DURAND Mme", 3, "2026-09-08")) // ordre inversé → hors plan
	res := Run(in, store.DefaultSettings())
	byName := map[string]domain.Correspondance{}
	for _, c := range res.Correspondances {
		byName[c.NomRealise] = c
	}
	c := byName["DE LA TOUR Antoine Mr."]
	if c.Confidence != domain.ConfNom || c.PersonneID == nil || *c.PersonneID != "p2" || c.NomPrenom != "DE LA TOUR Antoine" ||
		c.PersonneNom != "Antoine De La Tour" || c.NbEcritures != 1 || c.Heures != 25 {
		t.Errorf("correspondance nom : %+v", c)
	}
	if b := byName["BARBIER Luc M."]; b.Confidence != domain.ConfNone || b.PersonneID != nil || b.NomPrenom != "BARBIER Luc" || b.Heures != 13 {
		t.Errorf("correspondance none : %+v", b)
	}
	if d := byName["DURAND Claire Mme"]; d.NbEcritures != 2 || d.Heures != 34 || d.Confidence != domain.ConfNom {
		t.Errorf("DURAND agrégé : %+v", d)
	}
	if x := byName["CLAIRE DURAND Mme"]; x.Confidence != domain.ConfNone || x.NomPrenom != "CLAIRE Durand" || x.PersonneID != nil {
		t.Errorf("ordre inversé : %+v", x)
	}
	if r := findRow(t, res, "CTA", "CLAIRE Durand", "2026-W37"); r.Flag != domain.FlagHorsPlan {
		t.Errorf("ordre inversé : %+v", r)
	}
	if len(res.Correspondances) != 5 || res.Correspondances[0].Confidence != domain.ConfNone || res.Correspondances[1].Confidence != domain.ConfNone ||
		res.Correspondances[2].Confidence != domain.ConfNom {
		t.Errorf("correspondances : %+v", res.Correspondances)
	}
}

// ---------------------------------------------------------------- enrichissement / budget

func TestHeuresMO(t *testing.T) {
	en := NewEnricher(store.DefaultSettings())
	cases := []struct {
		name, typ, cat string
		qte, eur       float64
		mo             bool
		heures, e      float64
		class          domain.Classification
	}{
		{"MO sur site", "MAIN D'OEUVRE SUR SITE", "MAIN D'OEUVRE", 7, 700, true, 7, 0, domain.ClassSecurise},
		{"capacité MO (casse/trim)", " capacite sur site ", "main d’oeuvre ", 3.5, 300, true, 3.5, 0, domain.ClassSecurise},
		{"capacité PRESTATION (démo)", "CAPACITE SUR SITE", "PRESTATION", 11000.89, 11000.89, false, 0, 11000.89, domain.ClassSecurise},
		{"frais de mission", "FRAIS DE MISSION", "FRAIS DE MISSION", 1, -301.66, false, 0, -301.66, domain.ClassSecurise},
		{"provision", "PROVISIONS POUR ALEAS", "AUTRES DEPENSES", 1, 5000, false, 0, 5000, domain.ClassNonSecurise},
		{"stockage (casse)", "STOCKAGE", "MATIERE", 1, 10, false, 0, 10, domain.ClassNonSecurise},
		{"non classé", "MATIERE", "MATIERE", 4, 40, false, 0, 40, domain.ClassNonClasse},
	}
	for _, c := range cases {
		e := domain.RealiseEntry{Type: c.typ, Categorie: c.cat, Quantite: c.qte, TotalEur: c.eur, DateDepense: "2026-09-08"}
		x := en.Enrich(&e)
		if x.MO != c.mo || x.Heures != c.heures || x.Eur != c.e || x.Classification != c.class || x.ISOWeek != "2026-W37" {
			t.Errorf("%s: %+v", c.name, x)
		}
	}
}

func TestBudgetAvoirsEtAlertes(t *testing.T) {
	in := baseInput()
	onePlan(&in, planLine("CTX", "R1", "Un Nom", nil, 10))
	in.Plans[0].Lines[0].PPS = 9000
	in.Entries = []domain.RealiseEntry{
		cost("CTX", "FRAIS DE MISSION", "FRAIS DE MISSION", 1000),
		cost("CTX", "FRAIS DE MISSION", "FRAIS DE MISSION", -300), // avoir
		cost("CTX", "PROVISIONS POUR ALEAS", "AUTRES DEPENSES", 500),
		cost("CTX", "MATIERE", "MATIERE", 200),
		mo("CTX", "Un Nom", 10, "2026-09-08"), // eur 0 dans le budget, coût MO informatif
		cost("CTY", "Stockage", "MATIERE", 12000),
		cost("CTY", "CAPACITE SUR SITE", "PRESTATION", 3000),
	}
	res := Run(in, store.DefaultSettings())
	b := map[string]domain.BudgetCT{}
	for _, x := range res.Budget.ParCT {
		b[x.CT] = x
	}
	x := b["CTX"]
	if x.Securise != 700 || x.NonSecurise != 500 || x.NonClasse != 200 || x.PPSPlan != 9000 || x.HeuresMO != 10 || x.CoutMOEur != 1000 || x.Risque {
		t.Errorf("CTX: %+v", x)
	}
	if x.PctSecurite == nil || *x.PctSecurite != 58.33 {
		t.Errorf("CTX %% sécurité = %v", x.PctSecurite)
	}
	y := b["CTY"]
	if y.NonSecurise != 12000 || !y.Risque || *y.PctSecurite != 20 {
		t.Errorf("CTY: %+v", y)
	}
	g := res.Budget.Global
	// sécurisé 3700, non sécurisé 12500 → 22.84 % / 77.16 %
	if g.Securise != 3700 || g.NonSecurise != 12500 || g.NonClasse != 200 || *g.PctSecurite != 22.84 || *g.PctNonSecurise != 77.16 {
		t.Errorf("global: %+v %v %v", g, *g.PctSecurite, *g.PctNonSecurise)
	}
	if !res.Alertes.AlerteGlobale || len(res.Alertes.CTRisque) != 1 || res.Alertes.CTRisque[0].CT != "CTY" || res.KPIs.NbCTRisque != 1 {
		t.Errorf("alertes: %+v", res.Alertes)
	}
	if *res.KPIs.PctSecurise != 22.84 {
		t.Errorf("kpi pct sécurisé %v", *res.KPIs.PctSecurise)
	}

	// Seuils relevés → plus d'alerte.
	s := store.DefaultSettings()
	s.SeuilCTRisqueEur, s.SeuilNonSecurisePct = 20000, 80
	res = Run(in, s)
	if res.Alertes.AlerteGlobale || len(res.Alertes.CTRisque) != 0 {
		t.Errorf("alertes avec seuils relevés: %+v", res.Alertes)
	}
}

func TestDeriveProvision(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire")}
	prov := planLine("CTP", "2GI_X", "", nil, 200)
	prov.LigneCout = "PROVISIONS POUR ALEAS"
	onePlan(&in, prov, planLine("CTP", "DURANDC", "DURAND Claire", sp("p1"), 10))
	in.Entries = []domain.RealiseEntry{
		mo("CTP", "BARBIER Luc M.", 12, "2026-09-08"),                // non rattachée sur CT provision → dérive
		mo("CTP", "DURAND Claire Mme", 10, "2026-09-08"),             // rattachée → pas de dérive
		mo("CTQ", "MEUNIER Paul M.", 5, "2026-09-08"),                // non rattachée, CT sans provision → non
		cost("CTZ", "PROVISIONS POUR ALEAS", "AUTRES DEPENSES", 800), // TYPE provision → dérive
		cost("CTP", "MATIERE", "MATIERE", 50),                        // coût ordinaire → non
	}
	res := Run(in, store.DefaultSettings())
	d := res.Alertes.DeriveProvision
	if len(d) != 2 {
		t.Fatalf("dérives: %+v", d)
	}
	if d[0].CT != "CTP" || d[0].EmployeFournisseur != "BARBIER Luc M." || d[0].Heures != 12 || d[0].Eur != 1200 {
		t.Errorf("dérive MO: %+v", d[0])
	}
	if d[1].CT != "CTZ" || d[1].Type != "PROVISIONS POUR ALEAS" || d[1].Eur != 800 {
		t.Errorf("dérive TYPE: %+v", d[1])
	}
}

// ---------------------------------------------------------------- qualité, période, cas §9

func TestQualite(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire"), personne("p2", "MARTIN Théo")}
	l := planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 100)
	l.PPS = 200000
	lw := planLine("CTA", "MARTINT", "MARTIN Théo", sp("p2"), 10)
	lw.StatutParsing, lw.MotifRejet = domain.ParsingWarn, "ressource inconnue"
	locked := planLine("CTA", "MARTINT", "MARTIN Théo", sp("p2"), 30)
	locked.DateDebut, locked.DateFin = "2026-12-14", "2026-12-27"
	onePlan(&in, l, lw, locked)
	late := mo("CTA", "DURAND Claire", 120, "2026-09-08")
	late.PeriodeComptable = "2026-08-31" // < dépense − 7 j
	sansNom := mo("CTA", "", 4, "2026-09-09")
	illisible := mo("CTA", "PRESTATAIRE", 2, "2026-09-09")
	sansTG := cost("", "MATIERE", "MATIERE", 10)
	rw := mo("CTA", "DURAND Claire", 100, "2026-09-09")
	rw.StatutParsing = domain.ParsingWarn
	in.Entries = []domain.RealiseEntry{late, rw, sansNom, illisible, sansTG, mo("CTA", "MARTIN Théo", 1, "2026-09-10")}
	res := Run(in, store.DefaultSettings())

	want := map[string]struct{ regle, count int }{
		"tg_ecart_budget":     {1, 1}, // réalisé 22 500 € vs PPS 200 000 €
		"mo_quantite_semaine": {2, 1}, // DURAND 220 h en W37
		"sans_tg":             {4, 1},
		"cloture":             {5, 1},
		"plan_repartition":    {0, 1},
		"mo_sans_nom":         {0, 2}, // sans nom + nom illisible
		"plan_warn":           {0, 1},
		"realise_warn":        {0, 1},
	}
	for code, w := range want {
		q := findQual(res, code)
		if q == nil {
			t.Errorf("%s absent", code)
			continue
		}
		if q.Regle != w.regle || q.Count != w.count || q.Message == "" || len(q.Details) > maxDetails {
			t.Errorf("%s: %+v", code, *q)
		}
	}
	if len(res.Qualite) != len(want) {
		t.Errorf("qualité: %d warnings", len(res.Qualite))
	}
	// MO sans nom → 🟠 + warn ; la ligne warn du plan est signalée.
	if r := findRow(t, res, "CTA", noName, "2026-W37"); r.Flag != domain.FlagHorsPlan || r.Confidence != domain.ConfNone {
		t.Errorf("sans nom: %+v", r)
	}
	if r := findRow(t, res, "CTA", "PRESTATAIRE", "2026-W37"); r.Flag != domain.FlagHorsPlan || r.Reel != 2 {
		t.Errorf("nom illisible: %+v", r)
	}
	if r := findRow(t, res, "CTA", "MARTIN Théo", "2026-W37"); !r.Warn {
		t.Error("tuple issu d'une ligne warn non signalé")
	}
	if r := findRow(t, res, "CTA", "DURAND Claire", "2026-W37"); !r.Warn {
		t.Error("tuple issu d'une écriture warn non signalé")
	}
}

func TestPeriodeParDefautEtFiltre(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire")}
	l := planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 219)
	l.DateDebut, l.DateFin = "2026-09-01", "2026-11-30"
	onePlan(&in, l)
	in.Entries = []domain.RealiseEntry{
		mo("CTA", "DURAND Claire", 7, "2026-08-27"), // W35 : hors période par défaut
		mo("CTA", "DURAND Claire", 7, "2026-10-03"), // W40
	}
	res := Run(in, store.DefaultSettings())
	if res.Meta.WeekFrom != "2026-W36" || res.Meta.WeekTo != "2026-W40" || len(res.Meta.Weeks) != 5 {
		t.Fatalf("période: %s → %s (%d)", res.Meta.WeekFrom, res.Meta.WeekTo, len(res.Meta.Weeks))
	}
	if len(res.Ecarts) != 5 {
		t.Errorf("5 semaines attendues, got %d", len(res.Ecarts))
	}
	for _, r := range res.Ecarts {
		if r.Semaine < "2026-W36" || r.Semaine > "2026-W40" {
			t.Errorf("semaine hors période: %s", r.Semaine)
		}
	}
	// Budget : toute la version (W35 incluse) ; heures : la période.
	if res.Budget.ParCT[0].HeuresMO != 14 || res.KPIs.TotalReelH != 7 {
		t.Errorf("budget %v h, kpi %v h", res.Budget.ParCT[0].HeuresMO, res.KPIs.TotalReelH)
	}
	// Période explicite.
	in.WeekFrom, in.WeekTo = "2026-W38", "2026-W38"
	res = Run(in, store.DefaultSettings())
	if len(res.Ecarts) != 1 || res.Ecarts[0].Prevu != round2(219*5.0/64) || res.Ecarts[0].Flag != domain.FlagAbsence {
		t.Errorf("W38 seule: %+v", res.Ecarts)
	}
}

func TestDeterminismeEtVersionArchivee(t *testing.T) {
	in := flagsScenario()
	in.PlanSuperseded = true
	a := Run(in, store.DefaultSettings())
	b := Run(in, store.DefaultSettings())
	if !a.Meta.ArchivedWarning || !a.Meta.GeneratedAt.Equal(in.Now) {
		t.Error("meta archivée / horodatage")
	}
	for i := range a.Ecarts {
		if a.Ecarts[i].Flag != b.Ecarts[i].Flag || a.Ecarts[i].Ecart != b.Ecarts[i].Ecart || a.Ecarts[i].Ressource != b.Ecarts[i].Ressource || a.Ecarts[i].CT != b.Ecarts[i].CT || a.Ecarts[i].Semaine != b.Ecarts[i].Semaine {
			t.Fatalf("ordre non déterministe en %d", i)
		}
	}
}

func TestEntreesVides(t *testing.T) {
	res := Run(baseInput(), store.DefaultSettings())
	if res.Ecarts == nil || res.Qualite == nil || res.Correspondances == nil || res.Budget.ParCT == nil ||
		res.Alertes.CTRisque == nil || res.Alertes.DeriveProvision == nil || res.Meta.Weeks == nil {
		t.Error("les listes doivent être non nulles (JSON [])")
	}
	if res.KPIs.TauxConformite != nil || res.KPIs.TauxAbsence != nil || res.KPIs.PctSecurise != nil {
		t.Error("taux nuls attendus")
	}
}

// ---------------------------------------------------------------- arbitrages intégrateur

func TestNonMOPlanLinesAndNegativeHours(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire")}
	moLine := planLine("CT1", "DURANDC", "DURAND Claire", sp("p1"), 30)
	frais := planLine("CT2", "DURANDC", "DURAND Claire", sp("p1"), 40)
	frais.LigneCout = "FRAIS DE MISSION"
	onePlan(&in, moLine, frais)
	in.Entries = []domain.RealiseEntry{
		mo("CT1", "DURAND Claire Mme", 35, "2026-09-08"),
		mo("CT1", "DURAND Claire Mme", -5, "2026-09-09"), // contre-passation
	}
	res := Run(in, store.DefaultSettings())
	r := findRow(t, res, "CT1", "DURAND Claire", "2026-W37")
	if math.Abs(r.Reel-30) > 0.01 || r.Flag != domain.FlagConforme {
		t.Errorf("réel %v flag %s, want 30 h conforme (contre-passation déduite)", r.Reel, r.Flag)
	}
	for _, e := range res.Ecarts {
		if e.CT == "CT2" {
			t.Errorf("ligne de plan non-MO comparée aux heures : %+v", e)
		}
	}
}

func TestBudgetParNature(t *testing.T) {
	in := baseInput()
	line := func(ct, ligneCout string, pps float64) domain.PlanLine {
		l := planLine(ct, "", "DURAND Claire", nil, 10)
		l.LigneCout, l.PPS = ligneCout, pps
		return l
	}
	onePlan(&in,
		line("CTP", "MAIN D'OEUVRE SUR SITE", 1000), // CT de provision : tout y est provision
		line("CTA", "PROVISIONS POUR ALEAS", 200),   // ligne de coût provision sur un autre CT
		line("CTA", "MAIN D'OEUVRE SUR SITE", 5000),
		line("CTA", "CAPACITE SUR SITE", 3000),
		line("CTA", "FRAIS ACHATS CAPACITE SUR SITE", 100),
		line("CTA", "FRAIS DE MISSION", 400),
		line("CTA", "Stockage", 50),
	)
	prov := mo("CTP", "DURAND Claire Mme", 5, "2026-09-08")
	prov.TGLibelle = "CTP - Provisions pour aléas"
	in.Entries = []domain.RealiseEntry{
		prov, // 500 €
		mo("CTA", "DURAND Claire Mme", 10, "2026-09-08"),            // 1000 €
		cost("CTA", "CAPACITE SUR SITE", "PRESTATION", 2000),        //
		cost("CTA", "FRAIS DE MISSION", "FRAIS DE MISSION", 300),    //
		cost("CTA", "FRAIS DE MISSION", "FRAIS DE MISSION", -100),   // avoir
		cost("CTA", "PROVISIONS POUR ALEAS", "AUTRES DEPENSES", 70), //
		cost("CTA", "AUTRES PRESTATIONS", "PRESTATION", 120),        //
		cost("", "FNP AUTOMATIQUES", "AUTRES DEPENSES", 30),         // sans TG : compté quand même
	}
	res := Run(in, store.DefaultSettings())
	want := []struct {
		nature       string
		pps, realise float64
	}{
		{"provision", 1200, 570}, {"mo", 5000, 1000}, {"capacite", 3100, 2000}, {"frais", 400, 200}, {"autres", 50, 150},
	}
	if len(res.Budget.ParNature) != len(want) {
		t.Fatalf("par nature : %+v", res.Budget.ParNature)
	}
	var pps, reel float64
	for i, w := range want {
		n := res.Budget.ParNature[i]
		if n.Nature != w.nature || n.PPS != w.pps || n.Realise != w.realise || n.Libelle == "" {
			t.Errorf("%s : %+v, attendu PPS %.0f réalisé %.0f", w.nature, n, w.pps, w.realise)
		}
		pps += n.PPS
		reel += n.Realise
	}
	if n := res.Budget.ParNature[4]; n.PctConsomme == nil || *n.PctConsomme != 300 {
		t.Errorf("autres : %% consommé %v", n.PctConsomme)
	}
	if pps != 9750 || reel != 3920 {
		t.Errorf("Σ PPS %.2f, Σ réalisé %.2f", pps, reel)
	}
}

// ---------------------------------------------------------------- erreur de CT (§6.2)

// ctH: heures d'une ressource sur un CT (prévues ou imputées).
type ctH struct {
	ct string
	h  float64
}

// erreurCTInput: DURAND Claire planifiée en W37 (prevus) et ses imputations
// de la semaine (reels).
func erreurCTInput(prevus, reels []ctH) Input {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire")}
	var lines []domain.PlanLine
	for _, p := range prevus {
		lines = append(lines, planLine(p.ct, "DURANDC", "DURAND Claire", sp("p1"), p.h))
	}
	onePlan(&in, lines...)
	for _, r := range reels {
		in.Entries = append(in.Entries, mo(r.ct, "DURAND Claire Mme", r.h, "2026-09-08"))
	}
	return in
}

func TestErreurCT(t *testing.T) {
	type want struct {
		ct        string
		flag      domain.Flag
		reaffecte float64
		lies      string // CTsLies joints par une espace
	}
	cases := []struct {
		name          string
		prevus, reels []ctH
		want          []want
	}{
		{"inversion complète", []ctH{{"CTA", 35}}, []ctH{{"CTB", 40}}, []want{
			{"CTA", domain.FlagErreurCT, 35, "CTB"},
			{"CTB", domain.FlagErreurCT, 35, "CTA"},
		}},
		{"partielle résolue (A −25 conforme)", []ctH{{"CTA", 35}}, []ctH{{"CTB", 10}}, []want{
			{"CTA", domain.FlagErreurCT, 10, "CTB"},
			{"CTB", domain.FlagErreurCT, 10, "CTA"},
		}},
		{"partielle non résolue (A reste −33)", []ctH{{"CTA", 35}}, []ctH{{"CTB", 2}}, []want{
			{"CTA", domain.FlagSousImputation, 2, "CTB"},
			{"CTB", domain.FlagConforme, 2, "CTA"},
		}},
		{"résidu sur B (+25)", []ctH{{"CTA", 35}}, []ctH{{"CTB", 60}}, []want{
			{"CTA", domain.FlagErreurCT, 35, "CTB"},
			{"CTB", domain.FlagSurImputation, 35, "CTA"},
		}},
		{"CT planifié partiellement imputé", []ctH{{"CTA", 35}}, []ctH{{"CTA", 10}, {"CTB", 25}}, []want{
			{"CTA", domain.FlagErreurCT, 25, "CTB"},
			{"CTB", domain.FlagErreurCT, 25, "CTA"},
		}},
		{"deux CT planifiés : inchangé", []ctH{{"CTA", 35}, {"CTC", 10}}, []ctH{{"CTC", 45}}, []want{
			{"CTA", domain.FlagSousImputation, 0, ""},
			{"CTC", domain.FlagSurImputation, 0, ""},
		}},
		{"deux CT imputés à tort : prorata", []ctH{{"CTA", 40}}, []ctH{{"CTB", 45}, {"CTC", 15}}, []want{
			{"CTA", domain.FlagErreurCT, 40, "CTB CTC"},
			{"CTB", domain.FlagErreurCT, 30, "CTA"}, // 40 × 45/60 → +15 conforme
			{"CTC", domain.FlagErreurCT, 10, "CTA"}, // 40 × 15/60 → +5
		}},
		{"deux CT planifiés en manque : prorata", []ctH{{"CTA", 35}, {"CTD", 10}}, []ctH{{"CTB", 30}}, []want{
			{"CTA", domain.FlagErreurCT, 23.33, "CTB"}, // 30 × 35/45
			{"CTD", domain.FlagConforme, 6.67, "CTB"},  // déjà conforme, CTA en sous-imputation : reste conforme
			{"CTB", domain.FlagErreurCT, 30, "CTA CTD"},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Run(erreurCTInput(c.prevus, c.reels), store.DefaultSettings())
			if len(res.Ecarts) != len(c.want) {
				t.Fatalf("%d tuples, attendu %d", len(res.Ecarts), len(c.want))
			}
			for _, w := range c.want {
				r := findRow(t, res, w.ct, "DURAND Claire", "2026-W37")
				if r.Flag != w.flag || r.Reaffecte != w.reaffecte || strings.Join(r.CTsLies, " ") != w.lies || r.CTsLies == nil {
					t.Errorf("%s : flag=%s reaffecte=%v lies=%v, attendu %s %v [%s]", w.ct, r.Flag, r.Reaffecte, r.CTsLies, w.flag, w.reaffecte, w.lies)
				}
				if r.Ecart != round2(r.Reel-r.Prevu) {
					t.Errorf("%s : écart brut modifié %+v", w.ct, r)
				}
			}
		})
	}
}

func TestErreurCTSemaineVerrouilleeEtHorsPlan(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire"), personne("p2", "MARTIN Théo")}
	// S51 verrouillée : aucune charge n'y est répartie, l'imputation y reste hors plan.
	onePlan(&in, planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 35),
		planLine("CTA", "MARTINT", "MARTIN Théo", sp("p2"), 35), coverLine("CTA", "2026-09-07", "2026-12-31"))
	in.Entries = []domain.RealiseEntry{
		mo("CTB", "DURAND Claire Mme", 40, "2026-12-15"),
		mo("CTB", "BARBIER Luc M.", 40, "2026-09-08"), // inconnu : jamais rapproché de MARTIN
		mo("CTC", "MARTIN Théo", 1, "2026-09-25"),     // MARTIN a du réel ailleurs (pas d'absence)
	}
	in.WeekFrom, in.WeekTo = "2026-W37", "2026-W51"
	res := Run(in, store.DefaultSettings())
	for _, c := range []struct {
		ct, res, week string
		flag          domain.Flag
	}{
		{"CTA", "DURAND Claire", "2026-W37", domain.FlagSousImputation},
		{"CTB", "DURAND Claire", "2026-W51", domain.FlagHorsPlan},
		{"CTA", "MARTIN Théo", "2026-W37", domain.FlagSousImputation},
		{"CTB", "BARBIER Luc", "2026-W37", domain.FlagHorsPlan},
	} {
		r := findRow(t, res, c.ct, c.res, c.week)
		if r.Flag != c.flag || r.Reaffecte != 0 || r.CTsLies == nil || len(r.CTsLies) != 0 {
			t.Errorf("%s %s %s : %+v, attendu %s sans réaffectation", c.ct, c.res, c.week, r, c.flag)
		}
	}
	if res.KPIs.NbErreurCT != 0 {
		t.Errorf("NbErreurCT = %d", res.KPIs.NbErreurCT)
	}
}

func TestErreurCTKPIs(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire"), personne("p2", "MARTIN Théo"), personne("p3", "BLANC Sarah")}
	onePlan(&in,
		planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 35),
		planLine("CTC", "MARTINT", "MARTIN Théo", sp("p2"), 35),
		planLine("CTE", "BLANCS", "BLANC Sarah", sp("p3"), 10),
	)
	in.Entries = []domain.RealiseEntry{
		mo("CTB", "DURAND Claire Mme", 40.5, "2026-09-08"), // inversion complète : 2 erreur_ct
		mo("CTD", "MARTIN Théo M.", 60, "2026-09-08"),      // CTC erreur_ct, CTD sur (+25)
		mo("CTE", "BLANC Sarah", 10, "2026-09-08"),         // conforme
	}
	res := Run(in, store.DefaultSettings())
	k := res.KPIs
	if k.NbErreurCT != 3 || k.PointsErreurCT != 1 || k.HeuresErreurCT != 40.5 {
		t.Errorf("erreur de CT : %d tuples, %d pts, %v h", k.NbErreurCT, k.PointsErreurCT, k.HeuresErreurCT)
	}
	if k.NbSurImputation != 1 || k.NbSousImputation != 0 || k.NbAbsence != 0 || k.NbConformes != 1 {
		t.Errorf("comptes : %+v", k)
	}
	if k.PointsTotal != 3 { // 2 (sur) + 1 (erreur de CT)
		t.Errorf("points total %d", k.PointsTotal)
	}
	// 5 tuples comparés (les erreur_ct en font partie), 1 conforme.
	if k.NbTuplesCompares != 5 || k.TauxConformite == nil || math.Abs(*k.TauxConformite-0.2) > 1e-9 {
		t.Errorf("taux conformité : %d %v", k.NbTuplesCompares, k.TauxConformite)
	}
	// Tri : erreur_ct entre hors plan et sur-imputation.
	if res.Ecarts[0].Flag != domain.FlagErreurCT || res.Ecarts[3].Flag != domain.FlagSurImputation {
		t.Errorf("tri : %s … %s", res.Ecarts[0].Flag, res.Ecarts[3].Flag)
	}
}

// TestErreurCTDemo : jeu test_data_demo/erreur_ct (README) — plan démo où PETIT
// Karim est planifié sur Y99F90005, GIRAUD Léa sur Y99F90007 et la ligne 20 % de
// MARTIN Théo sur Y99F90008, croisé avec le réalisé démo d'origine (ils imputent
// toujours Y99F90003, Y99F90009 et Y99F90007).
func TestErreurCTDemo(t *testing.T) {
	res := Run(demoInputWith(t, "../../../test_data_demo/erreur_ct/demo_plancharge_erreur_ct.xlsx",
		"../../../test_data_demo/demo_realise.xlsx"), store.DefaultSettings())
	for _, c := range []struct {
		ct, ressource, week string
		flag                domain.Flag
		reaffecte           float64
		lies                string
	}{
		// Erreur complète.
		{"Y99F90003", "PETIT Karim", "2026-W38", domain.FlagErreurCT, 22.5, "Y99F90005"},
		{"Y99F90005", "PETIT Karim", "2026-W38", domain.FlagErreurCT, 22.5, "Y99F90003"},
		{"Y99F90009", "GIRAUD Léa", "2026-W37", domain.FlagErreurCT, 22.5, "Y99F90007"},
		{"Y99F90007", "GIRAUD Léa", "2026-W37", domain.FlagErreurCT, 22.5, "Y99F90009"},
		// 15 h : sous les seuils des deux côtés, rien à expliquer.
		{"Y99F90003", "PETIT Karim", "2026-W39", domain.FlagConforme, 15, "Y99F90005"},
		{"Y99F90005", "PETIT Karim", "2026-W39", domain.FlagConforme, 15, "Y99F90003"},
		// Partiel côté imputé : 52,5 h dont 25,66 h réaffectées, le reste dépasse encore.
		{"Y99F90009", "GIRAUD Léa", "2026-W40", domain.FlagSurImputation, 25.66, "Y99F90007"},
		{"Y99F90007", "GIRAUD Léa", "2026-W40", domain.FlagConforme, 25.66, "Y99F90009"},
		// La sous-imputation de Y99F90001 est expliquée (S39) ou non (S38).
		{"Y99F90001", "MARTIN Théo", "2026-W39", domain.FlagErreurCT, 6.04, "Y99F90007"},
		{"Y99F90007", "MARTIN Théo", "2026-W39", domain.FlagErreurCT, 7.5, "Y99F90001 Y99F90008"},
		{"Y99F90008", "MARTIN Théo", "2026-W39", domain.FlagConforme, 1.46, "Y99F90007"},
		{"Y99F90001", "MARTIN Théo", "2026-W38", domain.FlagSousImputation, 3.02, "Y99F90007"},
		{"Y99F90007", "MARTIN Théo", "2026-W38", domain.FlagConforme, 3.75, "Y99F90001 Y99F90008"},
	} {
		r := findRow(t, res, c.ct, c.ressource, c.week)
		if r.Flag != c.flag || r.Reaffecte != c.reaffecte || strings.Join(r.CTsLies, " ") != c.lies {
			t.Errorf("%s %s %s : %s %v %v, attendu %s %v [%s]", c.ressource, c.ct, c.week, r.Flag, r.Reaffecte, r.CTsLies, c.flag, c.reaffecte, c.lies)
		}
	}
	if k := res.KPIs; k.NbErreurCT != 16 || k.PointsErreurCT != 8 || k.HeuresErreurCT != 160.25 {
		t.Errorf("KPI erreur de CT : %d tuples, %d points, %v h ; attendu 16, 8, 160.25", k.NbErreurCT, k.PointsErreurCT, k.HeuresErreurCT)
	}
	want := map[string]string{
		"ecart|Y99F90003|PETIT Karim|erreur_ct":       "4 semaines, 83,28 h imputées sur Y99F90003 au lieu de Y99F90005 (prévu 97,51 h)",
		"ecart|Y99F90009|GIRAUD Léa|erreur_ct":        "3 semaines, 65,53 h imputées sur Y99F90009 au lieu de Y99F90007 (prévu 71,85 h)",
		"ecart|Y99F90009|GIRAUD Léa|sur_imputation":   "1 semaine, écart cumulé +26,84 h (prévu 0 h, réel 52,5 h), dont 25,66 h imputées au lieu de Y99F90007",
		"ecart|Y99F90007|MARTIN Théo|erreur_ct":       "1 semaine, 7,5 h imputées sur Y99F90007 au lieu de Y99F90001 (prévu 42,77 h)",
		"ecart|Y99F90001|MARTIN Théo|sous_imputation": "1 semaine, écart cumulé -32,25 h (prévu 42,77 h, réel 7,5 h), dont 3,02 h imputées sur Y99F90007",
	}
	for _, a := range res.Anomalies {
		if d, ok := want[a.Key]; ok {
			if a.Detail != d {
				t.Errorf("%s : %q, attendu %q", a.Key, a.Detail, d)
			}
			delete(want, a.Key)
		}
		if a.Key == "ecart|Y99F90003|PETIT Karim|sur_imputation" || a.Key == "ecart|Y99F90005|PETIT Karim|sous_imputation" {
			t.Errorf("anomalie inattendue : %s", a.Key)
		}
	}
	for k := range want {
		t.Errorf("anomalie %s absente", k)
	}
}
