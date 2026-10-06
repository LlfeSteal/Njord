package plan

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	if rep.Intitule != "demo_plancharge" || rep.Total != 36 || rep.OK != 31 || rep.Warn != 5 || rep.ActiveVersion != nil {
		t.Fatalf("preview %+v", rep)
	}
	if len(rep.NouvellesPersonnes) != 25 || len(rep.NouveauxSquads) != 8 {
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
	if v1.Statut != domain.StatutActive || v1.NbLignes != 36 || v1.NbWarn != 5 || v1.Layout != "A" ||
		v1.Intitule != "PDC sept." || v1.Importeur != "alice" || v1.PeriodeDebut != "2026-09-01" || v1.PeriodeFin != "2026-11-30" ||
		v1.SourceFormat != domain.FormatDemo {
		t.Fatalf("version %+v", v1)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ?`, v1.ID); n != 36 {
		t.Fatalf("%d lignes", n)
	}
	// Une personne par NOM Prénom distinct (clé names.Key), en brouillon.
	nNoms := count(t, st, `SELECT COUNT(DISTINCT nom_prenom) FROM plan_lines WHERE version_id = ? AND nom_prenom <> ''`, v1.ID)
	if n := count(t, st, `SELECT COUNT(*) FROM personnes WHERE statut = 'brouillon'`); n != nNoms || n != 25 {
		t.Fatalf("%d personnes pour %d noms", n, nNoms)
	}
	// Lignes non nominatives (50, 51, 53, 54, 55) : sans personne.
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ? AND personne_id IS NULL AND nom_prenom = ''`, v1.ID); n != 5 {
		t.Fatalf("%d lignes non nominatives sans personne", n)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ? AND (personne_id IS NULL) <> (nom_prenom = '')`, v1.ID); n != 0 {
		t.Fatalf("%d lignes mal rattachées", n)
	}
	// DURAND Claire : une seule personne (clé DURAND|CLAIRE), deux lignes.
	durand := str(t, st, `SELECT id FROM personnes WHERE nom_normalise = 'DURAND|CLAIRE'`)
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE personne_id = ?`, durand); n != 2 {
		t.Fatalf("DURAND Claire sur %d lignes", n)
	}
	if dn := str(t, st, `SELECT display_name FROM personnes WHERE id = ?`, durand); dn != "DURAND Claire" {
		t.Errorf("display_name %q", dn)
	}
	if k := str(t, st, `SELECT nom_normalise FROM personnes WHERE display_name = 'DE LA TOUR Antoine'`); k != "DE LA TOUR|ANTOINE" {
		t.Errorf("clé %q", k)
	}
	// LEROY Nathalie : lignes 43 (LEROYN) et 52 (code externe) → même personne.
	if n := count(t, st, `SELECT COUNT(DISTINCT personne_id) FROM plan_lines WHERE version_id = ? AND row_num IN (43, 52)`, v1.ID); n != 1 {
		t.Errorf("LEROY Nathalie sur %d personnes", n)
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
	if d := str(t, st, `SELECT details FROM audit_log WHERE action = 'referentiel_import'`); d != "personnes créées=25 squads créés=8" {
		t.Errorf("audit referentiel_import %q", d)
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
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != 25 {
		t.Errorf("%d personnes après ré-import", n)
	}
	// Mêmes personnes retrouvées par clé.
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines a JOIN plan_lines b ON b.row_num = a.row_num
		WHERE a.version_id = ? AND b.version_id = ? AND a.personne_id IS NOT b.personne_id`, v1.ID, res2.Version.ID); n != 0 {
		t.Errorf("%d lignes rattachées à une autre personne au ré-import", n)
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
	if res.Version.Layout != "mixte" || res.Version.NbDrop != 4 || res.Version.NbLignes != 7 || res.Version.NbWarn != 4 {
		t.Fatalf("version %+v", res.Version)
	}
	// Sans groupe : « Squad Alpha » / « Squad Beta » deviennent des squads.
	if n := count(t, st, `SELECT COUNT(*) FROM squads WHERE nom_canonique IN ('Squad Alpha','Squad Beta')`); n != 2 {
		t.Errorf("%d squads libellé", n)
	}
	// DUPONT Jean, MARTIN Léa, PETIT Paul, ONE Ext ; pas de personne pour les lignes
	// non nominatives ni pour les lignes rejetées.
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != 4 {
		t.Errorf("%d personnes", n)
	}
	if dn := str(t, st, `SELECT p.display_name FROM personnes p JOIN plan_lines l ON l.personne_id = p.id WHERE l.ressource = 'R_002'`); dn != "MARTIN Léa" {
		t.Errorf("R_002 → %q", dn)
	}
	// Ligne 11 : ressource vide, plus rejetée (warn), non nominative.
	if st11 := str(t, st, `SELECT statut_parsing || '|' || nom_prenom || '|' || COALESCE(personne_id, '-') FROM plan_lines WHERE row_num = 11`); st11 != "warn||-" {
		t.Errorf("ligne 11 %q", st11)
	}
}

// specRow: one layout A line of a spec-format file.
func specRow(ct, ress, libelle string, charge any) []any {
	return []any{ct, ress, libelle, "Standard", "MAIN D'OEUVRE SUR SITE", charge, 0, 20, "U_0001", "Dates fixes", 46266, 46356}
}

// Identité = NOM + Prénom (DECISIONS n° 8) : une personne est retrouvée par sa
// clé d'un import à l'autre, quels que soient le code Ressource et l'ordre des
// mots du libellé ; une ligne rejetée ne crée personne mais se rattache à une
// personne connue.
func TestServicePersonnesParCle(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)
	svc := NewService(st)
	file1 := buildSpecXLSX(t, "Plan de charge", specHeader, [][]any{
		specRow("CT1", "DURANDC", "DURAND Claire", 10),
		specRow("CT2", "", "DURAND CLAIRE", 10), // même clé (tout en majuscules), code vide
		specRow("CT1", "XX", "PO", 10),          // non nominative
		specRow("CT3", "R1", "MARTIN Léa", -1),  // rejetée, inconnue : pas de création
	})
	res1, err := svc.Commit(ctx, file1, "p1.xlsx", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(res1.Report.NouvellesPersonnes, ","); got != "DURAND Claire" {
		t.Fatalf("créées %q", got)
	}
	durand := str(t, st, `SELECT id FROM personnes WHERE nom_normalise = 'DURAND|CLAIRE'`)
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ? AND personne_id = ?`, res1.Version.ID, durand); n != 2 {
		t.Errorf("DURAND sur %d lignes", n)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != 1 {
		t.Errorf("%d personnes", n)
	}
	// Fiche validée renommée par l'utilisateur : nom d'affichage conservé.
	if _, err := st.DB().Exec(`UPDATE personnes SET display_name = 'DURAND Claire (PMO)', statut = 'validee' WHERE id = ?`, durand); err != nil {
		t.Fatal(err)
	}

	file2 := buildSpecXLSX(t, "Plan de charge", specHeader, [][]any{
		specRow("CT9", "AUTRE", "Claire Durand / Squad X", 5), // ordre <Prénom NOM>, autre code
		specRow("CT9", "R1", "MARTIN Léa", 5),
		specRow("CT8", "R9", "DURAND Claire", -1), // rejetée, connue : rattachée
	})
	rep, err := svc.Preview(ctx, file2, "p2.xlsx", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(rep.NouvellesPersonnes, ","); got != "MARTIN Léa" {
		t.Fatalf("preview créées %q", got)
	}
	res2, err := svc.Commit(ctx, file2, "p2.xlsx", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM plan_lines WHERE version_id = ? AND personne_id = ?`, res2.Version.ID, durand); n != 2 {
		t.Errorf("DURAND retrouvée sur %d lignes (attendu 2, dont la rejetée)", n)
	}
	if dn := str(t, st, `SELECT display_name FROM personnes WHERE id = ?`, durand); dn != "DURAND Claire (PMO)" {
		t.Errorf("display_name validé écrasé : %q", dn)
	}
	if n := count(t, st, `SELECT COUNT(*) FROM personnes`); n != 2 {
		t.Errorf("%d personnes", n)
	}
	if d := str(t, st, `SELECT details FROM audit_log WHERE action = 'referentiel_import' AND objet_id = ?`, res2.Version.ID); d != "personnes créées=1 squads créés=1" {
		t.Errorf("audit %q", d)
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
	if p = lines("?q=DURANDC"); p.Total != 0 { // le code Ressource n'est plus cherché
		t.Errorf("q=code → %d", p.Total)
	}
	if p = lines("?nom_prenom=" + url.QueryEscape("DURAND Claire")); p.Total != 2 || p.Items[0].RowNum != 8 || p.Items[1].RowNum != 36 {
		t.Errorf("nom_prenom → %d", p.Total)
	}
	if p = lines("?sort=nom_prenom&limit=1"); p.Items[0].NomPrenom != "" {
		t.Errorf("tri nom_prenom asc %q", p.Items[0].NomPrenom)
	}
	if p = lines("?sort=nom_prenom&order=desc&limit=1"); p.Items[0].NomPrenom != "SANTOS Alice" {
		t.Errorf("tri nom_prenom desc %q", p.Items[0].NomPrenom)
	}
	if p = lines("?statut=warn"); p.Total != 5 || p.Items[0].RowNum != 50 {
		t.Errorf("statut=warn → %d", p.Total)
	}
	if p = lines("?inactive=false"); p.Total != 35 {
		t.Errorf("inactive=false → %d", p.Total)
	}
	if p = lines("?inactive=true"); p.Total != 1 || p.Items[0].RowNum != 23 {
		t.Errorf("inactive=true → %d", p.Total)
	}
	if p = lines("?ligne_cout=Stockage"); p.Total != 1 {
		t.Errorf("ligne_cout → %d", p.Total)
	}
	// Chevauchement : seule la ligne 12 (fin 46325 = 2026-10-30) est exclue.
	if p = lines("?date_from=2026-11-01&date_to=2026-12-31"); p.Total != 35 {
		t.Errorf("date_from → %d", p.Total)
	}
	for _, s := range []string{"foo", "ressource"} {
		if w := do(r, http.MethodGet, "/api/plan/versions/"+id+"/lines?sort="+s, ""); w.Code != http.StatusBadRequest {
			t.Errorf("sort %s invalide %d", s, w.Code)
		}
	}
	if w := do(r, http.MethodGet, "/api/plan/versions/nope/lines", ""); w.Code != http.StatusNotFound {
		t.Errorf("version inconnue %d", w.Code)
	}

	// Facets + filtre squad.
	w = do(r, http.MethodGet, "/api/plan/versions/"+id+"/facets", "")
	f := decode[domain.Facets](t, w)
	if len(f["ct"]) != 12 || len(f["squad_id"]) != 8 || len(f["statut"]) != 2 || len(f["nom_prenom"]) != 25 || f["ressource"] != nil {
		t.Errorf("facets ct=%d squad=%d statut=%v noms=%d", len(f["ct"]), len(f["squad_id"]), f["statut"], len(f["nom_prenom"]))
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
	if recs[0] != "\xef\xbb\xbfrow_num;statut_parsing;motif_rejet;ct;ressource;libelle;nom_prenom;type_affectation;ligne_cout;charge_totale;pps;pourcentage;unite;calcul_duree;date_debut;date_fin;inactive;groupe" {
		t.Errorf("csv en-tête %q", recs[0])
	}
	if len(recs) != 32 { // en-tête + 31 lignes ok
		t.Errorf("csv %d lignes", len(recs))
	}
	if !strings.Contains(recs[1], "8;ok;;Y99F90001;DURANDC;DURAND Claire / Squad Alpha;DURAND Claire;Standard;MAIN D'OEUVRE SUR SITE;219;25093.02;40;U9AAA1;Dates fixes;2026-09-01;2026-11-30;false;Squad Alpha — Plateforme > Alpha Core Team") {
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
