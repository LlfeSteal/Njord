package realise

import (
	"bytes"
	"context"
	"encoding/csv"
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
	e := &env{t: t, st: st, now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)}
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

func TestHTTPImportLifecycle(t *testing.T) {
	e := newEnv(t)
	demo := loadDemo(t)

	// Preview : rien n'est écrit.
	rep := decode[domain.ImportReport](t, e.upload("/api/realise/imports/preview", demo, "demo_realise.xlsx", nil), 200)
	if rep.Intitule != "demo_realise" || rep.Total != 482 || rep.SourceFormat != "demo" || rep.ActiveVersion != nil ||
		rep.MontantTotalEur == nil || *rep.MontantTotalEur != 403130.43 || rep.Issues == nil || rep.Kind != domain.KindRealise {
		t.Fatalf("preview: %+v", rep)
	}
	var n int
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM versions`).Scan(&n)
	if n != 0 {
		t.Fatal("preview ne doit rien écrire")
	}

	// Import 1.
	res := decode[domain.ImportResult](t, e.upload("/api/realise/imports", demo, "demo_realise.xlsx",
		map[string]string{"importeur": "alice"}), 201)
	v1 := res.Version
	if v1.Statut != domain.StatutActive || v1.Importeur != "alice" || v1.NbLignes != 482 || v1.Intitule != "demo_realise" ||
		v1.PeriodeDebut != "2026-08-27" || v1.PeriodeFin != "2026-10-03" || v1.MontantTotalEur == nil ||
		*v1.MontantTotalEur != 403130.43 || v1.SourceFormat != "demo" || v1.Filename != "demo_realise.xlsx" {
		t.Fatalf("v1: %+v", v1)
	}
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM realise_entries WHERE version_id = ?`, v1.ID).Scan(&n)
	if n != 482 {
		t.Fatalf("écritures stockées: %d", n)
	}

	// Preview suivante : version active renseignée.
	rep = decode[domain.ImportReport](t, e.upload("/api/realise/imports/preview", demo, "x.xlsx", map[string]string{"intitule": "Octobre"}), 200)
	if rep.ActiveVersion == nil || rep.ActiveVersion.ID != v1.ID || rep.Intitule != "Octobre" {
		t.Fatalf("preview active: %+v", rep.ActiveVersion)
	}

	// Import 2 avec archivage automatique (défaut).
	e.now = e.now.Add(time.Hour)
	v2 := decode[domain.ImportResult](t, e.upload("/api/realise/imports", demo, "demo_realise.xlsx",
		map[string]string{"intitule": "Réalisé V2"}), 201).Version
	if v2.Statut != domain.StatutActive || v2.Intitule != "Réalisé V2" {
		t.Fatalf("v2: %+v", v2)
	}
	got := decode[domain.Version](t, e.do("GET", "/api/realise/versions/"+v1.ID, ""), 200)
	if got.Statut != domain.StatutArchivee || got.ArchiveeLe == nil {
		t.Fatalf("v1 doit être archivée: %+v", got)
	}

	// Import 3 refusant l'archivage : née archivée.
	v3 := decode[domain.ImportResult](t, e.upload("/api/realise/imports", demo, "v3.xlsx",
		map[string]string{"archive_active": "false"}), 201).Version
	if v3.Statut != domain.StatutArchivee {
		t.Fatalf("v3: %s", v3.Statut)
	}
	list := decode[[]domain.Version](t, e.do("GET", "/api/realise/versions", ""), 200)
	if len(list) != 3 || list[0].ID != v2.ID {
		t.Fatalf("liste: %d", len(list))
	}

	// Réactivation de v1 → v2 archivée.
	got = decode[domain.Version](t, e.do("POST", "/api/realise/versions/"+v1.ID+"/reactivate", `{"operateur":"bob"}`), 200)
	if got.Statut != domain.StatutActive {
		t.Fatal("réactivation")
	}
	// Archivage sans corps.
	got = decode[domain.Version](t, e.do("POST", "/api/realise/versions/"+v1.ID+"/archive", ""), 200)
	if got.Statut != domain.StatutArchivee {
		t.Fatal("archivage")
	}

	// Purge : trop tôt → 409, puis intitulé faux → 409, puis ok.
	if rec := e.do("POST", "/api/realise/versions/"+v3.ID+"/purge", `{"confirm_intitule":"v3"}`); rec.Code != 409 {
		t.Fatalf("purge trop tôt: %d", rec.Code)
	}
	e.now = e.now.AddDate(0, 0, 31)
	if rec := e.do("POST", "/api/realise/versions/"+v3.ID+"/purge", `{"confirm_intitule":"V3"}`); rec.Code != 409 {
		t.Fatalf("purge intitulé: %d", rec.Code)
	}
	got = decode[domain.Version](t, e.do("POST", "/api/realise/versions/"+v3.ID+"/purge", `{"confirm_intitule":"v3"}`), 200)
	if got.Statut != domain.StatutPurgee {
		t.Fatal("purge")
	}
	e.st.DB().QueryRow(`SELECT COUNT(*) FROM realise_entries WHERE version_id = ?`, v3.ID).Scan(&n)
	if n != 0 {
		t.Fatal("écritures purgées")
	}
	if l := decode[[]domain.Version](t, e.do("GET", "/api/realise/versions", ""), 200); len(l) != 2 {
		t.Fatalf("purgées masquées: %d", len(l))
	}
	if l := decode[[]domain.Version](t, e.do("GET", "/api/realise/versions?include_purged=true", ""), 200); len(l) != 3 {
		t.Fatalf("purgées visibles: %d", len(l))
	}

	// Journal : aucune donnée sensible.
	audit, _ := e.st.ListAudit(context.Background(), "realise_version", 100)
	if len(audit) < 6 {
		t.Fatalf("audit: %d", len(audit))
	}
	for _, a := range audit {
		if strings.Contains(a.Details, "NORD") || strings.Contains(a.Details, "FA2026") {
			t.Fatalf("donnée sensible journalisée: %s", a.Details)
		}
	}

	// Erreurs.
	if rec := e.do("GET", "/api/realise/versions/inconnue", ""); rec.Code != 404 {
		t.Fatalf("404: %d", rec.Code)
	}
	if rec := e.do("GET", "/api/realise/versions/inconnue/entries", ""); rec.Code != 404 {
		t.Fatalf("404 entries: %d", rec.Code)
	}
	rec := e.upload("/api/realise/imports", buildXLSX(t, "Réalisé", specHeader[:20], nil), "bad.xlsx", nil)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), CodeHeaderInvalid) {
		t.Fatalf("422 header: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.upload("/api/realise/imports/preview", buildXLSX(t, "Autre", []any{"x"}, nil), "bad.xlsx", nil)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), CodeSheetNotFound) {
		t.Fatalf("422 sheet: %d %s", rec.Code, rec.Body.String())
	}
	if rec := e.do("POST", "/api/realise/imports", ""); rec.Code != 400 {
		t.Fatalf("fichier manquant: %d", rec.Code)
	}
	if l := decode[[]domain.Version](t, e.do("GET", "/api/realise/versions?include_purged=true", ""), 200); len(l) != 3 {
		t.Fatal("un import en erreur ne doit rien écrire")
	}
}

func importSpec(t *testing.T, e *env) domain.Version {
	t.Helper()
	rows, _ := specFixture()
	rows = append(rows,
		specRow(map[int]any{0: "ENTITE_B", cTG: "CT_000000002", 5: "CT_000000002 - Étude réseau", cCat: "PRESTATION",
			cType: "PRESTATION", 8: "Câblage spécial", cTot: 500, cQte: 2, cDate: 46270, cFac: "F_9", 24: "LOT_2", 12: "DURAND Claire Mme"}),
	)
	return decode[domain.ImportResult](t, e.upload("/api/realise/imports", buildXLSX(t, "Réalisé", specHeader, rows),
		"spec.xlsx", nil), 201).Version
}

func TestHTTPEntries(t *testing.T) {
	e := newEnv(t)
	v := importSpec(t, e)
	if v.NbLignes != 11 || v.NbWarn != 5 || v.NbDrop != 6 || v.SourceFormat != "spec" {
		t.Fatalf("version: %+v", v)
	}
	base := "/api/realise/versions/" + v.ID
	page := func(q string) domain.RealiseEntriesPage {
		t.Helper()
		return decode[domain.RealiseEntriesPage](t, e.do("GET", base+"/entries"+q, ""), 200)
	}

	all := page("")
	if all.Total != 17 || len(all.Items) != 17 || all.Items[0].RowNum != 2 {
		t.Fatalf("toutes: %d", all.Total)
	}
	// Statut.
	if p := page("?statut=drop"); p.Total != 6 {
		t.Fatalf("drop: %d", p.Total)
	}
	if p := page("?statut=ok&statut=warn"); p.Total != 11 {
		t.Fatalf("ok+warn: %d", p.Total)
	}
	// Filtres exacts.
	p := page("?entite=ENTITE_B")
	if p.Total != 1 || p.Items[0].TG != "CT_000000002" {
		t.Fatalf("entite: %+v", p)
	}
	if p := page("?tg=CT_000000002&lot=LOT_2&categorie=PRESTATION&type=PRESTATION&wp=WP_000000001"); p.Total != 1 {
		t.Fatalf("multi-filtres: %d", p.Total)
	}
	if p := page("?trigramme=PRG&activite=ACTIVITE_A&statut=ok"); p.Total != 6 {
		t.Fatalf("trigramme: %d", p.Total)
	}
	// Période et montants.
	if p := page("?date_from=2026-09-02&date_to=2026-09-30"); p.Total != 3 { // lignes 10, 11 (15/09) et 19 (05/09)
		t.Fatalf("période: %d", p.Total)
	}
	if p := page("?montant_max=0"); p.Total != 2 { // avoir + ligne au montant non numérique (0)
		t.Fatalf("montant_max: %d", p.Total)
	}
	if p := page("?montant_min=600&statut=ok"); p.Total != 4 {
		t.Fatalf("montant_min: %d", p.Total)
	}
	// Recherche plein-texte insensible casse/accents.
	if p := page("?q=etude%20RESEAU"); p.Total != 1 {
		t.Fatalf("q libellé: %d", p.Total)
	}
	if p := page("?q=ct_000000002"); p.Total != 1 {
		t.Fatalf("q tg: %d", p.Total)
	}
	if p := page("?q=cablage"); p.Total != 0 {
		t.Fatalf("q description sans search_description: %d", p.Total)
	}
	if p := page("?q=cablage&search_description=true"); p.Total != 1 {
		t.Fatalf("q description: %d", p.Total)
	}
	// … et sur nom_prenom (« NOM Prénom » sans civilité).
	if p := page("?q=durand%20CLAIRE"); p.Total != 1 || p.Items[0].NomPrenom != "DURAND Claire" ||
		p.Items[0].EmployeFournisseur != "DURAND Claire Mme" {
		t.Fatalf("q nom_prenom: %+v", p.Items)
	}
	if p := page("?q=dupont%20jean"); p.Total != 16 || p.Items[0].NomPrenom != "DUPONT Jean" {
		t.Fatalf("q nom_prenom dupont: %d", p.Total)
	}
	if p := page("?q=mme"); p.Total != 0 { // la civilité n'est pas cherchable
		t.Fatalf("q civilité: %d", p.Total)
	}
	if p := page("?q=durand&mask_sensitive=true"); p.Total != 1 || p.Items[0].NomPrenom != "" {
		t.Fatalf("q nom_prenom masqué: %+v", p.Items)
	}
	// Tri + pagination.
	p = page("?sort=total_eur&order=desc&statut=ok&limit=2&offset=0")
	if p.Total != 6 || len(p.Items) != 2 || p.Items[0].TotalEur != 1234.5 || p.Items[0].RowNum != 2 {
		t.Fatalf("tri desc: %+v", p.Items)
	}
	p = page("?sort=total_eur&statut=ok&limit=2&offset=0")
	if p.Items[0].TotalEur != -61800.5 || p.Items[1].TotalEur != 500 {
		t.Fatalf("tri asc: %+v", p.Items)
	}
	p = page("?sort=total_eur&statut=ok&limit=2&offset=5")
	if len(p.Items) != 1 || p.Total != 6 {
		t.Fatalf("dernière page: %d", len(p.Items))
	}
	if p := page("?sort=date_depense&order=desc&statut=ok"); p.Items[0].DateDepense != "2026-09-15" {
		t.Fatalf("tri date: %s", p.Items[0].DateDepense)
	}
	if p := page("?sort=tg&order=desc&limit=1"); p.Items[0].TG != "CT_000000002" {
		t.Fatalf("tri tg: %s", p.Items[0].TG)
	}
	if p := page("?offset=1000"); len(p.Items) != 0 || p.Total != 17 || p.Items == nil {
		t.Fatal("offset hors limites")
	}
	// Totaux sur tout le filtre (pas seulement la page).
	p = page("?statut=ok&statut=warn&limit=1")
	if p.Totals.TotalEur != 9*1234.5-61800.5+500 || p.Totals.Quantite != 9*7.5-3.5+2 ||
		p.Totals.ParCategorie["MAIN D'OEUVRE"] != 8 || p.Totals.ParCategorie["Y"] != 1 || p.Totals.ParCategorie["PRESTATION"] != 1 ||
		p.Totals.ParCategorie["BIDULE"] != 1 {
		t.Fatalf("totaux: %+v", p.Totals)
	}
	// Masquage.
	p = page("?mask_sensitive=true&limit=1")
	it := p.Items[0]
	if it.EmployeFournisseur != "" || it.NomPrenom != "" || it.Matricule != "" || it.NumFacture != "" || it.NumCommande != "" ||
		it.DescriptionDepenses != "" || it.TG == "" {
		t.Fatalf("masquage: %+v", it)
	}
	if it := page("?limit=1").Items[0]; it.Matricule != "A12345" || it.NomPrenom != "DUPONT Jean" {
		t.Fatal("non masqué par défaut")
	}
	// Paramètres invalides.
	for _, q := range []string{"?sort=foo", "?order=up", "?date_from=01/09/2026", "?montant_min=abc"} {
		if rec := e.do("GET", base+"/entries"+q, ""); rec.Code != 400 {
			t.Errorf("%s: %d", q, rec.Code)
		}
	}

	// Facets.
	f := decode[domain.Facets](t, e.do("GET", base+"/facets", ""), 200)
	if strings.Join(f["entite"], ",") != "ENTITE_A,ENTITE_B" || strings.Join(f["statut"], ",") != "drop,ok,warn" ||
		strings.Join(f["lot"], ",") != "LOT_1,LOT_2" || len(f["tg"]) != 2 || len(f["type"]) != 4 ||
		len(f["categorie"]) != 4 || len(f["wp"]) != 1 || len(f["activite"]) != 1 || len(f["trigramme"]) != 1 {
		t.Fatalf("facets: %v", f)
	}
}

func TestHTTPEntriesCSV(t *testing.T) {
	e := newEnv(t)
	v := importSpec(t, e)
	get := func(q string) [][]string {
		t.Helper()
		rec := e.do("GET", "/api/realise/versions/"+v.ID+"/entries.csv"+q, "")
		if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") {
			t.Fatalf("csv: %d", rec.Code)
		}
		body := rec.Body.String()
		if !strings.HasPrefix(body, "\xef\xbb\xbf") {
			t.Fatal("BOM manquant")
		}
		r := csv.NewReader(strings.NewReader(strings.TrimPrefix(body, "\xef\xbb\xbf")))
		r.Comma = ';'
		recs, err := r.ReadAll()
		if err != nil {
			t.Fatal(err)
		}
		return recs
	}
	recs := get("?statut=ok&sort=total_eur")
	if len(recs) != 7 || len(recs[0]) != len(CSVHeader) || recs[0][7] != "TG" {
		t.Fatalf("csv: %d lignes, %d colonnes", len(recs), len(recs[0]))
	}
	col := func(name string) int {
		for i, h := range CSVHeader {
			if h == name {
				return i
			}
		}
		t.Fatalf("colonne %s", name)
		return -1
	}
	if recs[1][col("TOTAL EN €")] != "-61800.5" || recs[1][col("QUANTITE")] != "-3.5" {
		t.Fatalf("avoir csv: %v", recs[1])
	}
	if recs[0][col("NOM PRENOM")-1] != "EMPLOYE/FOURNISSEUR" || recs[2][col("NOM PRENOM")] != "DURAND Claire" {
		t.Fatalf("colonne nom_prenom: %v", recs[2])
	}
	if recs[2][col("MATRICULE")] != "A12345" || recs[2][col("N° FACTURE")] == "" {
		t.Fatalf("non masqué: %v", recs[2])
	}
	masked := get("?mask_sensitive=true")
	if len(masked) != 18 {
		t.Fatalf("csv complet: %d", len(masked))
	}
	for _, r := range masked[1:] {
		for _, c := range []string{"EMPLOYE/FOURNISSEUR", "NOM PRENOM", "MATRICULE", "N° FACTURE", "n° COMMANDE", "DESCRIPTION DEPENSES", "NOM RESSOURCE", "FOURNISSEUR"} {
			if r[col(c)] != "" {
				t.Fatalf("colonne %s non masquée: %v", c, r)
			}
		}
		if r[col("TG")] == "" && r[col("STATUT PARSING")] != "drop" {
			t.Fatal("TG vide")
		}
	}
}

func TestDemoEntriesMasked(t *testing.T) {
	e := newEnv(t)
	v := decode[domain.ImportResult](t, e.upload("/api/realise/imports", loadDemo(t), "demo_realise.xlsx", nil), 201).Version
	p := decode[domain.RealiseEntriesPage](t, e.do("GET", "/api/realise/versions/"+v.ID+"/entries?limit=5000&mask_sensitive=true", ""), 200)
	if p.Total != 482 || p.Totals.TotalEur != 403130.43 {
		t.Fatalf("démo: %d %.2f", p.Total, p.Totals.TotalEur)
	}
	for _, it := range p.Items {
		if it.NomRessource != "" || it.Fournisseur != "" || it.EmployeFournisseur != "" || it.NomPrenom != "" {
			t.Fatal("masquage démo")
		}
	}
	if p.Totals.ParCategorie["MAIN D'OEUVRE"] != 333 {
		t.Fatalf("par catégorie: %v", p.Totals.ParCategorie)
	}
	p = decode[domain.RealiseEntriesPage](t, e.do("GET", "/api/realise/versions/"+v.ID+"/entries?q=reserve%20de%20CAPACITE&limit=1", ""), 200)
	if p.Total == 0 || p.Items[0].TG != "Y99F900011" {
		t.Fatalf("recherche démo: %d", p.Total)
	}
}
