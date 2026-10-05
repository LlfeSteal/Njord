package plan

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func count(t *testing.T, st *store.Store, q string, args ...any) int {
	t.Helper()
	var n int
	if err := st.DB().QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func str(t *testing.T, st *store.Store, q string, args ...any) string {
	t.Helper()
	var s string
	if err := st.DB().QueryRow(q, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return s
}

func TestServiceImportDemo(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)
	svc := NewService(st)
	data := readDemo(t)

	// Preview : rien n'est écrit.
	rep, err := svc.Preview(ctx, data, "demo_plancharge.xlsx", "")
	if err != nil {
		t.Fatal(err)
	}
	if rep.Intitule != "demo_plancharge" || rep.Total != 36 || rep.OK != 30 || rep.Warn != 6 || rep.ActiveVersion != nil {
		t.Fatalf("preview %+v", rep)
	}
	if len(rep.NouvellesPersonnes) != 29 || len(rep.NouveauxSquads) != 8 {
		t.Fatalf("preview créations : %d personnes, %d squads", len(rep.NouvellesPersonnes), len(rep.NouveauxSquads))
	}
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`) + count(t, st, `SELECT COUNT(*) FROM squads`) +
		count(t, st, `SELECT COUNT(*) FROM versions`); n != 0 {
		t.Fatalf("preview a écrit %d objets", n)
	}

	res, err := svc.Commit(ctx, data, "demo_plancharge.xlsx", "PDC sept.", "alice", true)
	if err != nil {
		t.Fatal(err)
	}
	v1 := res.Version
	if v1.Statut != domain.StatutActive || v1.NbLignes != 36 || v1.NbWarn != 6 || v1.Layout != "A" ||
		v1.Intitule != "PDC sept." || v1.Importeur != "alice" || v1.PeriodeDebut != "2026-09-01" || v1.PeriodeFin != "2026-11-30" ||
		v1.SourceFormat != domain.FormatDemo {
		t.Fatalf("version %+v", v1)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ?`, v1.ID); n != 36 {
		t.Fatalf("%d lignes", n)
	}
	// Une personne par code ressource distinct.
	nCodes := count(t, st, `SELECT COUNT(DISTINCT ressource) FROM plan_lines WHERE version_id = ?`, v1.ID)
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != nCodes || n != 29 {
		t.Fatalf("%d personnes pour %d codes", n, nCodes)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ? AND personne_id IS NULL`, v1.ID); n != 0 {
		t.Fatalf("%d lignes sans personne", n)
	}
	// DURANDC : une seule personne, deux lignes, un alias import.
	durand := str(t, st, `SELECT personne_id FROM personne_matricules WHERE matricule = 'DURANDC'`)
	if n := count(t, st, `SELECT COUNT(DISTINCT personne_id) FROM plan_lines WHERE ressource = 'DURANDC'`); n != 1 {
		t.Fatalf("DURANDC sur %d personnes", n)
	}
	if dn := str(t, st, `SELECT display_name FROM personnes WHERE id = ?`, durand); dn != "DURAND Claire" {
		t.Errorf("display_name %q", dn)
	}
	if a := str(t, st, `SELECT alias_normalise || '|' || source FROM personne_alias WHERE personne_id = ?`, durand); a != "CLAIRE DURAND|import" {
		t.Errorf("alias %q", a)
	}
	// LEROYN ligne 52 (libellé vide) rattaché via matricule.
	if n := count(t, st, `SELECT COUNT(DISTINCT personne_id) FROM plan_lines WHERE ressource = 'LEROYN'`); n != 1 {
		t.Errorf("LEROYN sur %d personnes", n)
	}
	// Squads imbriqués.
	sq := func(name string) (id, parent string) {
		var p *string
		if err := st.DB().QueryRow(`SELECT id, parent_id FROM squads WHERE nom_canonique = ?`, name).Scan(&id, &p); err != nil {
			t.Fatalf("squad %s : %v", name, err)
		}
		if p != nil {
			parent = *p
		}
		return
	}
	alpha, alphaParent := sq("Squad Alpha — Plateforme")
	core, coreParent := sq("Alpha Core Team")
	dt, _ := sq("Direction Technique SC")
	_, comiteParent := sq("Comité d'Architecture")
	if alphaParent != "" || coreParent != alpha || comiteParent != dt {
		t.Errorf("parents alpha=%q core=%q comite=%q", alphaParent, coreParent, comiteParent)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM squads`); n != 8 {
		t.Errorf("%d squads", n)
	}
	lineSquad := func(row int) string {
		return str(t, st, `SELECT squad_id FROM plan_lines WHERE version_id = ? AND row_num = ?`, v1.ID, row)
	}
	if lineSquad(8) != core || lineSquad(11) != alpha || lineSquad(39) != dt {
		t.Errorf("squad_id des lignes 8/11/39")
	}
	// Alias de squad issus des libellés.
	for alias, owner := range map[string]string{"SQUAD ALPHA": alpha, "DIRECTION TECHNIQUE": dt} {
		if got := str(t, st, `SELECT squad_id FROM squad_alias WHERE alias_normalise = ?`, alias); got != owner {
			t.Errorf("alias %s → %s", alias, got)
		}
	}
	cq, _ := sq("Cellule Transverse Qualité")
	if got := str(t, st, `SELECT squad_id FROM squad_alias WHERE alias_normalise = 'CELLULE QUALITE'`); got != cq {
		t.Errorf("alias Cellule Qualité → %s", got)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM squad_alias`); n != 5 {
		t.Errorf("%d alias de squad", n)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM audit_log WHERE action = 'referentiel_import'`); n != 1 {
		t.Errorf("audit referentiel_import %d", n)
	}

	// Ré-import avec archivage : l'ancienne est archivée, référentiels inchangés.
	rep2, err := svc.Preview(ctx, data, "demo_plancharge.xlsx", "")
	if err != nil {
		t.Fatal(err)
	}
	if rep2.ActiveVersion == nil || rep2.ActiveVersion.ID != v1.ID || len(rep2.NouvellesPersonnes) != 0 || len(rep2.NouveauxSquads) != 0 {
		t.Fatalf("preview 2 %+v", rep2)
	}
	res2, err := svc.Commit(ctx, data, "demo_plancharge.xlsx", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if res2.Version.Statut != domain.StatutActive || res2.Version.Intitule != "demo_plancharge" || res2.Version.Importeur != "local" {
		t.Fatalf("v2 %+v", res2.Version)
	}
	old, _ := st.GetVersion(ctx, domain.KindPlan, v1.ID)
	if old.Statut != domain.StatutArchivee {
		t.Fatalf("v1 %s", old.Statut)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != 29 {
		t.Errorf("%d personnes après ré-import", n)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM personne_alias`); n != 27 { // 29 − 2 externes sans libellé
		t.Errorf("%d alias personnes", n)
	}

	// Sans archivage : la nouvelle naît archivée.
	res3, err := svc.Commit(ctx, data, "x.xlsx", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if res3.Version.Statut != domain.StatutArchivee || res3.Version.ArchiveeLe == nil {
		t.Fatalf("v3 %+v", res3.Version)
	}
	act, _ := st.ActiveVersion(ctx, domain.KindPlan)
	if act == nil || act.ID != res2.Version.ID {
		t.Fatalf("active %+v", act)
	}
}

func TestServiceSpecReferentiels(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)
	svc := NewService(st)
	res, err := svc.Commit(ctx, buildSpecXLSX(t, "Plan de charge", specHeader, specRows()), "spec.xlsx", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Version.Layout != "mixte" || res.Version.NbDrop != 5 || res.Version.NbLignes != 6 {
		t.Fatalf("version %+v", res.Version)
	}
	// Sans groupe : « Squad Alpha » / « Squad Beta » deviennent des squads.
	if n := count(t, st, `SELECT COUNT(*) FROM squads WHERE nom_canonique IN ('Squad Alpha','Squad Beta')`); n != 2 {
		t.Errorf("%d squads libellé", n)
	}
	// R_004 (CT vide, drop) : pas de personne créée.
	if n := count(t, st, `SELECT COUNT(*) FROM personne_matricules WHERE matricule = 'R_004'`); n != 0 {
		t.Errorf("personne créée pour une ligne rejetée")
	}
	if dn := str(t, st, `SELECT p.display_name FROM personnes p JOIN personne_matricules m ON m.personne_id = p.id WHERE m.matricule = 'R_002'`); dn != "MARTIN Léa" {
		t.Errorf("R_002 → %q", dn)
	}
}

// ---------------------------------------------------------------------------
// HTTP

func newRouter(st *store.Store) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	New(st).Register(r.Group("/api"))
	return r
}

func upload(t *testing.T, r http.Handler, path string, data []byte, filename string, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", filename)
	fw.Write(data)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func do(r http.Handler, method, path, body string) *httptest.ResponseRecorder {
	var rd *strings.Reader
	if body != "" {
		rd = strings.NewReader(body)
	} else {
		rd = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decode[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("json %v : %s", err, w.Body.String())
	}
	return v
}

func TestHTTP(t *testing.T) {
	st := newStore(t)
	r := newRouter(st)
	data := readDemo(t)

	// En-tête non conforme → 422, rien d'écrit.
	bad := append([]any{}, specHeader...)
	bad[0] = "CT"
	w := upload(t, r, "/api/plan/imports", buildSpecXLSX(t, "Plan de charge", bad, specRows()), "bad.xlsx", nil)
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "header_invalid") {
		t.Fatalf("bad header : %d %s", w.Code, w.Body.String())
	}
	if n := count(t, st, `SELECT COUNT(*) FROM versions`); n != 0 {
		t.Fatalf("%d versions après rejet", n)
	}
	if w := do(r, http.MethodPost, "/api/plan/imports", ""); w.Code != http.StatusBadRequest {
		t.Errorf("sans fichier : %d", w.Code)
	}

	w = upload(t, r, "/api/plan/imports/preview", data, "demo_plancharge.xlsx", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("preview %d %s", w.Code, w.Body.String())
	}
	rep := decode[domain.ImportReport](t, w)
	if rep.Total != 36 || rep.Layout != "A" || rep.PctInactifs == nil || len(rep.NouveauxSquads) != 8 {
		t.Fatalf("preview %+v", rep)
	}

	w = upload(t, r, "/api/plan/imports", data, "demo_plancharge.xlsx", map[string]string{"importeur": "bob", "archive_active": "true"})
	if w.Code != http.StatusCreated {
		t.Fatalf("import %d %s", w.Code, w.Body.String())
	}
	ir := decode[domain.ImportResult](t, w)
	id := ir.Version.ID
	if ir.Version.Importeur != "bob" || ir.Report.Intitule != "demo_plancharge" {
		t.Fatalf("import %+v", ir.Version)
	}

	lines := func(qs string) domain.PlanLinesPage {
		t.Helper()
		w := do(r, http.MethodGet, "/api/plan/versions/"+id+"/lines"+qs, "")
		if w.Code != http.StatusOK {
			t.Fatalf("lines%s : %d %s", qs, w.Code, w.Body.String())
		}
		return decode[domain.PlanLinesPage](t, w)
	}
	p := lines("")
	if p.Total != 36 || len(p.Items) != 36 || p.Items[0].RowNum != 8 {
		t.Fatalf("lines total=%d items=%d", p.Total, len(p.Items))
	}
	if p.Totals.ChargeTotale != 1541.5+1340.75+1369.75+1022+967.25+2609 {
		t.Errorf("Σ charge %v", p.Totals.ChargeTotale)
	}
	p = lines("?limit=5&offset=5&sort=charge_totale&order=desc")
	if p.Total != 36 || len(p.Items) != 5 || p.Totals.ChargeTotale < 8000 {
		t.Errorf("pagination %+v", p)
	}
	if p = lines("?sort=charge_totale&order=desc&limit=1"); p.Items[0].ChargeTotale != 1095 {
		t.Errorf("tri desc %v", p.Items[0].ChargeTotale)
	}
	if p = lines("?ct=Y99F90001"); p.Total != 3 || p.Totals.ChargeTotale != 1040.25 {
		t.Errorf("ct %d %v", p.Total, p.Totals.ChargeTotale)
	}
	if p = lines("?q=theo"); p.Total != 2 {
		t.Errorf("q=theo → %d", p.Total)
	}
	if p = lines("?q=y99f900010"); p.Total != 3 {
		t.Errorf("q=CT → %d", p.Total)
	}
	if p = lines("?statut=warn"); p.Total != 6 || p.Items[0].RowNum != 50 {
		t.Errorf("statut=warn → %d", p.Total)
	}
	if p = lines("?inactive=false"); p.Total != 36 {
		t.Errorf("inactive=false → %d", p.Total)
	}
	if p = lines("?inactive=true"); p.Total != 0 {
		t.Errorf("inactive=true → %d", p.Total)
	}
	if p = lines("?ligne_cout=Stockage"); p.Total != 1 {
		t.Errorf("ligne_cout → %d", p.Total)
	}
	// Chevauchement : seule la ligne 12 (fin 46325 = 2026-10-30) est exclue.
	if p = lines("?date_from=2026-11-01&date_to=2026-12-31"); p.Total != 35 {
		t.Errorf("date_from → %d", p.Total)
	}
	if w := do(r, http.MethodGet, "/api/plan/versions/"+id+"/lines?sort=foo", ""); w.Code != http.StatusBadRequest {
		t.Errorf("sort invalide %d", w.Code)
	}
	if w := do(r, http.MethodGet, "/api/plan/versions/nope/lines", ""); w.Code != http.StatusNotFound {
		t.Errorf("version inconnue %d", w.Code)
	}

	// Facets + filtre squad.
	w = do(r, http.MethodGet, "/api/plan/versions/"+id+"/facets", "")
	f := decode[domain.Facets](t, w)
	if len(f["ct"]) != 12 || len(f["squad_id"]) != 8 || len(f["statut"]) != 2 || len(f["ressource"]) != 29 {
		t.Errorf("facets ct=%d squad=%d statut=%v ress=%d", len(f["ct"]), len(f["squad_id"]), f["statut"], len(f["ressource"]))
	}
	core := str(t, st, `SELECT id FROM squads WHERE nom_canonique = 'Alpha Core Team'`)
	if p = lines("?squad_id=" + core); p.Total != 3 {
		t.Errorf("squad_id → %d", p.Total)
	}

	// CSV.
	w = do(r, http.MethodGet, "/api/plan/versions/"+id+"/lines.csv?statut=ok", "")
	body := w.Body.String()
	if w.Code != 200 || !strings.HasPrefix(body, "\xef\xbb\xbfrow_num;statut_parsing;motif_rejet;ct;") {
		t.Fatalf("csv %d %q", w.Code, body[:min(80, len(body))])
	}
	recs := strings.Split(strings.TrimSpace(body), "\n")
	if len(recs) != 31 { // en-tête + 30 lignes ok
		t.Errorf("csv %d lignes", len(recs))
	}
	if !strings.Contains(recs[1], "8;ok;;Y99F90001;DURANDC;DURAND Claire / Squad Alpha;DURAND Claire;Standard;MAIN D'OEUVRE SUR SITE;219;25093.02;40;U9AAA1;Dates fixes;2026-09-01;2026-11-30;false;internal;Squad Alpha — Plateforme > Alpha Core Team") {
		t.Errorf("csv ligne 1 %q", recs[1])
	}

	// Cycle de vie.
	if w := do(r, http.MethodGet, "/api/plan/versions", ""); w.Code != 200 || len(decode[[]domain.Version](t, w)) != 1 {
		t.Errorf("versions %d", w.Code)
	}
	w = do(r, http.MethodPost, "/api/plan/versions/"+id+"/archive", `{"operateur":"carol"}`)
	if v := decode[domain.Version](t, w); w.Code != 200 || v.Statut != domain.StatutArchivee {
		t.Fatalf("archive %d %s", w.Code, w.Body.String())
	}
	if n := count(t, st, `SELECT COUNT(*) FROM audit_log WHERE action = 'archive' AND operateur = 'carol'`); n != 1 {
		t.Errorf("audit archive %d", n)
	}
	w = do(r, http.MethodPost, "/api/plan/versions/"+id+"/purge", `{"confirm_intitule":"demo_plancharge"}`)
	if w.Code != http.StatusConflict {
		t.Errorf("purge trop tôt %d", w.Code)
	}
	w = do(r, http.MethodPost, "/api/plan/versions/"+id+"/reactivate", "")
	if v := decode[domain.Version](t, w); w.Code != 200 || v.Statut != domain.StatutActive {
		t.Fatalf("reactivate %d %s", w.Code, w.Body.String())
	}
	if w := do(r, http.MethodGet, "/api/plan/versions/"+id, ""); w.Code != 200 {
		t.Errorf("get version %d", w.Code)
	}
}
