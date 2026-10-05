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

func personne(id, nom string, matricules ...string) domain.Personne {
	return domain.Personne{ID: id, DisplayName: nom, NomNormalise: names.Normalize(nom), Statut: "brouillon",
		Matricules: append([]string{}, matricules...), Alias: []domain.PersonneAlias{}}
}

func withAlias(p domain.Personne, alias string, src domain.AliasSource) domain.Personne {
	p.Alias = append(p.Alias, domain.PersonneAlias{Alias: alias, AliasNormalise: names.Normalize(alias), Source: src})
	return p
}

var rowSeq int

// planLine: a plan line on a single week by default (W37 = 07 → 11/09/2026, 5 j ouvrés).
func planLine(ct, res, libelle string, pid *string, charge float64) domain.PlanLine {
	rowSeq++
	return domain.PlanLine{RowNum: rowSeq, CT: ct, Ressource: res, Libelle: libelle, PersonneID: pid, ChargeTotale: charge,
		LigneCout: "MAIN D'OEUVRE SUR SITE", DateDebut: "2026-09-07", DateFin: "2026-09-11", StatutParsing: domain.ParsingOK}
}

// mo: an hour-based MO entry.
func mo(ct, nom string, h float64, date string) domain.RealiseEntry {
	rowSeq++
	return domain.RealiseEntry{RowNum: rowSeq, TG: ct, TGLibelle: ct + " - Libellé " + ct, Categorie: "MAIN D'OEUVRE",
		Type: "MAIN D'OEUVRE SUR SITE", EmployeFournisseur: nom, Quantite: h, TotalEur: h * 100, DateDepense: date,
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
		Plan:    domain.Version{ID: "plan1", Kind: domain.KindPlan, Statut: domain.StatutActive},
		Realise: domain.Version{ID: "real1", Kind: domain.KindRealise, Statut: domain.StatutActive},
		Now:     time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC),
	}
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
		personne("p1", "DURAND Claire", "DURANDC"),
		personne("p2", "Antoine De La Tour", "DELATOURA"),
		personne("p3", "MARTIN Théo", "MARTINT"),
		personne("p4", "Sarah Blanc", "BLANCS"),
	}
	in.PlanLines = []domain.PlanLine{
		planLine("CTA", "DURANDC", "DURAND Claire / Squad Alpha", sp("p1"), 10),
		planLine("CTB", "MARTINT", "MARTIN Théo / Squad Alpha", sp("p3"), 40),
		planLine("CTC", "DELATOURA", "Antoine De La Tour", sp("p2"), 20),
		planLine("CTA", "BLANCS", "Sarah Blanc", sp("p4"), 20),
		planLine("CTD", "MARTINT", "MARTIN Théo", sp("p3"), 20),
	}
	in.Entries = []domain.RealiseEntry{
		mo("CTA", "DURAND Claire Mme", 26, "2026-09-08"),        // +16 → 🔴
		mo("CTB", "MARTIN Théo M.", 9, "2026-09-09"),            // −31 → 🟣
		mo("CTC", "DE LA TOUR Antoine Mr.", 25, "2026-09-10"),   // +5 → 🟢 (fuzzy)
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
		{"🔴 sur-imputation +16", "CTA", "DURANDC", "2026-W37", domain.FlagSurImputation, 10, 26, 16, domain.ConfFuzzy},
		{"🟣 sous-imputation −31", "CTB", "MARTINT", "2026-W37", domain.FlagSousImputation, 40, 9, -31, domain.ConfFuzzy},
		{"🟢 conforme", "CTC", "DELATOURA", "2026-W37", domain.FlagConforme, 20, 25, 5, domain.ConfFuzzy},
		{"⚫ absence (aucun réel)", "CTA", "BLANCS", "2026-W37", domain.FlagAbsence, 20, 0, -20, domain.ConfPlan},
		{"non-⚫ si réel ailleurs", "CTD", "MARTINT", "2026-W37", domain.FlagConforme, 20, 0, -20, domain.ConfPlan},
		{"🟠 non apparié", "CTE", "BARBIER Luc M.", "2026-W37", domain.FlagHorsPlan, 0, 13, 13, domain.ConfNone},
		{"🟠 semaine verrouillée", "CTA", "DURANDC", "2026-W51", domain.FlagHorsPlan, 0, 8, 8, domain.ConfFuzzy},
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
	r := findRow(t, res, "CTC", "DELATOURA", "2026-W37")
	if r.RessourceLabel != "Antoine De La Tour" || r.PersonneID == nil || *r.PersonneID != "p2" || r.CTLibelle != "CTC - Libellé CTC" {
		t.Errorf("row enrichie incorrecte: %+v", r)
	}
	if hp := findRow(t, res, "CTE", "BARBIER Luc M.", "2026-W37"); hp.PersonneID != nil {
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
	if f := findRow(t, res, "CTA", "DURANDC", "2026-W37").Flag; f != domain.FlagConforme {
		t.Errorf("+16 avec seuil 20 → conforme, got %s", f)
	}
	if f := findRow(t, res, "CTB", "MARTINT", "2026-W37").Flag; f != domain.FlagConforme {
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
	in.PlanLines = []domain.PlanLine{planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 10), l}
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
		row := findRow(t, res, "CTA", "OLDA", "2026-W37")
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

func TestMatchingStrategies(t *testing.T) {
	ps := []domain.Personne{
		personne("p1", "DURAND Claire", "DURANDC", "A12345"),
		withAlias(personne("p2", "Toto Dupont"), "Dupond T.", domain.AliasConfirme),
		withAlias(personne("p3", "Antoine De La Tour"), "ADLT", domain.AliasImport),
		withAlias(personne("p4", "Jean Manuel"), "J. MANUEL", domain.AliasManuel),
		personne("p5", "Paul Homonyme"),
		personne("p6", "Paul Homonyme"),
	}
	lines := []domain.PlanLine{
		planLine("CT1", "ROUXM", "ROUX Marc (support)", nil, 10), // sans personne_id → clé R:
		planLine("CT1", "DELATOURA", "Antoine De La Tour", sp("p3"), 10),
		planLine("CT1", "HOMO", "Paul Homonyme", sp("p6"), 10),
	}
	m := newMatcher(ps, lines)
	cases := []struct {
		name, matricule, nom string
		key                  string
		conf                 domain.Confidence
	}{
		{"matricule", "a12345 ", "N'importe qui", "P:p1", domain.ConfMatricule},
		{"alias confirmé", "", "DUPOND T. M.", "P:p2", domain.ConfAlias},
		{"alias manuel", "", "Manuel J", "P:p4", domain.ConfAlias},
		{"fuzzy nom normalisé (DE LA TOUR Antoine Mr.)", "", "DE LA TOUR Antoine Mr.", "P:p3", domain.ConfFuzzy},
		{"fuzzy alias import", "", "ADLT", "P:p3", domain.ConfFuzzy},
		{"fuzzy libellé plan sans personne", "", "ROUX Marc M.", "R:ROUXM", domain.ConfFuzzy},
		{"homonymes : le planifié gagne", "", "HOMONYME Paul", "P:p6", domain.ConfFuzzy},
		{"none", "", "BARBIER Luc M.", "N:BARBIER LUC", domain.ConfNone},
		{"matricule inconnu → nom", "A99999", "DURAND Claire Mme", "P:p1", domain.ConfFuzzy},
		{"sans nom ni matricule", "", "", "X:", domain.ConfNone},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id := m.resolve(c.matricule, c.nom)
			if id.Key != c.key || id.Confidence != c.conf {
				t.Errorf("got %s/%s, attendu %s/%s", id.Key, id.Confidence, c.key, c.conf)
			}
			if strings.HasPrefix(c.key, "P:") != (id.PersonneID != nil) {
				t.Errorf("PersonneID incohérent")
			}
		})
	}
}

func TestCorrespondancesEtAliasConfirme(t *testing.T) {
	in := flagsScenario()
	res := Run(in, store.DefaultSettings())
	byName := map[string]domain.Correspondance{}
	for _, c := range res.Correspondances {
		byName[c.NomRealise] = c
	}
	c := byName["DE LA TOUR Antoine Mr."]
	if c.Confidence != domain.ConfFuzzy || c.PersonneID == nil || *c.PersonneID != "p2" || c.Ressource != "DELATOURA" || c.NbEcritures != 1 || c.Heures != 25 {
		t.Errorf("correspondance fuzzy: %+v", c)
	}
	if b := byName["BARBIER Luc M."]; b.Confidence != domain.ConfNone || b.PersonneID != nil || b.Heures != 13 {
		t.Errorf("correspondance none: %+v", b)
	}
	if d := byName["DURAND Claire Mme"]; d.NbEcritures != 2 || d.Heures != 34 {
		t.Errorf("DURAND agrégé: %+v", d)
	}
	if len(res.Correspondances) != 4 || res.Correspondances[0].Confidence != domain.ConfNone {
		t.Errorf("correspondances: %d, première %s", len(res.Correspondances), res.Correspondances[0].Confidence)
	}

	// Après confirmation de l'alias → stratégie 2 (alias).
	in.Personnes[1] = withAlias(in.Personnes[1], "DE LA TOUR Antoine Mr.", domain.AliasConfirme)
	res = Run(in, store.DefaultSettings())
	if r := findRow(t, res, "CTC", "DELATOURA", "2026-W37"); r.Confidence != domain.ConfAlias {
		t.Errorf("après confirmation: %s", r.Confidence)
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
	in.PlanLines = []domain.PlanLine{planLine("CTX", "R1", "Un Nom", nil, 10)}
	in.PlanLines[0].PPS = 9000
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
	in.PlanLines = []domain.PlanLine{prov, planLine("CTP", "DURANDC", "DURAND Claire", sp("p1"), 10)}
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
	in.PlanLines = []domain.PlanLine{l, lw, locked}
	late := mo("CTA", "DURAND Claire", 120, "2026-09-08")
	late.PeriodeComptable = "2026-08-31" // < dépense − 7 j
	sansNom := mo("CTA", "", 4, "2026-09-09")
	sansTG := cost("", "MATIERE", "MATIERE", 10)
	rw := mo("CTA", "DURAND Claire", 100, "2026-09-09")
	rw.StatutParsing = domain.ParsingWarn
	in.Entries = []domain.RealiseEntry{late, rw, sansNom, sansTG, mo("CTA", "MARTIN Théo", 1, "2026-09-10")}
	s := store.DefaultSettings()
	s.SeuilFuzzyCount = 1
	res := Run(in, s)

	want := map[string]struct{ regle, count int }{
		"tg_ecart_budget":     {1, 1}, // réalisé 22 500 € vs PPS 200 000 €
		"mo_quantite_semaine": {2, 1}, // DURAND 220 h en W37
		"fuzzy":               {3, 2},
		"sans_tg":             {4, 1},
		"cloture":             {5, 1},
		"plan_repartition":    {0, 1},
		"mo_sans_nom":         {0, 1},
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
	if r := findRow(t, res, "CTA", "(sans nom)", "2026-W37"); r.Flag != domain.FlagHorsPlan {
		t.Errorf("sans nom: %s", r.Flag)
	}
	if r := findRow(t, res, "CTA", "MARTINT", "2026-W37"); !r.Warn {
		t.Error("tuple issu d'une ligne warn non signalé")
	}
	if r := findRow(t, res, "CTA", "DURANDC", "2026-W37"); !r.Warn {
		t.Error("tuple issu d'une écriture warn non signalé")
	}
	// Seuil fuzzy non dépassé → pas de warn.
	s.SeuilFuzzyCount = 10
	if findQual(Run(in, s), "fuzzy") != nil {
		t.Error("fuzzy sous le seuil ne doit pas alerter")
	}
}

func TestPeriodeParDefautEtFiltre(t *testing.T) {
	in := baseInput()
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire")}
	l := planLine("CTA", "DURANDC", "DURAND Claire", sp("p1"), 219)
	l.DateDebut, l.DateFin = "2026-09-01", "2026-11-30"
	in.PlanLines = []domain.PlanLine{l}
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
	in.Plan.Statut = domain.StatutArchivee
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
	in.Personnes = []domain.Personne{personne("p1", "DURAND Claire", "DURANDC")}
	moLine := planLine("CT1", "DURANDC", "DURAND Claire", sp("p1"), 30)
	frais := planLine("CT2", "DURANDC", "DURAND Claire", sp("p1"), 40)
	frais.LigneCout = "FRAIS DE MISSION"
	in.PlanLines = []domain.PlanLine{moLine, frais}
	in.Entries = []domain.RealiseEntry{
		mo("CT1", "DURAND Claire Mme", 35, "2026-09-08"),
		mo("CT1", "DURAND Claire Mme", -5, "2026-09-09"), // contre-passation
	}
	res := Run(in, store.DefaultSettings())
	r := findRow(t, res, "CT1", "DURANDC", "2026-W37")
	if math.Abs(r.Reel-30) > 0.01 || r.Flag != domain.FlagConforme {
		t.Errorf("réel %v flag %s, want 30 h conforme (contre-passation déduite)", r.Reel, r.Flag)
	}
	for _, e := range res.Ecarts {
		if e.CT == "CT2" {
			t.Errorf("ligne de plan non-MO comparée aux heures : %+v", e)
		}
	}
}
