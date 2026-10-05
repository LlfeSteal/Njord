package plan

import (
	"context"
	"testing"
)

// Import démo : fiches au format « NOM Prénom », puis rétro-remplissage d'une
// base dont les lignes n'ont pas encore de nom_prenom.
func TestNomPrenomReferentielEtBackfill(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)
	if _, err := NewService(st).Commit(ctx, readDemo(t), "demo_plancharge.xlsx", "PDC", "alice", true); err != nil {
		t.Fatal(err)
	}
	for code, want := range map[string]string{"PETITK": "PETIT Karim", "DELATOURA": "DE LA TOUR Antoine", "ROBERTM": "ROBERT Michel"} {
		got := str(t, st, `SELECT p.display_name FROM personnes p JOIN personne_matricules m ON m.personne_id = p.id WHERE m.matricule = ?`, code)
		if got != want {
			t.Errorf("%s : display_name %q, attendu %q", code, got, want)
		}
	}
	// L'alias d'import garde la forme brute du libellé (rapprochement réalisé).
	if n := count(t, st, `SELECT COUNT(*) FROM personne_alias WHERE alias = 'Karim PETIT'`); n != 1 {
		t.Errorf("alias brut « Karim PETIT » : %d", n)
	}

	if _, err := st.DB().ExecContext(ctx, `UPDATE plan_lines SET nom_prenom = ''`); err != nil {
		t.Fatal(err)
	}
	n, err := BackfillNomPrenom(ctx, st)
	if err != nil || n != 30 {
		t.Fatalf("backfill %d %v", n, err)
	}
	if got := str(t, st, `SELECT nom_prenom FROM plan_lines WHERE row_num = 18`); got != "PETIT Karim" {
		t.Errorf("ligne 18 : %q", got)
	}
	if n, _ := BackfillNomPrenom(ctx, st); n != 0 {
		t.Errorf("second passage : %d lignes", n)
	}
}
