package enveloppe

import (
	"context"
	"encoding/json"
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

// put sends PUT /api/enveloppes/:ct with a raw JSON body and optional headers.
func (e *env) put(ct, body string, headers ...string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest("PUT", "/api/enveloppes/"+ct, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, req)
	return rec
}

func (e *env) audit() []domain.AuditEntry {
	e.t.Helper()
	a, err := e.st.ListAudit(context.Background(), "enveloppe", 0)
	if err != nil {
		e.t.Fatal(err)
	}
	return a
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

func TestListEmpty(t *testing.T) {
	e := newEnv(t)
	rec := e.do("GET", "/api/enveloppes")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"cts":[]`) {
		t.Fatalf("liste vide: %d %s", rec.Code, rec.Body.String())
	}
}

func TestListUnionSourcesLabels(t *testing.T) {
	e := newEnv(t)
	e.seed()
	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	if ctsOf(l.CTs) != "A1,B2,C3,Q7,Z0" {
		t.Fatalf("CT (union triée, purgée/archivée/rejetées exclues): %v", ctsOf(l.CTs))
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
		if x.CTLibelle != w.lib || x.Sources != w.src || x.Enveloppe != nil || x.Categorie != "" || x.CategorieLibelle != "" {
			t.Errorf("%s: %+v, attendu libellé %q sources %+v", x.CT, x, w.lib, w.src)
		}
	}
}

// Union des sources et des enveloppes ; tri par libellé de catégorie (sans
// accents ni casse) puis CT, hors catégorie puis sans enveloppe en dernier.
func TestListWithEnveloppesSorted(t *testing.T) {
	e := newEnv(t)
	e.seed()
	ins := func(ct, code, lib string) {
		e.exec(`INSERT INTO enveloppes(ct, categorie, categorie_libelle, date_debut, date_fin, montant) VALUES (?,?,?,?,?,?)`,
			ct, code, lib, "2026-01-01", "2026-12-31", 10)
	}
	ins("Z0", "", "écart")      // folded « ecart »
	ins("C3", "Y20000", "Beta") // code hérité de l'import
	ins("N1", "", "alpha")      // CT présent dans les seules enveloppes
	ins("K1", "", "")           // hors catégorie
	ins("A1", "", "Beta")
	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	if got := ctsOf(l.CTs); got != "N1,A1,C3,Z0,K1,B2,Q7" {
		t.Fatalf("ordre: %s", got)
	}
	m := byCT(l.CTs)
	if n := m["N1"]; n.Sources != (domain.EnveloppeSources{}) || n.CTLibelle != "" || n.Enveloppe == nil || n.CategorieLibelle != "alpha" {
		t.Errorf("N1 (enveloppe seule): %+v", n)
	}
	if c := m["C3"]; c.Categorie != "Y20000" || c.CategorieLibelle != "Beta" || !c.Sources.Plan ||
		c.Enveloppe == nil || *c.Enveloppe != (domain.Enveloppe{DateDebut: "2026-01-01", DateFin: "2026-12-31", Montant: 10}) {
		t.Errorf("C3: %+v", c)
	}
}

func TestPutCreate(t *testing.T) {
	e := newEnv(t)
	e.seed()
	x := decode[domain.EnveloppeCT](t, e.put("A1",
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":1200.5,"categorie":"  Catégorie A ","operateur":"alice"}`), 200)
	if x.CT != "A1" || x.CTLibelle != "Réalisé A1" || x.Categorie != "" || x.CategorieLibelle != "Catégorie A" ||
		x.Sources != (domain.EnveloppeSources{Plan: true, Realise: true, Provisions: true}) ||
		x.Enveloppe == nil || *x.Enveloppe != (domain.Enveloppe{DateDebut: "2026-01-01", DateFin: "2026-12-31", Montant: 1200.5}) {
		t.Fatalf("A1: %+v %+v", x, x.Enveloppe)
	}
	// CT inconnu des sources, hors catégorie, montant nul.
	n := decode[domain.EnveloppeCT](t, e.put("N1", `{"date_debut":"2027-01-01","date_fin":"2027-01-01","montant":0}`), 200)
	if n.CT != "N1" || n.Sources != (domain.EnveloppeSources{}) || n.CategorieLibelle != "" || n.Enveloppe == nil || n.Enveloppe.Montant != 0 {
		t.Fatalf("N1: %+v", n)
	}
	a := e.audit()
	if len(a) != 2 || a[1].Action != "create" || a[1].ObjetType != "enveloppe" || a[1].ObjetID != "A1" || a[1].Operateur != "alice" ||
		a[1].Details != "champs : date_debut, date_fin, montant, categorie" ||
		a[0].Action != "create" || a[0].ObjetID != "N1" || a[0].Operateur != "local" || a[0].Details != "champs : date_debut, date_fin, montant" {
		t.Fatalf("journal: %+v", a)
	}
	if e.count(`SELECT COUNT(*) FROM enveloppes`) != 2 {
		t.Fatal("2 enveloppes attendues")
	}
}

func TestPutUpdateAndNoop(t *testing.T) {
	e := newEnv(t)
	e.seed()
	body := `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":5000,"categorie":"Cat"}`
	decode[domain.EnveloppeCT](t, e.put("C3", body), 200)

	upd := `{"date_debut":"2026-01-01","date_fin":"2026-06-30","montant":7300.25,"categorie":"Cat"}`
	x := decode[domain.EnveloppeCT](t, e.put("C3", upd, "X-User", "bob"), 200)
	if x.Enveloppe == nil || *x.Enveloppe != (domain.Enveloppe{DateDebut: "2026-01-01", DateFin: "2026-06-30", Montant: 7300.25}) || x.CategorieLibelle != "Cat" {
		t.Fatalf("C3: %+v %+v", x, x.Enveloppe)
	}
	a := e.audit()
	if len(a) != 2 || a[0].Action != "update" || a[0].ObjetID != "C3" || a[0].Operateur != "bob" || a[0].Details != "champs : date_fin, montant" {
		t.Fatalf("journal: %+v", a)
	}
	for _, d := range a {
		if strings.ContainsAny(d.Details, "0123456789") {
			t.Errorf("montant ou date dans le journal: %q", d.Details)
		}
	}

	// Aucun changement : 200, rien de journalisé.
	x = decode[domain.EnveloppeCT](t, e.put("C3", upd), 200)
	if x.Enveloppe == nil || x.Enveloppe.Montant != 7300.25 || len(e.audit()) != 2 {
		t.Fatalf("no-op: %+v, journal %d", x, len(e.audit()))
	}

	// Changement de catégorie seule (vers hors catégorie).
	decode[domain.EnveloppeCT](t, e.put("C3", `{"date_debut":"2026-01-01","date_fin":"2026-06-30","montant":7300.25}`), 200)
	if a := e.audit(); len(a) != 3 || a[0].Action != "update" || a[0].Details != "champs : categorie" {
		t.Fatalf("journal: %+v", a)
	}
}

func TestPutValidation(t *testing.T) {
	e := newEnv(t)
	ok := `"date_debut":"2026-01-01","date_fin":"2026-12-31"`
	cases := map[string]struct{ ct, body string }{
		"corps vide":       {"A1", ``},
		"JSON invalide":    {"A1", `{`},
		"montant texte":    {"A1", `{` + ok + `,"montant":"10"}`},
		"montant absent":   {"A1", `{` + ok + `}`},
		"montant null":     {"A1", `{` + ok + `,"montant":null}`},
		"montant négatif":  {"A1", `{` + ok + `,"montant":-0.01}`},
		"début absent":     {"A1", `{"date_fin":"2026-12-31","montant":1}`},
		"début non ISO":    {"A1", `{"date_debut":"01/01/2026","date_fin":"2026-12-31","montant":1}`},
		"début sans zéro":  {"A1", `{"date_debut":"2026-1-01","date_fin":"2026-12-31","montant":1}`},
		"début avec heure": {"A1", `{"date_debut":"2026-01-01T00:00:00Z","date_fin":"2026-12-31","montant":1}`},
		"fin impossible":   {"A1", `{"date_debut":"2026-01-01","date_fin":"2026-02-30","montant":1}`},
		"fin avant début":  {"A1", `{"date_debut":"2026-06-01","date_fin":"2026-05-31","montant":1}`},
		"CT vide":          {"%20", `{` + ok + `,"montant":1}`},
	}
	for name, c := range cases {
		if code := errCode(t, e.put(c.ct, c.body), 400); code != "bad_request" {
			t.Errorf("%s: %s", name, code)
		}
	}
	if n := e.count(`SELECT COUNT(*) FROM enveloppes`) + e.count(`SELECT COUNT(*) FROM audit_log`); n != 0 {
		t.Fatalf("rien ne doit être écrit: %d", n)
	}
	// Bornes acceptées : fin = début, montant nul, CT avec espaces autour.
	x := decode[domain.EnveloppeCT](t, e.put("%20A1%20", `{"date_debut":"2026-03-01","date_fin":"2026-03-01","montant":0}`), 200)
	if x.CT != "A1" {
		t.Fatalf("CT: %+v", x)
	}
}

// Le code de catégorie hérité de l'import est repris d'une enveloppe de même libellé.
func TestPutCategoryCodeReuse(t *testing.T) {
	e := newEnv(t)
	e.exec(`INSERT INTO enveloppes(ct, categorie, categorie_libelle, date_debut, date_fin, montant) VALUES
		('OLD', 'Y10000', 'Catégorie A', '2026-01-01', '2026-12-31', 100)`)
	b := func(cat string) string {
		return `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":1,"categorie":` + cat + `}`
	}
	x := decode[domain.EnveloppeCT](t, e.put("NEW", b(`"  catégorie   A "`)), 200)
	if x.Categorie != "Y10000" || x.CategorieLibelle != "catégorie   A" {
		t.Fatalf("même libellé (casse, espaces): %+v", x)
	}
	if x = decode[domain.EnveloppeCT](t, e.put("NEW", b(`"Nouvelle"`)), 200); x.Categorie != "" || x.CategorieLibelle != "Nouvelle" {
		t.Fatalf("nouveau libellé: %+v", x)
	}
	if x = decode[domain.EnveloppeCT](t, e.put("OLD", b(`"Catégorie A"`)), 200); x.Categorie != "Y10000" {
		t.Fatalf("propre code conservé: %+v", x)
	}
	if x = decode[domain.EnveloppeCT](t, e.put("OLD", b(`""`)), 200); x.Categorie != "" || x.CategorieLibelle != "" {
		t.Fatalf("hors catégorie: %+v", x)
	}
}

func TestDelete(t *testing.T) {
	e := newEnv(t)
	e.seed()
	decode[domain.EnveloppeCT](t, e.put("A1", `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":10}`), 200)
	decode[domain.EnveloppeCT](t, e.put("N1", `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":10}`), 200)

	if rec := e.do("DELETE", "/api/enveloppes/A1?operateur=carol"); rec.Code != 204 || rec.Body.Len() != 0 {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.do("DELETE", "/api/enveloppes/N1"); rec.Code != 204 {
		t.Fatalf("delete N1: %d", rec.Code)
	}
	l := decode[domain.EnveloppesListe](t, e.do("GET", "/api/enveloppes"), 200)
	// A1 reste (sources), sans enveloppe ; N1 (enveloppe seule) disparaît.
	if got := ctsOf(l.CTs); got != "A1,B2,C3,Q7,Z0" || byCT(l.CTs)["A1"].Enveloppe != nil {
		t.Fatalf("liste: %s %+v", got, byCT(l.CTs)["A1"])
	}
	a := e.audit()
	if len(a) != 4 || a[1].Action != "delete" || a[1].ObjetID != "A1" || a[1].Operateur != "carol" ||
		a[0].Action != "delete" || a[0].ObjetID != "N1" || a[0].Operateur != "local" {
		t.Fatalf("journal: %+v", a)
	}

	// CT sans enveloppe (connu ou non des sources) : 404, rien de journalisé.
	for _, ct := range []string{"A1", "B2", "XX"} {
		if c := errCode(t, e.do("DELETE", "/api/enveloppes/"+ct), 404); c != "not_found" {
			t.Errorf("%s: %s", ct, c)
		}
	}
	if len(e.audit()) != 4 {
		t.Fatal("aucun audit attendu pour un 404")
	}
}

// Plus d'import de fichier.
func TestNoImportRoutes(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/api/enveloppes/import/preview", "/api/enveloppes/import"} {
		if rec := e.do("POST", p); rec.Code != 404 {
			t.Errorf("%s: %d", p, rec.Code)
		}
	}
}
