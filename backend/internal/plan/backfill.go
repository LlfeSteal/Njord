package plan

import (
	"context"

	"njord/internal/names"
	"njord/internal/store"
)

// BackfillNomPrenom remplit nom_prenom des lignes importées avant l'ajout de la
// colonne (calcul identique au parser ; les statuts de parsing ne changent qu'au
// réimport). Idempotent : ne touche que les lignes sans nom_prenom. Renvoie le
// nombre de lignes complétées.
func BackfillNomPrenom(ctx context.Context, st *store.Store) (int, error) {
	rows, err := st.DB().QueryContext(ctx, `SELECT id, libelle, ressource FROM plan_lines WHERE nom_prenom = '' AND libelle <> ''`)
	if err != nil {
		return 0, err
	}
	type upd struct {
		id int64
		np string
	}
	var todo []upd
	for rows.Next() {
		var id int64
		var libelle, ressource string
		if err := rows.Scan(&id, &libelle, &ressource); err != nil {
			rows.Close()
			return 0, err
		}
		person, _ := names.SplitLibelle(libelle, nil)
		switch np, s := names.ParseNomPrenom(person, ressource); s {
		case names.NomPrenomOK:
			todo = append(todo, upd{id, np.String()})
		case names.NomPrenomAmbigu:
			todo = append(todo, upd{id, person})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, u := range todo {
		if _, err := st.DB().ExecContext(ctx, `UPDATE plan_lines SET nom_prenom = ? WHERE id = ?`, u.np, u.id); err != nil {
			return 0, err
		}
	}
	return len(todo), nil
}
