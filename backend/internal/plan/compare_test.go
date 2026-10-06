package plan

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"testing"
	"time"

	"njord/internal/domain"
	"njord/internal/store"
)

// compareFixture commits the demo n times with increasing import timestamps
// (1 h apart, starting at hour start) and returns the version ids, oldest
// first. The last commit is active.
func compareFixture(t *testing.T, st *store.Store, start, n int) []string {
	t.Helper()
	base := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	data := readDemo(t)
	var ids []string
	for i := start; i < start+n; i++ {
		at := base.Add(time.Duration(i) * time.Hour)
		st.Now = func() time.Time { return at }
		res, err := NewService(st).Commit(context.Background(), data, "demo_plancharge.xlsx",
			fmt.Sprintf("v%d", i+1), "test", true)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, res.Version.ID)
	}
	return ids
}

func exec(t *testing.T, st *store.Store, q string, args ...any) {
	t.Helper()
	if _, err := st.DB().Exec(q, args...); err != nil {
		t.Fatalf("%s : %v", q, err)
	}
}

// mutate applies the drift scenario to version id.
func mutate(t *testing.T, st *store.Store, id string) {
	t.Helper()
	// Modifié : DURAND Claire sur Y99F90001 (+1000 PPS, +10 h).
	exec(t, st, `UPDATE plan_lines SET pps = pps + 1000, charge_totale = charge_totale + 10
		WHERE version_id = ? AND ct = 'Y99F90001' AND nom_prenom = 'DURAND Claire'`, id)
	// Sous le seuil : +0,004 PPS sur Y99F90003 → inchangé.
	exec(t, st, `UPDATE plan_lines SET pps = pps + 0.004 WHERE version_id = ? AND row_num = 14`, id)
	// Retiré : tout le CT Y99F90006 (ROBIN Manon, MASSON Romain, SANTOS Alice).
	exec(t, st, `DELETE FROM plan_lines WHERE version_id = ? AND ct = 'Y99F90006'`, id)
	ins := `INSERT INTO plan_lines (version_id, row_num, ct, nom_prenom, groupe, pps, charge_totale, statut_parsing)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	// Ajouté : nouveau CT, nouvelle personne + une ligne non nominative.
	exec(t, st, ins, id, 100, "Y99F900099", "NOUVEAU Jean", "Squad Delta", 5000, 40, "ok")
	exec(t, st, ins, id, 101, "Y99F900099", "", "", 300, 3, "warn")
	// Ligne drop : ignorée.
	exec(t, st, ins, id, 102, "Y99F900098", "FANTOME Zoé", "Squad Fantôme", 9999, 99, "drop")
}

func getCompare(t *testing.T, r http.Handler, qs string) domain.PlanCompare {
	t.Helper()
	w := do(r, http.MethodGet, "/api/plan/compare"+qs, "")
	if w.Code != http.StatusOK {
		t.Fatalf("compare%s : %d %s", qs, w.Code, w.Body.String())
	}
	return decode[domain.PlanCompare](t, w)
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.005 }

func TestCompareDerive(t *testing.T) {
	st := newStore(t)
	r := newRouter(st)
	ids := compareFixture(t, st, 0, 2)
	v1, v2 := ids[0], ids[1]
	mutate(t, st, v2)

	var ppsV1, chargeV1 float64
	if err := st.DB().QueryRow(`SELECT SUM(pps), SUM(charge_totale) FROM plan_lines
		WHERE version_id = ? AND statut_parsing <> 'drop'`, v1).Scan(&ppsV1, &chargeV1); err != nil {
		t.Fatal(err)
	}

	// Défauts : from = plus ancienne (v1), to = active (v2).
	cmp := getCompare(t, r, "")
	if cmp.From.ID != v1 || cmp.To.ID != v2 {
		t.Fatalf("défauts from=%s to=%s", cmp.From.Intitule, cmp.To.Intitule)
	}

	// Totaux.
	tot := cmp.Totaux
	dPPS := 1000 + 0.004 - (50186.04 + 31366.27 + 18332.8) + 5000 + 300
	dCharge := 10 - (438 + 273.75 + 160) + 40 + 3.0
	if !near(tot.PPSFrom, ppsV1) || !near(tot.ChargeFrom, chargeV1) ||
		!near(tot.PPSTo, ppsV1+dPPS) || !near(tot.ChargeTo, chargeV1+dCharge) {
		t.Errorf("totaux %+v (Σ v1 pps=%v charge=%v)", tot, ppsV1, chargeV1)
	}
	if tot.NbCTFrom != 12 || tot.NbCTTo != 12 || tot.NbPersonnesFrom != 25 || tot.NbPersonnesTo != 23 {
		t.Errorf("comptes %+v", tot)
	}

	// Par CT.
	byCT := map[string]domain.PlanCompareCT{}
	for _, c := range cmp.ParCT {
		byCT[c.CT] = c
	}
	if len(cmp.ParCT) != 13 {
		t.Errorf("%d CT", len(cmp.ParCT))
	}
	if _, ok := byCT["Y99F900098"]; ok {
		t.Error("CT d'une ligne drop présent")
	}
	if c := byCT["Y99F90006"]; c.Statut != domain.DeriveRetire || c.PPSTo != 0 || !near(c.PPSFrom, 99885.11) ||
		c.ChargeFrom != 871.75 || c.Groupe != "Squad Gamma — Intégration" {
		t.Errorf("retiré %+v", c)
	}
	if c := byCT["Y99F900099"]; c.Statut != domain.DeriveAjoute || c.PPSFrom != 0 || c.PPSTo != 5300 ||
		c.ChargeTo != 43 || c.Groupe != "Squad Delta" {
		t.Errorf("ajouté %+v", c)
	}
	if c := byCT["Y99F90001"]; c.Statut != domain.DeriveModifie || !near(c.PPSTo-c.PPSFrom, 1000) ||
		c.ChargeTo-c.ChargeFrom != 10 || c.Groupe != "Squad Alpha — Plateforme > Alpha Core Team" {
		t.Errorf("modifié %+v", c)
	}
	if c := byCT["Y99F90003"]; c.Statut != domain.DeriveInchange || c.PPSFrom != c.PPSTo {
		t.Errorf("sous le seuil %+v", c)
	}
	if c := byCT["Y99F90002"]; c.Statut != domain.DeriveInchange {
		t.Errorf("inchangé %+v", c)
	}
	wantHead := []string{"Y99F90006", "Y99F900099", "Y99F90001"}
	for i, ct := range wantHead {
		if cmp.ParCT[i].CT != ct {
			t.Fatalf("tri par_ct[%d] = %s, attendu %s", i, cmp.ParCT[i].CT, ct)
		}
	}
	tail := cmp.ParCT[len(wantHead):]
	if !sort.SliceIsSorted(tail, func(i, j int) bool { return tail[i].CT < tail[j].CT }) {
		t.Error("CT inchangés non triés par CT")
	}

	// Par personne.
	byNom := map[string]domain.PlanComparePersonne{}
	for _, p := range cmp.ParPersonne {
		byNom[p.NomPrenom] = p
	}
	if len(cmp.ParPersonne) != 27 { // 25 + NOUVEAU Jean + (non nominatif)
		t.Errorf("%d personnes", len(cmp.ParPersonne))
	}
	if _, ok := byNom["FANTOME Zoé"]; ok {
		t.Error("personne d'une ligne drop présente")
	}
	if _, ok := byNom[""]; ok {
		t.Error("clé vide présente")
	}
	if p := byNom[NonNominatif]; p.Statut != domain.DeriveModifie || p.ChargeFrom != 2390 || p.ChargeTo != 2393 ||
		!near(p.PPSTo-p.PPSFrom, 300) {
		t.Errorf("non nominatif %+v", p)
	}
	if p := byNom["DURAND Claire"]; p.Statut != domain.DeriveModifie || p.ChargeFrom != 438 || p.ChargeTo != 448 {
		t.Errorf("DURAND Claire %+v", p)
	}
	if p := byNom["ROBIN Manon"]; p.Statut != domain.DeriveRetire || p.ChargeFrom != 438 || p.ChargeTo != 0 {
		t.Errorf("ROBIN Manon %+v", p)
	}
	if p := byNom["NOUVEAU Jean"]; p.Statut != domain.DeriveAjoute || p.PPSTo != 5000 || p.ChargeTo != 40 {
		t.Errorf("NOUVEAU Jean %+v", p)
	}
	if p := byNom["LAMBERT Chloé"]; p.Statut != domain.DeriveInchange {
		t.Errorf("LAMBERT Chloé %+v", p)
	}
	wantNoms := []string{"ROBIN Manon", "MASSON Romain", "SANTOS Alice", "NOUVEAU Jean", "DURAND Claire", NonNominatif}
	for i, n := range wantNoms {
		if cmp.ParPersonne[i].NomPrenom != n {
			t.Fatalf("tri par_personne[%d] = %s, attendu %s", i, cmp.ParPersonne[i].NomPrenom, n)
		}
	}
	rest := cmp.ParPersonne[len(wantNoms):]
	if !sort.SliceIsSorted(rest, func(i, j int) bool { return rest[i].NomPrenom < rest[j].NomPrenom }) {
		t.Error("personnes inchangées non triées par nom")
	}

	// Explicite, sens inverse : ajouté ↔ retiré.
	inv := getCompare(t, r, "?from="+v2+"&to="+v1)
	if inv.From.ID != v2 || inv.To.ID != v1 {
		t.Fatal("from/to explicites ignorés")
	}
	for _, c := range inv.ParCT {
		switch c.CT {
		case "Y99F90006":
			if c.Statut != domain.DeriveAjoute {
				t.Errorf("inverse %+v", c)
			}
		case "Y99F900099":
			if c.Statut != domain.DeriveRetire || c.Groupe != "Squad Delta" {
				t.Errorf("inverse %+v", c)
			}
		}
	}
}

func TestCompareDefaultsAndErrors(t *testing.T) {
	st := newStore(t)
	r := newRouter(st)
	status := func(qs string) int {
		t.Helper()
		return do(r, http.MethodGet, "/api/plan/compare"+qs, "").Code
	}

	// Aucune version / une seule version → 409.
	if c := status(""); c != http.StatusConflict {
		t.Errorf("store vide : %d", c)
	}
	all := compareFixture(t, st, 0, 1)
	if w := do(r, http.MethodGet, "/api/plan/compare", ""); w.Code != http.StatusConflict ||
		decode[map[string]map[string]string](t, w)["error"]["code"] != "precondition" {
		t.Errorf("une version : %d %s", w.Code, w.Body.String())
	}
	all = append(all, compareFixture(t, st, 1, 3)...) // v1..v4, v4 active
	oldest, active := all[0], all[3]

	// Défauts : plus ancienne non purgée vs active ; versions identiques → tout inchangé.
	cmp := getCompare(t, r, "")
	if cmp.From.ID != oldest || cmp.To.ID != active {
		t.Fatalf("défauts %s → %s", cmp.From.ID, cmp.To.ID)
	}
	for _, c := range cmp.ParCT {
		if c.Statut != domain.DeriveInchange {
			t.Fatalf("démo identique : %+v", c)
		}
	}
	if len(cmp.ParCT) != 12 || len(cmp.ParPersonne) != 26 {
		t.Errorf("%d CT, %d personnes", len(cmp.ParCT), len(cmp.ParPersonne))
	}

	// from seul → to = active ; to seul → from = plus ancienne ≠ to.
	if c := getCompare(t, r, "?from="+all[1]); c.From.ID != all[1] || c.To.ID != active {
		t.Errorf("from seul %s → %s", c.From.ID, c.To.ID)
	}
	if c := getCompare(t, r, "?to="+all[2]); c.From.ID != oldest || c.To.ID != all[2] {
		t.Errorf("to seul %s → %s", c.From.ID, c.To.ID)
	}
	if c := getCompare(t, r, "?to="+oldest); c.From.ID == oldest || c.To.ID != oldest {
		t.Errorf("to = plus ancienne → from %s", c.From.ID)
	}

	// L'active est la plus ancienne → from = la suivante.
	if w := do(r, http.MethodPost, "/api/plan/versions/"+oldest+"/reactivate", ""); w.Code != http.StatusOK {
		t.Fatalf("reactivate %d %s", w.Code, w.Body.String())
	}
	if c := getCompare(t, r, ""); c.To.ID != oldest || c.From.ID != all[1] {
		t.Errorf("active = plus ancienne : %s → %s", c.From.ID, c.To.ID)
	}

	// from = to → 409.
	if c := status("?from=" + all[1] + "&to=" + all[1]); c != http.StatusConflict {
		t.Errorf("from = to : %d", c)
	}
	if c := status("?from=" + oldest); c != http.StatusConflict { // to = active = from
		t.Errorf("from = active : %d", c)
	}

	// 404 : inconnue, version réalisé, purgée.
	if c := status("?from=nope"); c != http.StatusNotFound {
		t.Errorf("inconnue : %d", c)
	}
	exec(t, st, `INSERT INTO versions (id, kind, intitule, importee_le, statut) VALUES ('r1', 'realise', 'r', '2026-01-01T00:00:00Z', 'active')`)
	if c := status("?to=r1&from=" + all[1]); c != http.StatusNotFound {
		t.Errorf("version réalisé : %d", c)
	}
	exec(t, st, `UPDATE versions SET statut = 'purgee' WHERE id = ?`, all[1])
	if c := status("?from=" + all[1]); c != http.StatusNotFound {
		t.Errorf("purgée : %d", c)
	}
	// La purgée est ignorée par les défauts : active = oldest → from = all[2].
	if c := getCompare(t, r, ""); c.From.ID != all[2] {
		t.Errorf("défaut après purge : from %s", c.From.ID)
	}

	// Pas de conflit de route avec /versions/:id.
	if w := do(r, http.MethodGet, "/api/plan/versions/"+all[1], ""); w.Code != http.StatusOK {
		t.Errorf("versions/:id : %d", w.Code)
	}
	if w := do(r, http.MethodGet, "/api/plan/versions/compare", ""); w.Code != http.StatusNotFound {
		t.Errorf("versions/compare : %d", w.Code)
	}
}
