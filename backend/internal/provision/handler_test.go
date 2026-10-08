package provision

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	e := &env{t: t, st: st, now: time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)}
	st.Now = func() time.Time { return e.now }
	gin.SetMode(gin.TestMode)
	e.r = gin.New()
	New(st).Register(e.r.Group("/api"))
	return e
}

func (e *env) upload(path string, data []byte, filename string, fields map[string]string) *httptest.ResponseRecorder {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, _ := w.CreateFormFile("file", filename)
	fw.Write(data)
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

func (e *env) do(method, path, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
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
		t.Fatalf("json: %v", err)
	}
	return v
}

func TestHTTPImportLinesLifecycle(t *testing.T) {
	e := newEnv(t)
	file := buildXLSX(t, "Style par défaut", sampleRows())

	// Preview : rien n'est écrit.
	rep := decode[domain.ImportReport](t, e.upload("/api/provision/imports/preview", file, "Export Provisions.xlsx", nil), 200)
	if rep.Kind != domain.KindProvision || rep.Intitule != "Export Provisions" || rep.Total != 9 ||
		rep.SourceFormat != domain.FormatProvisions || rep.MontantTotalEur == nil || *rep.MontantTotalEur != 1950 ||
		rep.ActiveVersion != nil || rep.Issues == nil || rep.SheetName != "Style par défaut" || rep.HeaderRow != 3 {
		t.Fatalf("preview: %+v", rep)
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM versions`).Scan(&n)
	if n != 0 {
		t.Fatal("preview ne doit rien écrire")
	}

	// Import 1.
	v1 := decode[domain.ImportResult](t, e.upload("/api/provision/imports", file, "Export Provisions.xlsx",
		map[string]string{"importeur": "alice", "intitule": "Octobre"}), 201).Version
	if v1.Kind != domain.KindProvision || v1.Statut != domain.StatutActive || v1.Importeur != "alice" ||
		v1.Intitule != "Octobre" || v1.NbLignes != 7 || v1.NbWarn != 3 || v1.NbDrop != 2 ||
		v1.MontantTotalEur == nil || *v1.MontantTotalEur != 1950 || v1.PeriodeDebut != "2026-10-01" ||
		v1.PeriodeFin != "2027-01-01" || v1.SourceFormat != domain.FormatProvisions {
		t.Fatalf("v1: %+v", v1)
	}
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM provision_lines WHERE version_id = ?`, v1.ID).Scan(&n)
	if n != 9 {
		t.Fatalf("lignes stockées (drop compris): %d", n)
	}
	got := decode[domain.Version](t, e.do("GET", "/api/provision/versions/"+v1.ID, ""), 200)
	if got.MontantTotalEur == nil || *got.MontantTotalEur != 1950 {
		t.Fatalf("montant relu: %+v", got)
	}

	// Lignes : tout, pagination, totaux sur tout le filtre.
	base := "/api/provision/versions/" + v1.ID
	page := decode[domain.ProvisionLinesPage](t, e.do("GET", base+"/lines?limit=2", ""), 200)
	if page.Total != 9 || len(page.Items) != 2 || page.Items[0].RowNum != 8 || page.Totals.Montant != 1960 {
		t.Fatalf("page: total=%d items=%d totals=%v", page.Total, len(page.Items), page.Totals)
	}
	lines := func(q string) domain.ProvisionLinesPage {
		t.Helper()
		return decode[domain.ProvisionLinesPage](t, e.do("GET", base+"/lines?"+q, ""), 200)
	}
	if p := lines("ct=Y99F00001"); p.Total != 2 || p.Totals.Montant != 1000 {
		t.Errorf("ct: %+v", p)
	}
	if p := lines("ct=Y99F00001&ct=Y99F00002"); p.Total != 3 || p.Totals.Montant != 1500 {
		t.Errorf("ct multiple: %+v", p)
	}
	if p := lines("groupe=" + url.QueryEscape("Projet A")); p.Total != 3 {
		t.Errorf("groupe parent (sous-groupes compris): %d", p.Total)
	}
	if p := lines("groupe=" + url.QueryEscape("Projet A > Sous A2")); p.Total != 1 || p.Items[0].CT != "Y99F00002" {
		t.Errorf("groupe: %+v", p)
	}
	if p := lines("ligne_cout=CAPACITE+SUR+SITE"); p.Total != 1 || p.Items[0].Montant != 400 {
		t.Errorf("ligne_cout: %+v", p)
	}
	if p := lines("statut=drop"); p.Total != 2 {
		t.Errorf("statut: %d", p.Total)
	}
	if p := lines("statut=ok&statut=warn"); p.Total != 7 || p.Totals.Montant != 1950 {
		t.Errorf("acceptées: %+v", p.Totals)
	}
	if p := lines("q=" + url.QueryEscape("capacite a1")); p.Total != 1 || p.Items[0].RowNum != 9 {
		t.Errorf("q libellé sans accent: %+v", p)
	}
	if p := lines("q=sous+a2"); p.Total != 1 {
		t.Errorf("q groupe: %d", p.Total)
	}
	if p := lines("sort=montant&order=desc&statut=ok"); p.Items[0].Montant != 600 || p.Items[len(p.Items)-1].Montant != 100 {
		t.Errorf("tri montant: %+v", p.Items)
	}
	if p := lines("sort=ct&order=desc"); p.Items[0].CT != "Y99F00005" || p.Items[0].RowNum != 22 {
		t.Errorf("tri ct: %+v", p.Items[0])
	}
	for _, q := range []string{"sort=libelle", "order=up", "statut=ko"} {
		if rec := e.do("GET", base+"/lines?"+q, ""); rec.Code != 400 {
			t.Errorf("%s: %d", q, rec.Code)
		}
	}

	// Facets.
	facets := decode[domain.Facets](t, e.do("GET", base+"/facets", ""), 200)
	if len(facets["ct"]) != 5 || len(facets["ligne_cout"]) != 3 || len(facets["statut"]) != 3 ||
		strings.Join(facets["groupe"], "|") != "Projet A > Sous A1|Projet A > Sous A2|Projet B|Projet C" {
		t.Fatalf("facets: %v", facets)
	}

	// CSV (mêmes filtres, sans pagination).
	rec := e.do("GET", base+"/lines.csv?ct=Y99F00001&limit=1", "")
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv: %d", rec.Code)
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(rec.Body.String(), "\xef\xbb\xbf")))
	r.Comma = ';'
	recs, err := r.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 3 || strings.Join(recs[0], ";") != strings.Join(CSVHeader, ";") ||
		recs[1][0] != "8" || recs[1][1] != "Y99F00001" || recs[1][3] != "Projet A > Sous A1" || recs[1][7] != "600" ||
		recs[1][8] != "2026-10-01" || recs[1][10] != "ok" {
		t.Fatalf("csv: %v", recs)
	}

	// Import 2 (archive la 1), import 3 né archivé.
	e.now = e.now.Add(time.Hour)
	v2 := decode[domain.ImportResult](t, e.upload("/api/provision/imports", file, "v2.xlsx", nil), 201).Version
	if v2.Statut != domain.StatutActive || v2.Intitule != "v2" {
		t.Fatalf("v2: %+v", v2)
	}
	if got := decode[domain.Version](t, e.do("GET", "/api/provision/versions/"+v1.ID, ""), 200); got.Statut != domain.StatutArchivee {
		t.Fatalf("v1 doit être archivée: %s", got.Statut)
	}
	rep = decode[domain.ImportReport](t, e.upload("/api/provision/imports/preview", file, "x.xlsx", nil), 200)
	if rep.ActiveVersion == nil || rep.ActiveVersion.ID != v2.ID {
		t.Fatalf("preview active: %+v", rep.ActiveVersion)
	}
	v3 := decode[domain.ImportResult](t, e.upload("/api/provision/imports", file, "v3.xlsx",
		map[string]string{"archive_active": "false"}), 201).Version
	if v3.Statut != domain.StatutArchivee {
		t.Fatalf("v3: %s", v3.Statut)
	}
	if l := decode[[]domain.Version](t, e.do("GET", "/api/provision/versions", ""), 200); len(l) != 3 || l[0].ID != v2.ID {
		t.Fatalf("liste: %+v", l)
	}

	// Réactivation, archivage.
	if got := decode[domain.Version](t, e.do("POST", "/api/provision/versions/"+v1.ID+"/reactivate", `{"operateur":"bob"}`), 200); got.Statut != domain.StatutActive {
		t.Fatal("réactivation")
	}
	if got := decode[domain.Version](t, e.do("POST", "/api/provision/versions/"+v1.ID+"/archive", ""), 200); got.Statut != domain.StatutArchivee {
		t.Fatal("archivage")
	}

	// Purge : trop tôt → 409, puis ok ; lignes supprimées.
	if rec := e.do("POST", "/api/provision/versions/"+v3.ID+"/purge", `{"confirm_intitule":"v3"}`); rec.Code != 409 {
		t.Fatalf("purge trop tôt: %d", rec.Code)
	}
	e.now = e.now.AddDate(0, 0, 31)
	if got := decode[domain.Version](t, e.do("POST", "/api/provision/versions/"+v3.ID+"/purge", `{"confirm_intitule":"v3"}`), 200); got.Statut != domain.StatutPurgee {
		t.Fatal("purge")
	}
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM provision_lines WHERE version_id = ?`, v3.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("lignes purgées: %d", n)
	}
	if l := decode[[]domain.Version](t, e.do("GET", "/api/provision/versions?include_purged=true", ""), 200); len(l) != 3 {
		t.Fatalf("purgées visibles: %d", len(l))
	}

	// Journal : aucun montant.
	audit, _ := e.st.ListAudit(context.Background(), "provision_version", 100)
	if len(audit) < 6 {
		t.Fatalf("audit: %d", len(audit))
	}
	for _, a := range audit {
		if strings.Contains(a.Details, "1950") || strings.Contains(a.Details, "Y99F") {
			t.Fatalf("donnée sensible journalisée: %s", a.Details)
		}
	}

	// Erreurs : version inconnue, version d'un autre kind.
	if rec := e.do("GET", "/api/provision/versions/inconnue/lines", ""); rec.Code != 404 {
		t.Fatalf("404 lines: %d", rec.Code)
	}
	if rec := e.do("GET", "/api/provision/versions/inconnue/facets", ""); rec.Code != 404 {
		t.Fatalf("404 facets: %d", rec.Code)
	}
}

func TestHTTPImportErrors(t *testing.T) {
	e := newEnv(t)
	pdc := buildXLSX(t, "Style par défaut", [][]any{
		{"Tâche ou sous-projet", "Ressource", "Libellé", "Type d'affectation", "Ligne de coût", "Charge totale", ".PPS",
			"Pourcentage", "Unité", "Calcul de la durée", "Date début", "Date fin"},
		{"Y99F00001", "R_001", "DUPONT Jean", "Standard", "MAIN D'OEUVRE SUR SITE", 100, 1000, 50, "U", "Dates fixes", 46296, 46297},
	})
	for _, path := range []string{"/api/provision/imports", "/api/provision/imports/preview"} {
		rec := e.upload(path, pdc, "pdc.xlsx", nil)
		if rec.Code != 422 || !strings.Contains(rec.Body.String(), CodeHeaderInvalid) {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	if rec := e.upload("/api/provision/imports", []byte("x"), "x.xlsx", nil); rec.Code != 422 ||
		!strings.Contains(rec.Body.String(), CodeFileInvalid) {
		t.Fatalf("file_invalid: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.do("POST", "/api/provision/imports", ""); rec.Code != 400 {
		t.Fatalf("fichier manquant: %d", rec.Code)
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM versions`).Scan(&n)
	if n != 0 {
		t.Fatal("aucune version ne doit être créée")
	}
}

func TestImportExportOctobre(t *testing.T) {
	e := newEnv(t)
	data := readDemo(t, "Export Provisions Octobre_DEMO.xlsx")
	v := decode[domain.ImportResult](t, e.upload("/api/provision/imports", data, "Export Provisions Octobre_DEMO.xlsx", nil), 201).Version
	if v.Intitule != "Export Provisions Octobre_DEMO" || v.NbLignes != 31 || v.MontantTotalEur == nil || *v.MontantTotalEur != 1369126.5 {
		t.Fatalf("version: %+v", v)
	}
	p := decode[domain.ProvisionLinesPage](t, e.do("GET", "/api/provision/versions/"+v.ID+"/lines?ct=Y99F71110", ""), 200)
	if p.Total != 2 || p.Totals.Montant != 3822.5 || p.Items[0].Groupe != "Dromon > Cordage" {
		t.Fatalf("Y99F71110: %+v", p)
	}
	f := decode[domain.Facets](t, e.do("GET", "/api/provision/versions/"+v.ID+"/facets", ""), 200)
	if len(f["ct"]) != 15 {
		t.Fatalf("facets ct: %d", len(f["ct"]))
	}
}
