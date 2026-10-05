package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"njord/internal/domain"
)

func TestLifecycle(t *testing.T) {
	ctx := context.Background()
	st, err := OpenMemory()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	st.Now = func() time.Time { return now }
	insertLine := func(tx *sql.Tx, id string) error {
		_, err := tx.Exec(`INSERT INTO plan_lines(version_id,row_num,statut_parsing) VALUES (?,1,'ok')`, id)
		return err
	}
	v1 := domain.Version{Kind: domain.KindPlan, Intitule: "V1"}
	if err := st.CreateVersion(ctx, &v1, true, insertLine); err != nil {
		t.Fatal(err)
	}
	if v1.Statut != domain.StatutActive {
		t.Fatalf("v1 statut %s", v1.Statut)
	}
	v2 := domain.Version{Kind: domain.KindPlan, Intitule: "V2"}
	if err := st.CreateVersion(ctx, &v2, false, insertLine); err != nil {
		t.Fatal(err)
	}
	if v2.Statut != domain.StatutArchivee {
		t.Fatalf("v2 should be born archived, got %s", v2.Statut)
	}
	v3 := domain.Version{Kind: domain.KindPlan, Intitule: "V3"}
	if err := st.CreateVersion(ctx, &v3, true, insertLine); err != nil {
		t.Fatal(err)
	}
	a, _ := st.ActiveVersion(ctx, domain.KindPlan)
	if a == nil || a.ID != v3.ID {
		t.Fatal("v3 should be active")
	}
	if _, err := st.Reactivate(ctx, domain.KindPlan, v1.ID, "u"); err != nil {
		t.Fatal(err)
	}
	a, _ = st.ActiveVersion(ctx, domain.KindPlan)
	if a.ID != v1.ID {
		t.Fatal("v1 should be active again")
	}
	// Purge: too early, then wrong title, then ok.
	if _, err := st.Purge(ctx, domain.KindPlan, v2.ID, "V2", "u"); err == nil {
		t.Fatal("purge should be refused before 30 days")
	}
	now = now.AddDate(0, 0, 31)
	if _, err := st.Purge(ctx, domain.KindPlan, v2.ID, "v2", "u"); err == nil {
		t.Fatal("purge should require exact title")
	}
	p, err := st.Purge(ctx, domain.KindPlan, v2.ID, "V2", "u")
	if err != nil || p.Statut != domain.StatutPurgee {
		t.Fatalf("purge: %v %v", err, p.Statut)
	}
	var n int
	st.DB().QueryRow(`SELECT COUNT(*) FROM plan_lines WHERE version_id = ?`, v2.ID).Scan(&n)
	if n != 0 {
		t.Fatal("lines not purged")
	}
	vs, _ := st.ListVersions(ctx, domain.KindPlan, false)
	if len(vs) != 2 || vs[0].ID != v1.ID {
		t.Fatalf("list: %+v", vs)
	}
	audit, _ := st.ListAudit(ctx, "", 100)
	if len(audit) < 6 {
		t.Fatalf("audit entries: %d", len(audit))
	}
	s, _ := st.GetSettings(ctx)
	if s.PurgeDelaiJours != 30 || len(s.JoursFeries) == 0 {
		t.Fatal("default settings")
	}
}

func TestEaster(t *testing.T) {
	if got := easterSunday(2026).Format("2006-01-02"); got != "2026-04-05" {
		t.Fatal(got)
	}
}

// Une base créée avant l'ajout de plan_lines.nom_prenom reçoit la colonne à l'ouverture.
func TestMigrateAddedColumn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.DB().Exec(`ALTER TABLE plan_lines DROP COLUMN nom_prenom`); err != nil {
		t.Fatal(err)
	}
	st.Close()
	if st, err = Open(path); err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var n int
	if err := st.DB().QueryRow(`SELECT COUNT(*) FROM pragma_table_info('plan_lines') WHERE name = 'nom_prenom'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("colonne nom_prenom : %d %v", n, err)
	}
}
