package referentiel

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
	"njord/internal/xlsxutil"
)

func fold(s string) string { return strings.ToLower(xlsxutil.StripAccents(s)) }

// listPersonnes loads personnes (all when id == ""), sorted by display name.
func listPersonnes(ctx context.Context, ex store.Execer, id string) ([]domain.Personne, error) {
	where, args := "", []any{}
	if id != "" {
		where, args = " WHERE id = ?", []any{id}
	}
	rows, err := ex.QueryContext(ctx, `SELECT id, display_name, nom_normalise, statut, squad_id, created_at FROM personnes`+where, args...)
	if err != nil {
		return nil, err
	}
	out := []domain.Personne{}
	for rows.Next() {
		var p domain.Personne
		var sq sql.NullString
		var created string
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.NomNormalise, &p.Statut, &sq, &created); err != nil {
			rows.Close()
			return nil, err
		}
		if sq.Valid {
			s := sq.String
			p.SquadID = &s
		}
		p.CreatedAt = store.ParseTime(created)
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := fold(out[i].DisplayName), fold(out[j].DisplayName)
		if a != b {
			return a < b
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func getPersonne(ctx context.Context, ex store.Execer, id string) (domain.Personne, error) {
	ps, err := listPersonnes(ctx, ex, id)
	if err != nil {
		return domain.Personne{}, err
	}
	if len(ps) == 0 {
		return domain.Personne{}, store.ErrNotFound
	}
	return ps[0], nil
}

// matchPersonne: q (already folded) in the display name, case/accent-insensitive.
// The name is the only identity of a personne (DECISIONS n° 8).
func matchPersonne(p domain.Personne, q string) bool {
	return q == "" || strings.Contains(fold(p.DisplayName), q)
}

func listSquads(ctx context.Context, ex store.Execer, id string) ([]domain.Squad, error) {
	where, args := "", []any{}
	if id != "" {
		where, args = " WHERE id = ?", []any{id}
	}
	rows, err := ex.QueryContext(ctx, `SELECT id, nom_canonique, entite_rattachee, parent_id, created_at FROM squads`+where+` ORDER BY nom_canonique, id`, args...)
	if err != nil {
		return nil, err
	}
	out := []domain.Squad{}
	idx := map[string]int{}
	for rows.Next() {
		var s domain.Squad
		var parent sql.NullString
		var created string
		if err := rows.Scan(&s.ID, &s.NomCanonique, &s.EntiteRattachee, &parent, &created); err != nil {
			rows.Close()
			return nil, err
		}
		if parent.Valid {
			p := parent.String
			s.ParentID = &p
		}
		s.CreatedAt = store.ParseTime(created)
		s.Alias = []string{}
		idx[s.ID] = len(out)
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	swhere := ""
	if id != "" {
		swhere = " WHERE squad_id = ?"
	}
	rows, err = ex.QueryContext(ctx, `SELECT squad_id, alias FROM squad_alias`+swhere+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var sid, a string
		if err := rows.Scan(&sid, &a); err != nil {
			return nil, err
		}
		if i, ok := idx[sid]; ok {
			out[i].Alias = append(out[i].Alias, a)
		}
	}
	return out, rows.Err()
}

func getSquad(ctx context.Context, ex store.Execer, id string) (domain.Squad, error) {
	ss, err := listSquads(ctx, ex, id)
	if err != nil {
		return domain.Squad{}, err
	}
	if len(ss) == 0 {
		return domain.Squad{}, store.ErrNotFound
	}
	return ss[0], nil
}

func exists(ctx context.Context, ex store.Execer, q string, args ...any) (bool, error) {
	var x int
	err := ex.QueryRowContext(ctx, q, args...).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// squadKeyOwner returns the squad owning key (as nom_normalise or alias), or "".
func squadKeyOwner(ctx context.Context, ex store.Execer, key string) (string, error) {
	var id string
	err := ex.QueryRowContext(ctx, `SELECT id FROM squads WHERE nom_normalise = ?
		UNION ALL SELECT squad_id FROM squad_alias WHERE alias_normalise = ? LIMIT 1`, key, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}
