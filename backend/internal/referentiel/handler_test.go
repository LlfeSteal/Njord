package referentiel

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/store"
)

// fixture: squads (with a hierarchy and an alias) and personnes keyed by NOM + Prénom.
const fixture = `
INSERT INTO squads(id, nom_canonique, nom_normalise, entite_rattachee, parent_id, created_at) VALUES
	('sq-alpha', 'Squad Alpha — Plateforme', 'SQUAD ALPHA PLATEFORME', 'DSI', NULL, '2026-01-01T00:00:00Z'),
	('sq-core', 'Alpha Core Team', 'ALPHA CORE TEAM', 'DSI', 'sq-alpha', '2026-01-01T00:00:00Z'),
	('sq-beta', 'Squad Beta', 'SQUAD BETA', '', NULL, '2026-01-01T00:00:00Z');
INSERT INTO squad_alias(squad_id, alias, alias_normalise) VALUES ('sq-alpha', 'Squad Alpha', 'SQUAD ALPHA');
INSERT INTO personnes(id, display_name, nom_normalise, statut, squad_id, created_at) VALUES
	('p-durand', 'DURAND Claire', 'DURAND|CLAIRE', 'brouillon', 'sq-alpha', '2026-01-01T00:00:00Z'),
	('p-martin', 'MARTIN Théo', 'MARTIN|THEO', 'brouillon', NULL, '2026-01-01T00:00:00Z'),
	('p-tour', 'DE LA TOUR Antoine', 'DE LA TOUR|ANTOINE', 'validee', 'sq-beta', '2026-01-01T00:00:00Z');
`

func setup(t *testing.T) (*store.Store, *gin.Engine) {
	t.Helper()
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if _, err := st.DB().Exec(fixture); err != nil {
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

func displayNames(ps []domain.Personne) []string {
	out := []string{}
	for _, p := range ps {
		out = append(out, p.DisplayName)
	}
	return out
}

func TestPersonnesList(t *testing.T) {
	_, r := setup(t)
	all := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes", "", 200))
	if got := strings.Join(displayNames(all), ","); got != "DE LA TOUR Antoine,DURAND Claire,MARTIN Théo" {
		t.Fatalf("liste triée : %s", got)
	}
	if all[1].NomNormalise != "DURAND|CLAIRE" || all[1].SquadID == nil || *all[1].SquadID != "sq-alpha" {
		t.Errorf("durand %+v", all[1])
	}
	// ?q= : sur le nom seulement, insensible à la casse et aux accents.
	for q, want := range map[string]string{
		"theo":       "MARTIN Théo",
		"THÉO":       "MARTIN Théo",
		"durand":     "DURAND Claire",
		"la%20tour":  "DE LA TOUR Antoine",
		"  claire  ": "DURAND Claire",
		"":           "DE LA TOUR Antoine,DURAND Claire,MARTIN Théo",
		"inconnu":    "",
		"MARTIN|THE": "", // la clé normalisée n'est pas cherchée
	} {
		ps := dec[[]domain.Personne](t, call(t, r, "GET", "/api/personnes?q="+strings.ReplaceAll(q, " ", "%20"), "", 200))
		if got := strings.Join(displayNames(ps), ","); got != want {
			t.Errorf("q=%q → %q (attendu %q)", q, got, want)
		}
	}
	p := dec[domain.Personne](t, call(t, r, "GET", "/api/personnes/p-martin", "", 200))
	if p.DisplayName != "MARTIN Théo" || p.SquadID != nil {
		t.Errorf("get %+v", p)
	}
	call(t, r, "GET", "/api/personnes/inconnu", "", 404)
}

func TestPersonnesPatch(t *testing.T) {
	st, r := setup(t)
	p := dec[domain.Personne](t, call(t, r, "PATCH", "/api/personnes/p-durand", `{"statut":"validee","squad_id":null}`, 200))
	if p.DisplayName != "DURAND Claire" || p.NomNormalise != "DURAND|CLAIRE" || p.Statut != "validee" || p.SquadID != nil {
		t.Errorf("patch %+v", p)
	}
	p = dec[domain.Personne](t, call(t, r, "PATCH", "/api/personnes/p-durand", `{"squad_id":"sq-beta"}`, 200))
	if p.SquadID == nil || *p.SquadID != "sq-beta" || p.Statut != "validee" {
		t.Errorf("patch squad %+v", p)
	}
	call(t, r, "PATCH", "/api/personnes/p-durand", `{}`, 200)
	call(t, r, "PATCH", "/api/personnes/p-durand", `{"statut":"x"}`, 400)
	call(t, r, "PATCH", "/api/personnes/p-durand", `{"squad_id":"nope"}`, 400)
	call(t, r, "PATCH", "/api/personnes/nope", `{"statut":"validee"}`, 404)

	// Le nom est l'identité : non modifiable, même accompagné d'autres champs.
	w := call(t, r, "PATCH", "/api/personnes/p-durand", `{"display_name":"Claire Durand-Martin","statut":"brouillon"}`, 400)
	if !strings.Contains(w.Body.String(), "non modifiable") {
		t.Errorf("message : %s", w.Body.String())
	}
	call(t, r, "PATCH", "/api/personnes/p-durand", `{"display_name":null}`, 400)
	p = dec[domain.Personne](t, call(t, r, "GET", "/api/personnes/p-durand", "", 200))
	if p.DisplayName != "DURAND Claire" || p.Statut != "validee" {
		t.Errorf("modifiée malgré le refus : %+v", p)
	}

	var n int
	st.DB().QueryRow(`SELECT COUNT(*) FROM audit_log WHERE objet_type = 'personne'`).Scan(&n)
	if n != 2 {
		t.Errorf("%d entrées d'audit (attendu 2)", n)
	}
	var details string
	st.DB().QueryRow(`SELECT group_concat(details, '|') FROM audit_log WHERE objet_type = 'personne'`).Scan(&details)
	if strings.Contains(details, "DURAND") {
		t.Errorf("donnée sensible dans l'audit : %s", details)
	}
}

// Alias, matricules et fusion de personnes n'existent plus (DECISIONS n° 8).
func TestPersonnesRemovedRoutes(t *testing.T) {
	_, r := setup(t)
	call(t, r, "POST", "/api/personnes/p-durand/alias", `{"alias":"C. Durand"}`, 404)
	call(t, r, "DELETE", "/api/personnes/p-durand/alias/1", "", 404)
	call(t, r, "POST", "/api/personnes/p-durand/matricules", `{"matricule":"A12345"}`, 404)
	call(t, r, "POST", "/api/personnes/p-martin/merge", `{"into_id":"p-durand"}`, 404)
	call(t, r, "GET", "/api/personnes/p-martin", "", 200)
}

func TestSquads(t *testing.T) {
	_, r := setup(t)
	ss := dec[[]domain.Squad](t, call(t, r, "GET", "/api/squads", "", 200))
	if len(ss) != 3 {
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
