package enveloppe

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/store"
)

type env struct {
	t   *testing.T
	st  *store.Store
	r   *gin.Engine
	now time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	e := &env{t: t, st: st, now: time.Date(2026, 10, 9, 9, 0, 0, 0, time.UTC)}
	st.Now = func() time.Time { return e.now }
	gin.SetMode(gin.TestMode)
	e.r = gin.New()
	New(st).Register(e.r.Group("/api"))
	return e
}

func (e *env) exec(q string, args ...any) {
	e.t.Helper()
	if _, err := e.st.DB().Exec(q, args...); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
}

func (e *env) do(method, path string) *httptest.ResponseRecorder {
	e.t.Helper()
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

// upload posts a multipart form; data = nil → no file field.
func (e *env) upload(path, filename string, data []byte, fields map[string]string) *httptest.ResponseRecorder {
	e.t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if data != nil {
		fw, _ := w.CreateFormFile("file", filename)
		fw.Write(data)
	}
	for k, v := range fields {
		w.WriteField(k, v)
	}
	w.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, req)
	return rec
}

func (e *env) count(q string) int {
	e.t.Helper()
	var n int
	if err := e.st.DB().QueryRow(q).Scan(&n); err != nil {
		e.t.Fatalf("%s: %v", q, err)
	}
	return n
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder, status int) T {
	t.Helper()
	var v T
	if rec.Code != status {
		t.Fatalf("status %d attendu %d: %s", rec.Code, status, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("json: %v — %s", err, rec.Body.String())
	}
	return v
}

func (e *env) version(id, kind, statut, importee string) {
	e.exec(`INSERT INTO versions(id, kind, intitule, importee_le, statut) VALUES (?,?,?,?,?)`, id, kind, id, importee, statut)
}

func (e *env) plan(v string, row int, ct, groupe, statut string) {
	e.exec(`INSERT INTO plan_lines(version_id, row_num, ct, groupe, statut_parsing) VALUES (?,?,?,?,?)`, v, row, ct, groupe, statut)
}

func (e *env) realise(v string, row int, tg, lib, statut string) {
	e.exec(`INSERT INTO realise_entries(version_id, row_num, tg, tg_libelle, statut_parsing) VALUES (?,?,?,?,?)`, v, row, tg, lib, statut)
}

func (e *env) provision(v string, row int, ct, groupe, statut string) {
	e.exec(`INSERT INTO provision_lines(version_id, row_num, ct, groupe, statut_parsing) VALUES (?,?,?,?,?)`, v, row, ct, groupe, statut)
}

// seed: un CT par cas de source et de libellé.
func (e *env) seed() {
	e.version("plan1", "plan", "active", "2026-10-01T10:00:00Z")
	e.version("plan0", "plan", "archivee", "2026-09-01T10:00:00Z")
	e.version("plan9", "plan", "purgee", "2026-08-01T10:00:00Z")
	e.version("real1", "realise", "active", "2026-10-01T10:00:00Z")
	e.version("real0", "realise", "archivee", "2026-09-01T10:00:00Z")
	e.version("prov1", "provision", "active", "2026-10-01T10:00:00Z")
	e.version("prov0", "provision", "archivee", "2026-09-01T10:00:00Z")

	e.plan("plan1", 4, "A1", "Plan A1", "ok")
	e.plan("plan1", 5, " B2 ", "Plan B2", "warn")
	e.plan("plan1", 6, "C3", "Plan C3", "ok")
	e.plan("plan1", 7, "D4", "Plan D4", "drop") // rejetée : D4 absent
	e.plan("plan1", 8, "  ", "Sans CT", "ok")   // CT vide ignoré
	e.plan("plan0", 4, "Z0", "  Plan Z0  ", "ok")
	e.plan("plan0", 5, "A1", "Ancien plan A1", "ok")
	e.plan("plan9", 4, "P9", "Purgé", "ok") // version purgée : P9 absent

	e.realise("real1", 2, "A1", "A1 - Réalisé A1", "ok")
	e.realise("real1", 3, "A1", "A1 - Autre libellé", "ok")
	e.realise("real1", 4, "B2", "  ", "ok") // libellé vide : repli sur les provisions
	e.realise("real1", 5, "C3", " C3 ", "ok")
	e.realise("real1", 6, "R5", "R5 - Rejeté", "drop")
	e.realise("real0", 2, "AR", "AR - Archivé", "ok")

	e.provision("prov1", 5, "A1", "Programme > Prov A1", "ok")
	e.provision("prov1", 6, "B2", "Programme > Prov B2 ", "ok")
	e.provision("prov1", 7, "Q7", "", "warn")
	e.provision("prov1", 8, "D4", "Programme > Rejetée", "drop")
	e.provision("prov0", 5, "PA", "Programme > Archivée", "ok")
}

func byCT(list []domain.EnveloppeCT) map[string]domain.EnveloppeCT {
	m := map[string]domain.EnveloppeCT{}
	for _, x := range list {
		m[x.CT] = x
	}
	return m
}

func ctsOf(list []domain.EnveloppeCT) string {
	cts := []string{}
	for _, x := range list {
		cts = append(cts, x.CT)
	}
	return strings.Join(cts, ",")
}

type apiError struct{ Code, Message string }

func errCode(t *testing.T, rec *httptest.ResponseRecorder, status int) string {
	t.Helper()
	var r struct{ Error apiError }
	json.Unmarshal(rec.Body.Bytes(), &r)
	if rec.Code != status || r.Error.Message == "" {
		t.Fatalf("status %d attendu %d: %s", rec.Code, status, rec.Body.String())
	}
	return r.Error.Code
}

// fileA : K1 hors catégorie, catégorie Y20000 (C3, N1), catégorie Y10000 (Z0), A1 sans période.
func fileA(t *testing.T) []byte {
	return buildXLSX(t, "Activité sans archive", withBanner(
		row("K1", "Hors catégorie", 46023, 46387, 100),          // 4 : warn
		categ("Y20000", "Catégorie Z"),                          // 5
		row("C3", "Ct C3", 46023, 46387, 3000),                  // 6
		row("N1", "Seulement dans le fichier", 46023, 46387, 0), // 7
		categ("Y10000", "Catégorie A"),                          // 8
		row("Z0", "Ct Z0", "2026-02-01", "2026-06-30", 1200.5),  // 9
		row("A1", "Ct A1", nil, nil, 0),                         // 10 : drop
	))
}

// fileB : Z0 seul dans sa catégorie, C3 désormais hors catégorie.
func fileB(t *testing.T) []byte {
	return buildXLSX(t, "Activité sans archive", withBanner(
		row("C3", "Ct C3", 46023, 46387, 3500),
		categ("Y10000", "Catégorie A"),
		row("Z0", "Ct Z0", 46023, 46387, 900),
	))
}

func TestListEmpty(t *testing.T) {
	e := newEnv(t)
	rec := e.do("GET", "/api/enveloppes")
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != `{"import":null,"cts":[]}` {
		t.Fatalf("liste vide: %d %s", rec.Code, rec.Body.String())
	}
}

func TestListUnionSourcesLabels(t *testing.T) {
	e := newEnv(t)
	e.seed()
	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	if l.Import != nil || ctsOf(l.CTs) != "A1,B2,C3,Q7,Z0" {
		t.Fatalf("CT (union triée, purgée/archivée/rejetées exclues): %v %+v", ctsOf(l.CTs), l.Import)
	}
	want := map[string]struct {
		lib string
		src domain.EnveloppeSources
	}{
		"A1": {"Réalisé A1", domain.EnveloppeSources{Plan: true, Realise: true, Provisions: true}},
		"B2": {"Prov B2", domain.EnveloppeSources{Plan: true, Realise: true, Provisions: true}},
		"C3": {"C3", domain.EnveloppeSources{Plan: true, Realise: true}},
		"Q7": {"", domain.EnveloppeSources{Provisions: true}},
		"Z0": {"Plan Z0", domain.EnveloppeSources{Plan: true}},
	}
	for _, x := range l.CTs {
		w := want[x.CT]
		if x.CTLibelle != w.lib || x.Sources != w.src || x.Enveloppe != nil || x.Categorie != "" {
			t.Errorf("%s: %+v, attendu libellé %q sources %+v", x.CT, x, w.lib, w.src)
		}
	}
}

func TestPreviewWritesNothing(t *testing.T) {
	e := newEnv(t)
	e.seed()
	rep := decode[domain.ImportReport](t, e.upload("/api/enveloppes/import/preview", "cat.xlsx", fileA(t), nil), 200)
	if rep.Kind != domain.KindEnveloppe || rep.Filename != "cat.xlsx" || rep.SourceFormat != SourceFormat ||
		rep.SheetName != "Activité sans archive" || rep.HeaderRow != 3 || rep.Total != 5 || rep.OK != 3 || rep.Warn != 1 || rep.Drop != 1 ||
		rep.PeriodeDebut != "2026-01-01" || rep.PeriodeFin != "2026-12-31" || rep.MontantTotalEur == nil || *rep.MontantTotalEur != 4300.5 ||
		rep.ActiveVersion != nil || rep.MotifsCount[motifPeriode] != 1 || rep.MotifsCount[motifHorsCateg] != 1 || len(rep.Issues) != 2 {
		t.Fatalf("bilan: %+v", rep)
	}
	if n := e.count(`SELECT COUNT(*) FROM enveloppes`) + e.count(`SELECT COUNT(*) FROM enveloppes_import`) + e.count(`SELECT COUNT(*) FROM audit_log`); n != 0 {
		t.Fatalf("l'aperçu ne doit rien écrire: %d", n)
	}
}

func TestImportThenReimport(t *testing.T) {
	e := newEnv(t)
	e.seed()
	rep := decode[domain.ImportReport](t, e.upload("/api/enveloppes/import", "cat A.xlsx", fileA(t), map[string]string{"importeur": "alice"}), 200)
	if rep.Kind != domain.KindEnveloppe || rep.OK != 3 || rep.Warn != 1 || rep.Drop != 1 {
		t.Fatalf("bilan: %+v", rep)
	}

	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	// Catégorie Y10000 (Z0), Y20000 (C3, N1), hors catégorie (K1), hors fichier (A1, B2, Q7).
	if got := ctsOf(l.CTs); got != "Z0,C3,N1,K1,A1,B2,Q7" {
		t.Fatalf("ordre: %s", got)
	}
	if imp := l.Import; imp == nil || imp.Filename != "cat A.xlsx" || imp.Operateur != "alice" || imp.NbEnveloppes != 4 || !imp.ImporteLe.Equal(e.now) {
		t.Fatalf("import: %+v", l.Import)
	}
	m := byCT(l.CTs)
	if z := m["Z0"]; z.Categorie != "Y10000" || z.CategorieLibelle != "Catégorie A" || z.CTLibelle != "Plan Z0" || !z.Sources.Plan ||
		z.Enveloppe == nil || *z.Enveloppe != (domain.Enveloppe{DateDebut: "2026-02-01", DateFin: "2026-06-30", Montant: 1200.5}) {
		t.Errorf("Z0: %+v %+v", z, z.Enveloppe)
	}
	if n := m["N1"]; n.Categorie != "Y20000" || n.Sources != (domain.EnveloppeSources{}) || n.CTLibelle != "" || n.Enveloppe == nil || n.Enveloppe.Montant != 0 {
		t.Errorf("N1 (fichier seul): %+v", n)
	}
	if k := m["K1"]; k.Categorie != "" || k.Enveloppe == nil || k.Enveloppe.Montant != 100 {
		t.Errorf("K1 (hors catégorie): %+v", k)
	}
	if a := m["A1"]; a.Enveloppe != nil || a.Categorie != "" || a.CTLibelle != "Réalisé A1" {
		t.Errorf("A1 (rejeté → hors fichier): %+v", a)
	}

	// Ré-import : tout est remplacé ; N1 et K1 disparaissent (aucune source), C3 passe hors catégorie.
	e.now = e.now.Add(time.Hour)
	decode[domain.ImportReport](t, e.upload("/api/enveloppes/import", "cat B.xlsx", fileB(t), nil), 200)
	l = decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	if got := ctsOf(l.CTs); got != "Z0,C3,A1,B2,Q7" {
		t.Fatalf("ordre après ré-import: %s", got)
	}
	m = byCT(l.CTs)
	if c := m["C3"]; c.Categorie != "" || c.CategorieLibelle != "" || c.Enveloppe == nil || c.Enveloppe.Montant != 3500 {
		t.Errorf("C3: %+v", c)
	}
	if z := m["Z0"]; z.Enveloppe == nil || z.Enveloppe.Montant != 900 || z.Enveloppe.DateDebut != "2026-01-01" {
		t.Errorf("Z0: %+v", z)
	}
	if imp := l.Import; imp == nil || imp.Filename != "cat B.xlsx" || imp.Operateur != "local" || imp.NbEnveloppes != 2 || !imp.ImporteLe.Equal(e.now) {
		t.Fatalf("import: %+v", l.Import)
	}
	if n := e.count(`SELECT COUNT(*) FROM enveloppes`); n != 2 {
		t.Fatalf("enveloppes: %d", n)
	}

	audit, err := e.st.ListAudit(context.Background(), "enveloppe", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(audit) != 2 || audit[0].Action != "import" || audit[0].ObjetID != "cat B.xlsx" || audit[0].Details != "2 enveloppes" ||
		audit[0].Operateur != "local" || audit[1].ObjetID != "cat A.xlsx" || audit[1].Details != "4 enveloppes" || audit[1].Operateur != "alice" {
		t.Fatalf("journal: %+v", audit)
	}
}

func TestImportWithoutValidRows(t *testing.T) {
	e := newEnv(t)
	decode[domain.ImportReport](t, e.upload("/api/enveloppes/import", "a.xlsx", fileA(t), nil), 200)
	bad := buildXLSX(t, "Activité sans archive", withBanner(
		categ("Y10000", "Catégorie A"),
		row("Z0", "Ct Z0", nil, nil, 0),
		row("Z1", "Ct Z1", 46387, 46023, 10),
	))
	rep := decode[domain.ImportReport](t, e.upload("/api/enveloppes/import/preview", "bad.xlsx", bad, nil), 200)
	if rep.Total != 2 || rep.Drop != 2 || rep.OK != 0 || rep.PeriodeDebut != "" || *rep.MontantTotalEur != 0 {
		t.Fatalf("aperçu: %+v", rep)
	}
	if c := errCode(t, e.upload("/api/enveloppes/import", "bad.xlsx", bad, nil), 422); c != CodeNoEnveloppe {
		t.Fatalf("code: %s", c)
	}
	// Les enveloppes précédentes sont conservées.
	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	if l.Import == nil || l.Import.Filename != "a.xlsx" || e.count(`SELECT COUNT(*) FROM enveloppes`) != 4 || e.count(`SELECT COUNT(*) FROM audit_log`) != 1 {
		t.Fatalf("état après refus: %+v", l.Import)
	}
}

func TestImportErrors(t *testing.T) {
	e := newEnv(t)
	for _, path := range []string{"/api/enveloppes/import/preview", "/api/enveloppes/import"} {
		if c := errCode(t, e.upload(path, "", nil, nil), 400); c != "bad_request" {
			t.Errorf("%s sans fichier: %s", path, c)
		}
		if c := errCode(t, e.upload(path, "x.xlsx", []byte("pas un xlsx"), nil), 422); c != CodeFileInvalid {
			t.Errorf("%s illisible: %s", path, c)
		}
		other := buildXLSX(t, "Feuil1", [][]any{{"Nom", "Date de début Contrôles de mouvement", "Montant"}, {"A1", 46023, 1}})
		if c := errCode(t, e.upload(path, "x.xlsx", other, nil), 422); c != CodeHeaderInvalid {
			t.Errorf("%s en-tête: %s", path, c)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM enveloppes_import`) + e.count(`SELECT COUNT(*) FROM audit_log`); n != 0 {
		t.Fatalf("rien ne doit être écrit: %d", n)
	}
}

// Les anciennes routes de saisie n'existent plus.
func TestNoManualEntry(t *testing.T) {
	e := newEnv(t)
	for _, m := range []string{"PUT", "DELETE"} {
		if rec := e.do(m, "/api/enveloppes/A1"); rec.Code != 404 {
			t.Errorf("%s: %d", m, rec.Code)
		}
	}
}
