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

func (e *env) do(method, path, body string, header ...string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	e.r.ServeHTTP(rec, req)
	return rec
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

func TestListEmpty(t *testing.T) {
	e := newEnv(t)
	rec := e.do("GET", "/api/enveloppes", "")
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("liste vide: %d %s", rec.Code, rec.Body.String())
	}
}

func TestListUnionSourcesLabels(t *testing.T) {
	e := newEnv(t)
	e.seed()
	list := decode[[]domain.EnveloppeCT](t, e.do("GET", "/api/enveloppes", ""), 200)
	cts := []string{}
	for _, x := range list {
		cts = append(cts, x.CT)
	}
	if strings.Join(cts, ",") != "A1,B2,C3,Q7,Z0" {
		t.Fatalf("CT (union triée, purgée/archivée/rejetées exclues): %v", cts)
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
	for _, x := range list {
		w := want[x.CT]
		if x.CTLibelle != w.lib || x.Sources != w.src || x.Enveloppe != nil {
			t.Errorf("%s: %+v, attendu libellé %q sources %+v", x.CT, x, w.lib, w.src)
		}
	}
}

func TestPutValidation(t *testing.T) {
	e := newEnv(t)
	e.seed()
	for _, body := range []string{
		``,
		`{`,
		`{"date_fin":"2026-12-31","montant":10}`,
		`{"date_debut":"2026-01-01","montant":10}`,
		`{"date_debut":"2026-13-01","date_fin":"2026-12-31","montant":10}`,
		`{"date_debut":"01/01/2026","date_fin":"2026-12-31","montant":10}`,
		`{"date_debut":"2026-12-31","date_fin":"2026-01-01","montant":10}`,
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31"}`,
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":null}`,
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":-1}`,
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":"10"}`,
	} {
		rec := e.do("PUT", "/api/enveloppes/A1", body)
		var r struct{ Error apiError }
		json.Unmarshal(rec.Body.Bytes(), &r)
		if rec.Code != 400 || r.Error.Code != "bad_request" || r.Error.Message == "" {
			t.Errorf("%s → %d %s", body, rec.Code, rec.Body.String())
		}
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM ct_enveloppes`).Scan(&n)
	if n != 0 {
		t.Fatalf("rien ne doit être écrit: %d", n)
	}
}

type apiError struct{ Code, Message string }

func TestPutUnknownCT(t *testing.T) {
	e := newEnv(t)
	e.seed()
	for _, ct := range []string{"XX", "P9", "AR", "D4", "PA"} {
		rec := e.do("PUT", "/api/enveloppes/"+ct, `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":10}`)
		if rec.Code != 404 || !strings.Contains(rec.Body.String(), "not_found") {
			t.Errorf("%s: %d %s", ct, rec.Code, rec.Body.String())
		}
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM ct_enveloppes`).Scan(&n)
	if n != 0 {
		t.Fatalf("rien ne doit être écrit: %d", n)
	}
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM audit_log`).Scan(&n)
	if n != 0 {
		t.Fatalf("rien ne doit être journalisé: %d", n)
	}
}

func TestPutUpsertThenUpdate(t *testing.T) {
	e := newEnv(t)
	e.seed()
	got := decode[domain.EnveloppeCT](t, e.do("PUT", "/api/enveloppes/A1",
		`{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":120000.5,"commentaire":"  Budget voté  ","operateur":"alice"}`), 200)
	env := got.Enveloppe
	if got.CT != "A1" || got.CTLibelle != "Réalisé A1" || !got.Sources.Plan || !got.Sources.Realise || !got.Sources.Provisions || env == nil ||
		env.DateDebut != "2026-01-01" || env.DateFin != "2026-12-31" || env.Montant != 120000.5 ||
		env.Commentaire != "Budget voté" || env.Operateur != "alice" || !env.UpdatedAt.Equal(e.now) {
		t.Fatalf("création: %+v %+v", got, env)
	}

	// Mise à jour : même ligne, opérateur par l'en-tête, période d'un jour, montant nul.
	e.now = e.now.Add(time.Hour)
	got = decode[domain.EnveloppeCT](t, e.do("PUT", "/api/enveloppes/A1",
		`{"date_debut":"2027-03-01","date_fin":"2027-03-01","montant":0}`, "X-User", "bob"), 200)
	env = got.Enveloppe
	if env == nil || env.DateDebut != "2027-03-01" || env.DateFin != "2027-03-01" || env.Montant != 0 ||
		env.Commentaire != "" || env.Operateur != "bob" || !env.UpdatedAt.Equal(e.now) {
		t.Fatalf("mise à jour: %+v", env)
	}
	var n int
	var stored string
	e.st.DB().QueryRow(`SELECT COUNT(*), MAX(updated_at) FROM ct_enveloppes`).Scan(&n, &stored)
	if n != 1 || stored != "2026-10-09T10:00:00Z" {
		t.Fatalf("une enveloppe par CT: %d %s", n, stored)
	}

	list := byCT(decode[[]domain.EnveloppeCT](t, e.do("GET", "/api/enveloppes", ""), 200))
	if list["A1"].Enveloppe == nil || list["A1"].Enveloppe.Operateur != "bob" || list["B2"].Enveloppe != nil {
		t.Fatalf("liste après saisie: %+v", list)
	}

	// Journal : sans montant.
	audit, err := e.st.ListAudit(context.Background(), "enveloppe", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(audit) != 2 || audit[0].Action != "update" || audit[0].ObjetID != "A1" || audit[0].Operateur != "bob" ||
		audit[1].Operateur != "alice" || audit[0].Details != "" || audit[1].Details != "" {
		t.Fatalf("journal: %+v", audit)
	}
}

func TestDelete(t *testing.T) {
	e := newEnv(t)
	e.seed()
	if rec := e.do("DELETE", "/api/enveloppes/A1", ""); rec.Code != 404 {
		t.Fatalf("suppression sans enveloppe: %d", rec.Code)
	}
	decode[domain.EnveloppeCT](t, e.do("PUT", "/api/enveloppes/A1", `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":10}`), 200)
	if rec := e.do("DELETE", "/api/enveloppes/A1?operateur=carol", ""); rec.Code != 204 {
		t.Fatalf("suppression: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.do("DELETE", "/api/enveloppes/A1", ""); rec.Code != 404 {
		t.Fatalf("seconde suppression: %d", rec.Code)
	}
	list := byCT(decode[[]domain.EnveloppeCT](t, e.do("GET", "/api/enveloppes", ""), 200))
	if a1, ok := list["A1"]; !ok || a1.Enveloppe != nil {
		t.Fatalf("A1 reste listé, à configurer: %+v", a1)
	}
	audit, _ := e.st.ListAudit(context.Background(), "enveloppe", 0)
	if len(audit) != 2 || audit[0].Action != "delete" || audit[0].ObjetID != "A1" || audit[0].Operateur != "carol" || audit[0].Details != "" {
		t.Fatalf("journal: %+v", audit)
	}
}

func TestConfiguredCTStaysListed(t *testing.T) {
	e := newEnv(t)
	e.seed()
	decode[domain.EnveloppeCT](t, e.do("PUT", "/api/enveloppes/Q7", `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":5000}`), 200)

	// Q7 disparaît des sources (provisions archivées) : il reste listé, sans source.
	e.exec(`UPDATE versions SET statut = 'archivee' WHERE id = 'prov1'`)
	list := byCT(decode[[]domain.EnveloppeCT](t, e.do("GET", "/api/enveloppes", ""), 200))
	q7, ok := list["Q7"]
	if !ok || q7.Sources != (domain.EnveloppeSources{}) || q7.Enveloppe == nil || q7.Enveloppe.Montant != 5000 || q7.CTLibelle != "" {
		t.Fatalf("Q7 configuré: %+v", q7)
	}
	// Libellés sans les provisions : B2 retombe sur le plan.
	if list["B2"].CTLibelle != "Plan B2" || list["B2"].Sources.Provisions {
		t.Fatalf("B2: %+v", list["B2"])
	}
	// Toujours modifiable.
	got := decode[domain.EnveloppeCT](t, e.do("PUT", "/api/enveloppes/Q7", `{"date_debut":"2026-01-01","date_fin":"2026-12-31","montant":6000}`), 200)
	if got.Enveloppe == nil || got.Enveloppe.Montant != 6000 {
		t.Fatalf("Q7 modifié: %+v", got)
	}
}
