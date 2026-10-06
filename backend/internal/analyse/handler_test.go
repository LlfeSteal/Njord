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
	e.exec(`INSERT INTO versions(id, kind, intitule, importee_le, statut, archivee_le) VALUES (?,?,?,?,?,?)`,
		id, kind, intitule, "2026-10-01T10:00:00Z", statut, map[bool]any{true: "2026-10-02T10:00:00Z", false: nil}[statut == "archivee"])
}

func (e *env) seed() {
	e.version("plan1", "plan", "active", "PDC octobre")
	e.version("plan0", "plan", "archivee", "PDC septembre")
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
	if w.Code != http.StatusOK || !strings.HasPrefix(body, "\xef\xbb\xbfRessource;CT;Semaine;Prévu (h);Réel (h);Écart (h);Flag;Confiance") {
		t.Fatalf("ecarts.csv: %d %q", w.Code, body)
	}
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) != 2 || !strings.Contains(lines[1], "BARBIER Luc;Y99F900012;2026-W37;0;13;13;Hors plan;none") {
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
	in, err := repo.LoadInput(ctx, plan, real)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.PlanLines) != 4 || len(in.Entries) != 5 || len(in.Personnes) != 3 || len(in.Squads) != 1 {
		t.Errorf("chargement: %d lignes, %d écritures, %d personnes, %d squads", len(in.PlanLines), len(in.Entries), len(in.Personnes), len(in.Squads))
	}
	if in.PlanLines[0].PersonneID == nil || *in.PlanLines[0].PersonneID != "p1" || in.PlanLines[3].PersonneID != nil {
		t.Error("personne_id mal relu")
	}
	if in.PlanLines[0].NomPrenom != "DURAND Claire" || in.PlanLines[3].NomPrenom != "" {
		t.Errorf("nom_prenom du plan mal relu : %q / %q", in.PlanLines[0].NomPrenom, in.PlanLines[3].NomPrenom)
	}
	if in.Entries[0].NomPrenom != "DURAND Claire" || in.Entries[0].Matricule != "A00001" {
		t.Errorf("écriture mal relue : %+v", in.Entries[0])
	}
	if p := in.Personnes[0]; p.ID != "p1" || p.NomNormalise != "DURAND|CLAIRE" || p.SquadID == nil {
		t.Errorf("personne mal relue : %+v", p)
	}
}
