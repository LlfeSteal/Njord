package store

import "testing"

// A base from before DECISIONS n° 8: homonyms, a record named after a code,
// lines linked by code. The migration re-keys everything on NOM + Prénom.
func TestIdentiteNomPrenomMigration(t *testing.T) {
	st, err := OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	db := st.DB()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`DROP INDEX personnes_cle`)
	exec(`INSERT INTO personnes(id, display_name, nom_normalise, statut, created_at) VALUES
		('p1','DURAND Claire','CLAIRE DURAND','brouillon','2026-01-01T00:00:00Z'),
		('p2','Claire DURAND','CLAIRE DURAND','validee','2026-01-02T00:00:00Z'),
		('p3','R_001','R_001','brouillon','2026-01-03T00:00:00Z')`)
	exec(`INSERT INTO versions(id, kind, intitule, importee_le, statut) VALUES ('v1','plan','V1','2026-01-01T00:00:00Z','active')`)
	exec(`INSERT INTO plan_lines(version_id, row_num, ressource, libelle, statut_parsing, personne_id) VALUES
		('v1', 2, 'R_001', 'DURAND Claire / Squad Alpha', 'ok', 'p3'),
		('v1', 3, 'DURANDC', 'PO', 'ok', 'p1'),
		('v1', 4, 'BONNETH', 'BONNET Hugo', 'ok', NULL)`)
	exec(`INSERT INTO versions(id, kind, intitule, importee_le, statut) VALUES ('r1','realise','R1','2026-01-01T00:00:00Z','active')`)
	exec(`INSERT INTO realise_entries(version_id, row_num, employe_fournisseur, statut_parsing) VALUES ('r1', 2, 'DE LA TOUR Antoine Mr.', 'ok')`)
	exec(`PRAGMA user_version = 0`)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('personne_alias','personne_matricules')`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("old tables still present (%d, %v)", n, err)
	}
	type p struct{ display, key, statut string }
	got := map[string]p{}
	rows, err := db.Query(`SELECT id, display_name, nom_normalise, statut FROM personnes`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		var x p
		rows.Scan(&id, &x.display, &x.key, &x.statut)
		got[x.key] = x
		if x.key == "DURAND|CLAIRE" && id != "p1" {
			t.Errorf("homonyms must merge into the oldest record, got %s", id)
		}
	}
	rows.Close()
	if len(got) != 2 || got["DURAND|CLAIRE"].statut != "validee" || got["BONNET|HUGO"].display != "BONNET Hugo" {
		t.Fatalf("personnes = %+v", got)
	}

	lines := map[int][2]string{}
	rows, err = db.Query(`SELECT l.row_num, l.nom_prenom, COALESCE(p.nom_normalise, '') FROM plan_lines l LEFT JOIN personnes p ON p.id = l.personne_id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var r int
		var np, key string
		rows.Scan(&r, &np, &key)
		lines[r] = [2]string{np, key}
	}
	rows.Close()
	want := map[int][2]string{2: {"DURAND Claire", "DURAND|CLAIRE"}, 3: {"", ""}, 4: {"BONNET Hugo", "BONNET|HUGO"}}
	for r, w := range want {
		if lines[r] != w {
			t.Errorf("line %d = %v, want %v", r, lines[r], w)
		}
	}

	var np string
	if err := db.QueryRow(`SELECT nom_prenom FROM realise_entries`).Scan(&np); err != nil || np != "DE LA TOUR Antoine" {
		t.Errorf("realise nom_prenom = %q (%v)", np, err)
	}
	// Unicité de la clé et migration non rejouée.
	if _, err := db.Exec(`INSERT INTO personnes(id, display_name, nom_normalise, created_at) VALUES ('x','DURAND Claire','DURAND|CLAIRE','now')`); err == nil {
		t.Error("nom_normalise must be unique")
	}
	var v int
	db.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != len(dataMigrations) {
		t.Errorf("user_version = %d", v)
	}
}
