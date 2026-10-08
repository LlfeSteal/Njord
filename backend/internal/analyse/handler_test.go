package analyse

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/names"
	"njord/internal/store"
)

type env struct {
	t  *testing.T
	st *store.Store
	r  *gin.Engine
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	st.Now = func() time.Time { return time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC) }
	gin.SetMode(gin.TestMode)
	r := gin.New()
	New(st).Register(r.Group("/api"))
	return &env{t: t, st: st, r: r}
}

func (e *env) exec(q string, args ...any) {
	e.t.Helper()
	if _, err := e.st.DB().Exec(q, args...); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
}

func (e *env) do(method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.r.ServeHTTP(w, req)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("json: %v — %s", err, w.Body.String())
	}
	return v
}

func (e *env) version(id, kind, statut, intitule string) {
	e.versionAt(id, kind, statut, intitule, "2026-10-01T10:00:00Z", "")
}

// versionAt inserts a version imported at importee with a date d'effet ("" = none).
func (e *env) versionAt(id, kind, statut, intitule, importee, effet string) {
	e.exec(`INSERT INTO versions(id, kind, intitule, importee_le, statut, archivee_le, date_effet) VALUES (?,?,?,?,?,?,?)`,
		id, kind, intitule, importee, statut, map[bool]any{true: "2026-10-02T10:00:00Z", false: nil}[statut == "archivee"], effet)
}

func (e *env) seed() {
	e.version("plan1", "plan", "active", "PDC octobre")
	e.versionAt("plan0", "plan", "archivee", "PDC septembre", "2026-09-01T10:00:00Z", "")
	e.version("real1", "realise", "active", "Réalisé S40")
	e.exec(`INSERT INTO squads(id, nom_canonique, nom_normalise, created_at) VALUES ('sq1','Squad Alpha','SQUAD ALPHA','2026-10-01T10:00:00Z')`)
	for _, p := range [][2]string{{"p1", "DURAND Claire"}, {"p2", "Antoine De La Tour"}, {"p3", "Sarah Blanc"}} {
		e.exec(`INSERT INTO personnes(id, display_name, nom_normalise, squad_id, created_at) VALUES (?,?,?,?,?)`,
			p[0], p[1], names.KeyOf(p[1]), "sq1", "2026-10-01T10:00:00Z")
	}
	line := `INSERT INTO plan_lines(version_id,row_num,ct,ressource,libelle,nom_prenom,ligne_cout,charge_totale,pps,date_debut,date_fin,statut_parsing,inactive,personne_id,squad_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	pl := func(v string, row int, ct, res, lib, cout string, charge, pps float64, statut string, pid, sid any) {
		e.exec(line, v, row, ct, res, lib, libelleNomPrenom(lib), cout, charge, pps, "2026-09-07", "2026-09-11", statut, 0, pid, sid)
	}
	pl("plan1", 4, "Y99F90001", "DURANDC", "DURAND Claire / Squad Alpha", "MAIN D'OEUVRE SUR SITE", 10, 1000, "ok", "p1", "sq1")
	pl("plan1", 5, "Y99F90008", "DELATOURA", "Antoine De La Tour", "MAIN D'OEUVRE SUR SITE", 20, 2000, "ok", "p2", nil)
	pl("plan1", 6, "Y99F90004", "BLANCS", "Sarah Blanc", "MAIN D'OEUVRE SUR SITE", 20, 2000, "warn", "p3", nil)
	pl("plan1", 7, "Y99F90004", "DROPPED", "x", "MAIN D'OEUVRE SUR SITE", 500, 0, "drop", nil, nil)
	pl("plan1", 8, "Y99F900012", "2GI_DEMO", "", "PROVISIONS POUR ALEAS", 40, 5000, "ok", nil, nil)
	pl("plan0", 4, "Y99F90001", "DURANDC", "DURAND Claire", "MAIN D'OEUVRE SUR SITE", 30, 0, "ok", "p1", nil)
	entry := `INSERT INTO realise_entries(version_id,row_num,tg,tg_libelle,categorie,type,employe_fournisseur,nom_prenom,matricule,quantite,total_eur,date_depense,periode_comptable,num_facture,statut_parsing)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	re := func(row int, tg, lib, cat, typ, nom, mat string, qte, eur float64, date, fact, statut string) {
		e.exec(entry, "real1", row, tg, lib, cat, typ, nom, realiseNomPrenom(nom), mat, qte, eur, date, "2026-09-30", fact, statut)
	}
	re(2, "Y99F90001", "Y99F90001 - Socle", "MAIN D'OEUVRE", "MAIN D'OEUVRE SUR SITE", "DURAND Claire Mme", "A00001", 26, 2600, "2026-09-08", "", "ok")
	re(3, "Y99F90008", "Y99F90008 - Archi", "MAIN D'OEUVRE", "MAIN D'OEUVRE SUR SITE", "DE LA TOUR Antoine Mr.", "", 22, 2200, "2026-09-09", "", "ok")
	re(4, "Y99F900012", "Y99F900012 - Réserve", "MAIN D'OEUVRE", "MAIN D'OEUVRE SUR SITE", "BARBIER Luc M.", "", 13, 1300, "2026-09-10", "", "ok")
	re(5, "Y99F900012", "Y99F900012 - Réserve", "AUTRES DEPENSES", "PROVISIONS POUR ALEAS", "FOURNISSEUR SECRET", "", 1, 15000, "2026-09-10", "F_0001", "ok")
	re(6, "Y99F90001", "Y99F90001 - Socle", "FRAIS DE MISSION", "FRAIS DE MISSION", "SKYFARE", "", 1, -300, "2026-09-10", "", "ok")
	re(7, "Y99F90001", "Y99F90001 - Socle", "FRAIS DE MISSION", "FRAIS DE MISSION", "SKYFARE", "", 1, 99999, "2026-09-10", "", "drop")
}

func TestHandlerPreconditions(t *testing.T) {
	e := newEnv(t)
	w := e.do("GET", "/api/analyse", nil)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "Aucun plan de charge actif") || !strings.Contains(w.Body.String(), `"precondition"`) {
		t.Fatalf("sans plan: %d %s", w.Code, w.Body.String())
	}
	ctx := decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil))
	if ctx.DefaultPlanID != nil || !strings.Contains(ctx.Message, "Aucun plan de charge actif") || !strings.Contains(ctx.Message, "Aucun réalisé actif") {
		t.Errorf("context vide: %+v", ctx)
	}
	e.version("plan1", "plan", "active", "PDC")
	w = e.do("GET", "/api/analyse", nil)
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "Aucun réalisé actif") {
		t.Fatalf("sans réalisé: %d %s", w.Code, w.Body.String())
	}
	e.version("real1", "realise", "active", "R")
	if w := e.do("GET", "/api/analyse?week_from=2026-W99", nil); w.Code != http.StatusBadRequest {
		t.Errorf("semaine invalide: %d", w.Code)
	}
	if w := e.do("GET", "/api/analyse?week_from=2026-W40&week_to=2026-W36", nil); w.Code != http.StatusBadRequest {
		t.Errorf("période inversée: %d", w.Code)
	}
	if w := e.do("GET", "/api/analyse?plan_version_id=nope", nil); w.Code != http.StatusNotFound {
		t.Errorf("version inconnue: %d", w.Code)
	}
	if w := e.do("GET", "/api/analyse", nil); w.Code != http.StatusOK {
		t.Errorf("versions vides: %d %s", w.Code, w.Body.String())
	}
}

func TestHandlerAnalyse(t *testing.T) {
	e := newEnv(t)
	e.seed()

	ctx := decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil))
	if ctx.DefaultPlanID == nil || *ctx.DefaultPlanID != "plan1" || *ctx.DefaultRealiseID != "real1" || ctx.Message != "" {
		t.Errorf("context: %+v", ctx)
	}
	if len(ctx.PlanVersions) != 2 || ctx.DefaultWeekFrom != "2026-W37" || ctx.DefaultWeekTo != "2026-W37" || len(ctx.Weeks) != 1 {
		t.Errorf("context période: %s → %s, %d versions", ctx.DefaultWeekFrom, ctx.DefaultWeekTo, len(ctx.PlanVersions))
	}

	w := e.do("GET", "/api/analyse", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	res := decode[domain.AnalyseResult](t, w)
	if res.Meta.ArchivedWarning || res.Meta.PlanVersion.ID != "plan1" || res.Meta.WeekFrom != "2026-W37" {
		t.Errorf("meta: %+v", res.Meta)
	}
	byRes := map[string]domain.EcartRow{}
	for _, r := range res.Ecarts {
		byRes[r.Ressource] = r
	}
	if r := byRes["DURAND Claire"]; r.Flag != domain.FlagSurImputation || r.Confidence != domain.ConfNom || r.SquadNom != "Squad Alpha" ||
		r.CTLibelle != "Socle" || r.PersonneID == nil || *r.PersonneID != "p1" {
		t.Errorf("DURAND Claire: %+v", r)
	}
	if r := byRes["DE LA TOUR Antoine"]; r.Flag != domain.FlagConforme || r.Confidence != domain.ConfNom || r.RessourceLabel != "Antoine De La Tour" {
		t.Errorf("DE LA TOUR Antoine: %+v", r)
	}
	if r := byRes["BLANC Sarah"]; r.Flag != domain.FlagAbsence || !r.Warn {
		t.Errorf("BLANC Sarah: %+v", r)
	}
	if _, ok := byRes["x"]; ok {
		t.Error("ligne drop utilisée")
	}
	if r := byRes["BARBIER Luc"]; r.Flag != domain.FlagHorsPlan || r.Confidence != domain.ConfNone {
		t.Errorf("BARBIER: %+v", r)
	}
	if len(res.Alertes.DeriveProvision) != 2 || len(res.Alertes.CTRisque) != 1 || res.Alertes.CTRisque[0].CT != "Y99F900012" {
		t.Errorf("alertes: %+v", res.Alertes)
	}
	if res.Budget.Global.Securise != -300 || res.Budget.Global.NonSecurise != 15000 {
		t.Errorf("budget (drop exclu, avoir inclus): %+v", res.Budget.Global)
	}

	// Dernier rendu sauvegardé (upsert id = 1).
	e.do("GET", "/api/analyse?include_inactive=true", nil)
	var n int
	var params string
	e.st.DB().QueryRow(`SELECT COUNT(*), MAX(params) FROM analyse_last_result`).Scan(&n, &params)
	if n != 1 || !strings.Contains(params, `"include_inactive":true`) || !strings.Contains(params, `"plan_version_id":"plan1"`) {
		t.Errorf("analyse_last_result: %d %s", n, params)
	}

	// Version archivée choisie explicitement.
	res = decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse?plan_version_id=plan0", nil))
	if !res.Meta.ArchivedWarning || res.Meta.PlanVersion.ID != "plan0" {
		t.Errorf("archivée: %+v", res.Meta)
	}
	// Version purgée → 409.
	e.version("plan9", "plan", "purgee", "PDC purgé")
	if w := e.do("GET", "/api/analyse?plan_version_id=plan9", nil); w.Code != http.StatusConflict {
		t.Errorf("purgée: %d", w.Code)
	}
}

func TestHandlerCSV(t *testing.T) {
	e := newEnv(t)
	e.seed()
	w := e.do("GET", "/api/analyse/ecarts.csv?flag=hors_plan", nil)
	body := w.Body.String()
	if w.Code != http.StatusOK || !strings.HasPrefix(body, "\xef\xbb\xbfRessource;CT;Semaine;Prévu (h);Réel (h);Écart (h);Flag;Confiance;CT liés\n") {
		t.Fatalf("ecarts.csv: %d %q", w.Code, body)
	}
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) != 2 || strings.TrimSpace(lines[1]) != "BARBIER Luc;Y99F900012;2026-W37;0;13;13;Hors plan;none;" {
		t.Errorf("filtre flag: %q", lines)
	}
	w = e.do("GET", "/api/analyse/ecarts.csv?ct=Y99F90001&squad_id=sq1", nil)
	if lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n"); len(lines) != 2 || !strings.HasPrefix(lines[1], "DURAND Claire;") {
		t.Errorf("filtre ct+squad: %q", lines)
	}
	if w := e.do("GET", "/api/analyse/ecarts.csv?flag=rouge", nil); w.Code != http.StatusBadRequest {
		t.Errorf("flag inconnu: %d", w.Code)
	}

	w = e.do("GET", "/api/analyse/realise-enrichi.csv", nil)
	body = w.Body.String()
	lines = strings.Split(strings.TrimSpace(body), "\n")
	if w.Code != http.StatusOK || len(lines) != 6 || !strings.HasSuffix(strings.TrimSpace(lines[0]), "iso_week;heures;eur;classification") {
		t.Fatalf("realise-enrichi: %d %d lignes %q", w.Code, len(lines), lines[0])
	}
	if !strings.Contains(lines[0], ";EMPLOYE/FOURNISSEUR;NOM PRENOM;MATRICULE;") ||
		!strings.Contains(lines[1], ";DURAND Claire Mme;DURAND Claire;A00001;") || !strings.Contains(lines[1], ";2026-W37;26;0;SECURISE") {
		t.Errorf("enrichi: %q / %q", lines[0], lines[1])
	}
	masked := e.do("GET", "/api/analyse/realise-enrichi.csv?mask_sensitive=true", nil).Body.String()
	for _, s := range []string{"DURAND", "A00001", "FOURNISSEUR SECRET", "F_0001"} {
		if strings.Contains(masked, s) {
			t.Errorf("donnée sensible %q non masquée", s)
		}
	}
	if !strings.Contains(masked, "NON_SECURISE") {
		t.Error("colonnes dérivées absentes du masqué")
	}
}

func TestHandlerCSVErreurCT(t *testing.T) {
	e := newEnv(t)
	e.seed()
	// BLANC Sarah (20 h prévues sur Y99F90004) impute 20 h sur Y99F90001 → erreur de CT des deux côtés.
	e.exec(`INSERT INTO realise_entries(version_id,row_num,tg,tg_libelle,categorie,type,employe_fournisseur,nom_prenom,quantite,total_eur,date_depense,periode_comptable,statut_parsing)
		VALUES ('real1',8,'Y99F90001','Y99F90001 - Socle','MAIN D''OEUVRE','MAIN D''OEUVRE SUR SITE','BLANC Sarah Mme','BLANC Sarah',20,2000,'2026-09-09','2026-09-30','ok')`)
	w := e.do("GET", "/api/analyse/ecarts.csv?flag=erreur_ct", nil)
	lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
	if w.Code != http.StatusOK || len(lines) != 3 {
		t.Fatalf("ecarts.csv?flag=erreur_ct : %d %q", w.Code, lines)
	}
	for i, want := range []string{
		"BLANC Sarah;Y99F90001;2026-W37;0;20;20;Erreur de CT;nom;Y99F90004",
		"BLANC Sarah;Y99F90004;2026-W37;20;0;-20;Erreur de CT;plan;Y99F90001",
	} {
		if got := strings.TrimSpace(lines[i+1]); got != want {
			t.Errorf("ligne %d : %q, attendu %q", i+1, got, want)
		}
	}
}

func TestHandlerAliasRouteRemoved(t *testing.T) {
	e := newEnv(t)
	e.seed()
	w := e.do("POST", "/api/analyse/alias/confirm", map[string]string{"personne_id": "p2", "alias": "DE LA TOUR Antoine Mr."})
	if w.Code != http.StatusNotFound {
		t.Errorf("POST /analyse/alias/confirm : %d, attendu 404", w.Code)
	}
}

func TestRepoLoadInput(t *testing.T) {
	e := newEnv(t)
	e.seed()
	repo := NewRepo(e.st)
	ctx := context.Background()
	plan, _ := e.st.GetVersion(ctx, domain.KindPlan, "plan1")
	real, _ := e.st.GetVersion(ctx, domain.KindRealise, "real1")
	in, err := repo.LoadInput(ctx, plan, real, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Timeline connue à plan1 : plan0 (importé avant) + plan1.
	if len(in.Plans) != 2 || in.PlanSuperseded || in.PlanRef.ID != "plan1" {
		t.Fatalf("versions retenues : %d, superseded %v", len(in.Plans), in.PlanSuperseded)
	}
	var lines []domain.PlanLine
	for _, p := range in.Plans {
		if p.Version.ID == "plan1" {
			lines = p.Lines
		}
	}
	if len(lines) != 4 || len(in.Entries) != 5 || len(in.Personnes) != 3 || len(in.Squads) != 1 {
		t.Errorf("chargement: %d lignes, %d écritures, %d personnes, %d squads", len(lines), len(in.Entries), len(in.Personnes), len(in.Squads))
	}
	if lines[0].PersonneID == nil || *lines[0].PersonneID != "p1" || lines[3].PersonneID != nil {
		t.Error("personne_id mal relu")
	}
	if lines[0].NomPrenom != "DURAND Claire" || lines[3].NomPrenom != "" {
		t.Errorf("nom_prenom du plan mal relu : %q / %q", lines[0].NomPrenom, lines[3].NomPrenom)
	}
	plan0, _ := e.st.GetVersion(ctx, domain.KindPlan, "plan0")
	if in, err = repo.LoadInput(ctx, plan0, real, nil); err != nil || len(in.Plans) != 1 || !in.PlanSuperseded {
		t.Errorf("timeline connue à plan0 : %d versions, superseded %v, %v", len(in.Plans), in.PlanSuperseded, err)
	}
	if in.Entries[0].NomPrenom != "DURAND Claire" || in.Entries[0].Matricule != "A00001" {
		t.Errorf("écriture mal relue : %+v", in.Entries[0])
	}
	if p := in.Personnes[0]; p.ID != "p1" || p.NomNormalise != "DURAND|CLAIRE" || p.SquadID == nil {
		t.Errorf("personne mal relue : %+v", p)
	}
}

// seedTimeline: pA (effet 07/09, importé le 01/09, archivé) puis pB (effet
// 05/10, importé le 01/10, actif) ; MARTIN disparaît de pB.
func (e *env) seedTimeline() {
	e.versionAt("pA", "plan", "archivee", "PDC septembre", "2026-09-01T10:00:00Z", "2026-09-07")
	e.versionAt("pB", "plan", "active", "PDC octobre", "2026-10-01T10:00:00Z", "2026-10-05")
	e.version("real1", "realise", "active", "Réalisé S41")
	e.exec(`INSERT INTO squads(id, nom_canonique, nom_normalise, created_at) VALUES ('sq1','Squad Alpha','SQUAD ALPHA','2026-10-01T10:00:00Z')`)
	e.exec(`INSERT INTO personnes(id, display_name, nom_normalise, squad_id, created_at) VALUES ('p1','DURAND Claire',?,'sq1','2026-10-01T10:00:00Z')`, names.KeyOf("DURAND Claire"))
	line := `INSERT INTO plan_lines(version_id,row_num,ct,ressource,libelle,nom_prenom,ligne_cout,charge_totale,pps,pourcentage,date_debut,date_fin,statut_parsing)
		VALUES (?,?,?,?,?,?,'MAIN D''OEUVRE SUR SITE',?,?,100,?,?,'ok')`
	pl := func(v string, row int, ct, lib string, charge, pps float64, debut, fin string) {
		e.exec(line, v, row, ct, "R", lib, libelleNomPrenom(lib), charge, pps, debut, fin)
	}
	pl("pA", 1, "CT1", "DURAND Claire", 280, 4000, "2026-09-07", "2026-10-30")
	pl("pA", 2, "CT1", "MARTIN Théo", 280, 1000, "2026-09-07", "2026-10-30")
	pl("pB", 1, "CT2", "DURAND Claire", 140, 2000, "2026-10-05", "2026-10-30")
	entry := `INSERT INTO realise_entries(version_id,row_num,tg,tg_libelle,categorie,type,employe_fournisseur,nom_prenom,quantite,total_eur,date_depense,periode_comptable,statut_parsing)
		VALUES ('real1',?,?,?,'MAIN D''OEUVRE','MAIN D''OEUVRE SUR SITE',?,?,?,?,?,?,'ok')`
	for i, r := range []struct {
		tg, lib, nom string
		h            float64
		date         string
	}{
		{"CT1", "CT1 - Socle", "DURAND Claire Mme", 35, "2026-09-08"},
		{"CT2", "CT2 - Archi", "DURAND Claire Mme", 35, "2026-10-07"},
		{"CT1", "CT1 - Socle", "DURAND Claire Mme", 7, "2026-08-31"}, // non couvert
	} {
		e.exec(entry, i+2, r.tg, r.lib, r.nom, realiseNomPrenom(r.nom), r.h, r.h*100, r.date, r.date)
	}
}

func TestHandlerPlanTimeline(t *testing.T) {
	e := newEnv(t)
	e.seedTimeline()

	w := e.do("GET", "/api/analyse/plan-timeline", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	tl := decode[domain.PlanTimeline](t, w)
	if tl.PlanVersion == nil || tl.PlanVersion.ID != "pB" || len(tl.Windows) != 2 || tl.Windows[0].Fin != "2026-10-04" || tl.Windows[1].Debut != "2026-10-05" {
		t.Fatalf("timeline : %+v", tl)
	}
	if len(tl.Segments) != 3 {
		t.Fatalf("segments : %+v", tl.Segments)
	}
	d1, d2, m := tl.Segments[0], tl.Segments[1], tl.Segments[2]
	if d1.Ressource != "DURAND Claire" || d1.CT != "CT1" || d1.Debut != "2026-09-07" || d1.Fin != "2026-10-04" || d1.Charge != 140 || d1.PPS != 2000 ||
		d1.CTLibelle != "Socle" || d1.SquadNom != "Squad Alpha" || d1.PersonneID == nil || *d1.PersonneID != "p1" || d1.VersionID != "pA" || d1.Pourcentage != 100 {
		t.Errorf("DURAND CT1 : %+v", d1)
	}
	if d2.CT != "CT2" || d2.Debut != "2026-10-05" || d2.Fin != "2026-10-30" || d2.Charge != 140 || d2.VersionID != "pB" {
		t.Errorf("DURAND CT2 : %+v", d2)
	}
	if m.Ressource != "MARTIN Théo" || m.Fin != "2026-10-04" || m.PersonneID != nil || m.SquadNom != "" {
		t.Errorf("MARTIN : %+v", m)
	}

	// Timeline connue à pA : pA seule, ligne entière.
	tl = decode[domain.PlanTimeline](t, e.do("GET", "/api/analyse/plan-timeline?plan_version_id=pA", nil))
	if len(tl.Windows) != 1 || len(tl.Segments) != 2 || tl.Segments[0].Fin != "2026-10-30" || tl.Segments[0].Charge != 280 {
		t.Errorf("timeline pA : %+v", tl)
	}

	w = e.do("GET", "/api/analyse/plan-timeline.csv", nil)
	lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
	if w.Code != http.StatusOK || len(lines) != 4 ||
		!strings.HasPrefix(lines[0], "\xef\xbb\xbfRessource;CT;Libellé CT;Squad;Ligne de coût;%;Début;Fin;Charge (h);PPS;Version") ||
		!strings.Contains(lines[1], "DURAND Claire;CT1;Socle;Squad Alpha;MAIN D'OEUVRE SUR SITE;100;2026-09-07;2026-10-04;140;2000;PDC septembre") {
		t.Errorf("csv : %d %q", w.Code, lines)
	}

	if w := e.do("GET", "/api/analyse/plan-timeline?plan_version_id=nope", nil); w.Code != http.StatusNotFound {
		t.Errorf("inconnue : %d", w.Code)
	}
	e.versionAt("pZ", "plan", "purgee", "PDC purgé", "2026-08-01T10:00:00Z", "2026-08-01")
	if w := e.do("GET", "/api/analyse/plan-timeline?plan_version_id=pZ", nil); w.Code != http.StatusConflict {
		t.Errorf("purgée : %d", w.Code)
	}
}

func TestHandlerAnalyseTimeline(t *testing.T) {
	e := newEnv(t)
	e.seedTimeline()

	res := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	if res.Meta.PlanVersion.ID != "pB" || res.Meta.ArchivedWarning || len(res.Meta.Timeline) != 2 || res.KPIs.HeuresNonCouvertes != 0 {
		t.Errorf("défaut : %+v / %v h non couvertes", res.Meta, res.KPIs.HeuresNonCouvertes)
	}
	// W36 (avant la timeline) dans la période : heures non couvertes, aucun tuple.
	wide := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse?week_from=2026-W36", nil))
	if wide.KPIs.HeuresNonCouvertes != 7 || wide.Meta.Weeks[0].Couverture != domain.CouvertureAucune || len(wide.Ecarts) != len(res.Ecarts) {
		t.Errorf("W36 : %v h non couvertes, %d / %d tuples", wide.KPIs.HeuresNonCouvertes, len(wide.Ecarts), len(res.Ecarts))
	}
	if res.Meta.WeekFrom != "2026-W37" || res.Meta.WeekTo != "2026-W41" {
		t.Errorf("période : %s → %s", res.Meta.WeekFrom, res.Meta.WeekTo)
	}
	r := findRow(t, res, "CT2", "DURAND Claire", "2026-W41")
	if r.Flag != domain.FlagConforme || r.PlanVersionID == nil || *r.PlanVersionID != "pB" {
		t.Errorf("CT2 W41 : %+v", r)
	}

	// Timeline connue à pA (plus ancienne) : pB ignorée, avertissement.
	res = decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse?plan_version_id=pA", nil))
	if res.Meta.PlanVersion.ID != "pA" || !res.Meta.ArchivedWarning || len(res.Meta.Timeline) != 1 {
		t.Errorf("pA : %+v", res.Meta)
	}
	// Sans pB, les 35 h de CT2 compensent exactement les 35 h prévues sur CT1 : erreur de CT (§6.2).
	if r := findRow(t, res, "CT2", "DURAND Claire", "2026-W41"); r.Flag != domain.FlagErreurCT || r.Prevu != 0 || *r.PlanVersionID != "pA" ||
		r.Reaffecte != 35 || len(r.CTsLies) != 1 || r.CTsLies[0] != "CT1" {
		t.Errorf("CT2 sans pB : %+v", r)
	}
	if r := findRow(t, res, "CT1", "DURAND Claire", "2026-W41"); r.Flag != domain.FlagErreurCT || r.Prevu != 35 || len(r.CTsLies) != 1 || r.CTsLies[0] != "CT2" {
		t.Errorf("CT1 sans pB : %+v", r)
	}

	ctx := decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil))
	if ctx.DefaultPlanID == nil || *ctx.DefaultPlanID != "pB" || ctx.DefaultWeekFrom != "2026-W37" || ctx.DefaultWeekTo != "2026-W41" ||
		len(ctx.Weeks) != 9 || ctx.Weeks[0].Week != "2026-W36" || ctx.Weeks[0].Couverture != domain.CouvertureAucune ||
		ctx.Weeks[1].Couverture != domain.CouvertureTotale {
		t.Errorf("context : %+v", ctx)
	}

	// Sans version active : défaut = plus récente non purgée.
	e.exec(`UPDATE versions SET statut = 'archivee' WHERE id = 'pB'`)
	res = decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	if res.Meta.PlanVersion.ID != "pB" || res.Meta.ArchivedWarning {
		t.Errorf("défaut sans active : %+v", res.Meta)
	}
	if ctx := decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil)); ctx.DefaultPlanID == nil || *ctx.DefaultPlanID != "pB" || ctx.Message != "" {
		t.Errorf("context sans active : %+v", ctx)
	}
}

// seedProvisions: prov0 (archivée), prov1 (active), prov9 (purgée).
func (e *env) seedProvisions() {
	e.versionAt("prov0", "provision", "archivee", "Provisions septembre", "2026-09-01T10:00:00Z", "")
	e.version("prov1", "provision", "active", "Provisions octobre")
	e.version("prov9", "provision", "purgee", "Provisions purgées")
	line := `INSERT INTO provision_lines(version_id,row_num,ct,libelle,montant,unite,ligne_cout,type_depense,date_debut,date_fin,groupe,statut_parsing)
		VALUES (?,?,?,?,?,'EURO',?,'Standard','2026-12-31','2027-01-01',?,?)`
	e.exec(line, "prov1", 5, "Y99F900012", "Provision", 100000, "PROVISIONS POUR ALEAS", "Réserve de capacité & aléas > Provisions pour aléas", "ok")
	e.exec(line, "prov1", 6, "Y99F900015", "Fonds", 40000, "CAPACITE SUR SITE", "Réserve de capacité & aléas > Fonds de transformation", "warn")
	e.exec(line, "prov1", 7, "Y99F90001", "Rejetée", 99999, "CAPACITE SUR SITE", "", "drop")
	e.exec(line, "prov0", 5, "Y99F90001", "Ancienne", 500, "CAPACITE SUR SITE", "Programme > Socle", "ok")
}

func TestHandlerAnalyseProvisions(t *testing.T) {
	e := newEnv(t)
	e.seed()
	ctx := decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil))
	if ctx.DefaultProvisionID != nil || ctx.ProvisionVersions == nil || len(ctx.ProvisionVersions) != 0 {
		t.Errorf("context sans provisions : %+v / %v", ctx.ProvisionVersions, ctx.DefaultProvisionID)
	}
	sans := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	gs := sans.Previsions.Global
	if sans.Meta.ProvisionVersion != nil || gs.Provisions != 0 || gs.Budget != gs.PPS || gs.Budget != 10000 {
		t.Fatalf("sans provisions : meta %+v, global %+v", sans.Meta.ProvisionVersion, gs)
	}
	// Id explicite sans aucune version de provisions → 404.
	if w := e.do("GET", "/api/analyse?provision_version_id=nope", nil); w.Code != http.StatusNotFound {
		t.Errorf("provisions inconnues : %d", w.Code)
	}

	e.seedProvisions()
	ctx = decode[domain.AnalyseContext](t, e.do("GET", "/api/analyse/context", nil))
	if ctx.DefaultProvisionID == nil || *ctx.DefaultProvisionID != "prov1" || len(ctx.ProvisionVersions) != 2 {
		t.Errorf("context : %d versions, défaut %v", len(ctx.ProvisionVersions), ctx.DefaultProvisionID)
	}

	res := decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse", nil))
	gl := res.Previsions.Global
	if res.Meta.ProvisionVersion == nil || res.Meta.ProvisionVersion.ID != "prov1" {
		t.Fatalf("meta.provision_version : %+v", res.Meta.ProvisionVersion)
	}
	if gl.PPS != gs.PPS || gl.Provisions != 140000 || gl.Budget != gs.Budget+140000 ||
		gl.AtterrissagePlan != gs.AtterrissagePlan || gl.ResteAFaire != gs.ResteAFaire {
		t.Errorf("global : %+v (sans : %+v)", gl, gs)
	}
	p12 := findCT(t, res.Previsions, "Y99F900012")
	if p12.PPS != 5000 || p12.Provisions != 100000 || p12.Budget != 105000 || p12.Statut != domain.PrevisionOK {
		t.Errorf("Y99F900012 : %+v", p12)
	}
	if s12 := findCT(t, sans.Previsions, "Y99F900012"); s12.Statut != domain.PrevisionDepassement {
		t.Errorf("Y99F900012 sans provisions : %+v", s12)
	}
	p15 := findCT(t, res.Previsions, "Y99F900015")
	if p15.CTLibelle != "Fonds de transformation" || p15.Budget != 40000 || p15.Consomme != 0 || p15.Statut != domain.PrevisionOK {
		t.Errorf("Y99F900015 (provisions seules) : %+v", p15)
	}
	var b15 *domain.BudgetCT
	for i := range res.Budget.ParCT {
		if res.Budget.ParCT[i].CT == "Y99F900015" {
			b15 = &res.Budget.ParCT[i]
		}
	}
	if b15 == nil || b15.ChargeMax != 40000 || b15.Provisions != 40000 {
		t.Errorf("budget Y99F900015 : %+v", b15)
	}
	nat := 0.0
	for _, n := range res.Budget.ParNature {
		nat += n.Budget
	}
	if nat != gl.Budget {
		t.Errorf("Σ natures.budget %v ≠ budget %v", nat, gl.Budget)
	}
	var params string
	e.st.DB().QueryRow(`SELECT params FROM analyse_last_result WHERE id = 1`).Scan(&params)
	if !strings.Contains(params, `"provision_version_id":"prov1"`) {
		t.Errorf("analyse_last_result : %s", params)
	}

	// Version archivée choisie explicitement.
	res = decode[domain.AnalyseResult](t, e.do("GET", "/api/analyse?provision_version_id=prov0", nil))
	if res.Meta.ProvisionVersion == nil || res.Meta.ProvisionVersion.ID != "prov0" || res.Previsions.Global.Budget != gs.Budget+500 {
		t.Errorf("prov0 : %+v, budget %v", res.Meta.ProvisionVersion, res.Previsions.Global.Budget)
	}
	// Inconnue ou purgée → 404, y compris pour les exports qui partagent les paramètres.
	for _, path := range []string{"/api/analyse?provision_version_id=nope", "/api/analyse?provision_version_id=prov9",
		"/api/analyse/ecarts.csv?provision_version_id=nope"} {
		if w := e.do("GET", path, nil); w.Code != http.StatusNotFound {
			t.Errorf("%s : %d", path, w.Code)
		}
	}
	if w := e.do("GET", "/api/analyse/ecarts.csv?provision_version_id=prov1", nil); w.Code != http.StatusOK {
		t.Errorf("ecarts.csv avec provisions : %d", w.Code)
	}

	// Plus de version active : retour au budget = Σ PPS, sans 409.
	e.exec(`UPDATE versions SET statut = 'archivee' WHERE id = 'prov1'`)
	w := e.do("GET", "/api/analyse", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("sans provision active : %d %s", w.Code, w.Body.String())
	}
	res = decode[domain.AnalyseResult](t, w)
	if res.Meta.ProvisionVersion != nil || res.Previsions.Global.Budget != gs.Budget {
		t.Errorf("sans provision active : %+v, budget %v", res.Meta.ProvisionVersion, res.Previsions.Global.Budget)
	}
	e.st.DB().QueryRow(`SELECT params FROM analyse_last_result WHERE id = 1`).Scan(&params)
	if !strings.Contains(params, `"provision_version_id":""`) {
		t.Errorf("analyse_last_result sans provisions : %s", params)
	}
}
