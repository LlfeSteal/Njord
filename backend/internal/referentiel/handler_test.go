package referentiel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/plan"
	"njord/internal/store"
)

func setup(t *testing.T) (*store.Store, *gin.Engine) {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	data, err := os.ReadFile("../../../test_data_demo/demo_plancharge.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := plan.NewService(st).Commit(context.Background(), data, "demo.xlsx", "", "", true); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	New(st).Register(r.Group("/api"))
	return st, r
}

func call(t *testing.T, r http.Handler, method, path, body string, wantCode int) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != wantCode {
		t.Fatalf("%s %s : %d (attendu %d) %s", method, path, w.Code, wantCode, w.Body.String())
	}
	return w
}

func dec[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("json : %v", err)
	}
	return v
}

func personneByMat(t *testing.T, r http.Handler, mat string) domain.Personne {
	t.Helper()
	ps := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes?q="+mat, "", 200))
	for _, p := range ps {
		for _, m := range p.Matricules {
			if m == mat {
				return p
			}
		}
	}
	t.Fatalf("personne %s introuvable", mat)
	return domain.Personne{}
}

func TestPersonnes(t *testing.T) {
	st, r := setup(t)
	all := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes", "", 200))
	if len(all) != 29 {
		t.Fatalf("%d personnes", len(all))
	}
	if ps := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes?q=theo", "", 200)); len(ps) != 1 || ps[0].DisplayName != "MARTIN Théo" {
		t.Errorf("q=theo %+v", ps)
	}
	if ps := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes?q=2gi_", "", 200)); len(ps) != 2 {
		t.Errorf("q=2gi_ → %d", len(ps))
	}
	durand := personneByMat(t, r, "DURANDC")
	if durand.Statut != "brouillon" || len(durand.Alias) != 1 || durand.Alias[0].Source != domain.AliasImport || durand.SquadID == nil {
		t.Errorf("durand %+v", durand)
	}
	call(t, r, "GET", "/api/personnes/inconnu", "", 404)

	// PATCH.
	p := dec[domain.Personne](t, call(t, r, "PATCH", "/api/personnes/"+durand.ID, `{"display_name":"Claire Durand-Martin","statut":"validee","squad_id":null}`, 200))
	if p.DisplayName != "Claire Durand-Martin" || p.NomNormalise != "CLAIRE DURAND MARTIN" || p.Statut != "validee" || p.SquadID != nil {
		t.Errorf("patch %+v", p)
	}
	call(t, r, "PATCH", "/api/personnes/"+durand.ID, `{"statut":"x"}`, 400)
	call(t, r, "PATCH", "/api/personnes/"+durand.ID, `{"squad_id":"nope"}`, 400)

	// Alias.
	p = dec[domain.Personne](t, call(t, r, "POST", "/api/personnes/"+durand.ID+"/alias", `{"alias":"DURAND Claire Mme"}`, 200))
	if len(p.Alias) != 1 || p.Alias[0].Source != domain.AliasManuel { // même clé que l'alias import → promu manuel
		t.Errorf("alias %+v", p.Alias)
	}
	p = dec[domain.Personne](t, call(t, r, "POST", "/api/personnes/"+durand.ID+"/alias", `{"alias":"C. Durand"}`, 200))
	if len(p.Alias) != 2 {
		t.Fatalf("alias %+v", p.Alias)
	}
	martin := personneByMat(t, r, "MARTINT")
	call(t, r, "POST", "/api/personnes/"+martin.ID+"/alias", `{"alias":"Durand C."}`, 409)
	call(t, r, "POST", "/api/personnes/"+durand.ID+"/alias", `{"alias":"  "}`, 400)
	p = dec[domain.Personne](t, call(t, r, "DELETE", "/api/personnes/"+durand.ID+"/alias/"+itoa(p.Alias[1].ID), "", 200))
	if len(p.Alias) != 1 {
		t.Errorf("après suppression %+v", p.Alias)
	}
	call(t, r, "DELETE", "/api/personnes/"+martin.ID+"/alias/"+itoa(p.Alias[0].ID), "", 404)

	// Matricules.
	p = dec[domain.Personne](t, call(t, r, "POST", "/api/personnes/"+durand.ID+"/matricules", `{"matricule":"A12345"}`, 200))
	if len(p.Matricules) != 2 {
		t.Errorf("matricules %v", p.Matricules)
	}
	call(t, r, "POST", "/api/personnes/"+durand.ID+"/matricules", `{"matricule":"A12345"}`, 200)
	call(t, r, "POST", "/api/personnes/"+martin.ID+"/matricules", `{"matricule":"A12345"}`, 409)

	// Merge MARTINT → DURANDC.
	call(t, r, "POST", "/api/personnes/"+martin.ID+"/merge", `{"into_id":"`+martin.ID+`"}`, 400)
	call(t, r, "POST", "/api/personnes/"+martin.ID+"/merge", `{"into_id":"nope"}`, 404)
	p = dec[domain.Personne](t, call(t, r, "POST", "/api/personnes/"+martin.ID+"/merge", `{"into_id":"`+durand.ID+`"}`, 200))
	if len(p.Matricules) != 3 || p.ID != durand.ID {
		t.Errorf("merge matricules %v", p.Matricules)
	}
	hasAlias := map[string]bool{}
	for _, a := range p.Alias {
		hasAlias[a.AliasNormalise] = true
	}
	if !hasAlias["MARTIN THEO"] {
		t.Errorf("alias après merge %+v", p.Alias)
	}
	call(t, r, "GET", "/api/personnes/"+martin.ID, "", 404)
	var n int
	st.DB().QueryRow(`SELECT COUNT(*) FROM plan_lines WHERE personne_id = ?`, durand.ID).Scan(&n)
	if n != 4 {
		t.Errorf("%d lignes de plan rattachées après merge", n)
	}
	st.DB().QueryRow(`SELECT COUNT(*) FROM audit_log WHERE objet_type = 'personne'`).Scan(&n)
	if n < 7 {
		t.Errorf("%d entrées d'audit", n)
	}
	var details string
	st.DB().QueryRow(`SELECT group_concat(details, '|') FROM audit_log WHERE objet_type = 'personne'`).Scan(&details)
	if strings.Contains(details, "DURAND") || strings.Contains(details, "A12345") {
		t.Errorf("donnée sensible dans l'audit : %s", details)
	}
}

func itoa(i int64) string { b, _ := json.Marshal(i); return string(b) }

func TestSquads(t *testing.T) {
	_, r := setup(t)
	ss := dec[[]domain.Squad](t, call(t, r, "GET", "/api/squads", "", 200))
	if len(ss) != 8 {
		t.Fatalf("%d squads", len(ss))
	}
	byName := map[string]domain.Squad{}
	for _, s := range ss {
		byName[s.NomCanonique] = s
	}
	alpha, core := byName["Squad Alpha — Plateforme"], byName["Alpha Core Team"]
	if core.ParentID == nil || *core.ParentID != alpha.ID || len(alpha.Alias) != 1 || alpha.Alias[0] != "Squad Alpha" {
		t.Errorf("alpha %+v core %+v", alpha, core)
	}

	s := dec[domain.Squad](t, call(t, r, "POST", "/api/squads", `{"nom_canonique":"Squad Delta","entite_rattachee":"DT","parent_id":"`+alpha.ID+`"}`, 201))
	if s.ParentID == nil || *s.ParentID != alpha.ID || s.EntiteRattachee != "DT" {
		t.Errorf("création %+v", s)
	}
	call(t, r, "POST", "/api/squads", `{"nom_canonique":"squad  delta"}`, 409)
	call(t, r, "POST", "/api/squads", `{"nom_canonique":"Squad Alpha"}`, 409) // alias existant
	call(t, r, "POST", "/api/squads", `{"nom_canonique":""}`, 400)
	call(t, r, "POST", "/api/squads", `{"nom_canonique":"X","parent_id":"nope"}`, 400)

	// Boucle : Alpha sous son petit-enfant.
	call(t, r, "PATCH", "/api/squads/"+alpha.ID, `{"parent_id":"`+s.ID+`"}`, 409)
	s = dec[domain.Squad](t, call(t, r, "PATCH", "/api/squads/"+s.ID, `{"nom_canonique":"Squad Delta — Ops","parent_id":null}`, 200))
	if s.NomCanonique != "Squad Delta — Ops" || s.ParentID != nil {
		t.Errorf("patch %+v", s)
	}
	call(t, r, "PATCH", "/api/squads/"+s.ID, `{"nom_canonique":"Alpha Core Team"}`, 409)
	call(t, r, "PATCH", "/api/squads/nope", `{}`, 404)

	s = dec[domain.Squad](t, call(t, r, "POST", "/api/squads/"+s.ID+"/alias", `{"alias":"Delta"}`, 200))
	if len(s.Alias) != 1 {
		t.Errorf("alias %+v", s.Alias)
	}
	call(t, r, "POST", "/api/squads/"+s.ID+"/alias", `{"alias":"Squad Beta"}`, 409)
	call(t, r, "POST", "/api/squads/"+s.ID+"/alias", `{"alias":"delta"}`, 200)
}
