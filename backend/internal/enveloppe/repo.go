package enveloppe

import (
	"context"
	"database/sql"
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
)

// ctInfo accumulates what the sources say about one CT.
type ctInfo struct {
	sources   domain.EnveloppeSources
	realise   string // libellé TG du réalisé, préfixe CT retiré
	prov      string // dernier segment du groupe des provisions
	plan      string // groupe du plan
	enveloppe *domain.Enveloppe
}

func (i *ctInfo) libelle() string {
	for _, l := range []string{i.realise, i.prov, i.plan} {
		if l != "" {
			return l
		}
	}
	return ""
}

// Sources des CT (DECISIONS n° 18). Ordre des lignes = celui de l'analyse
// (row_num, id) pour que le premier libellé retenu soit le même.
const (
	// Plan : versions non purgées, l'active d'abord puis les plus récentes.
	qPlan = `SELECT pl.ct, pl.groupe FROM plan_lines pl JOIN versions v ON v.id = pl.version_id
		WHERE v.kind = 'plan' AND v.statut <> 'purgee' AND pl.statut_parsing <> 'drop'
		ORDER BY v.statut = 'active' DESC, v.importee_le DESC, v.id, pl.row_num, pl.id`
	qRealise = `SELECT e.tg, e.tg_libelle FROM realise_entries e JOIN versions v ON v.id = e.version_id
		WHERE v.kind = 'realise' AND v.statut = 'active' AND e.statut_parsing <> 'drop'
		ORDER BY e.row_num, e.id`
	qProvision = `SELECT p.ct, p.groupe FROM provision_lines p JOIN versions v ON v.id = p.version_id
		WHERE v.kind = 'provision' AND v.statut = 'active' AND p.statut_parsing <> 'drop'
		ORDER BY p.row_num, p.id`
	qEnveloppes = `SELECT ct, date_debut, date_fin, montant, commentaire, operateur, updated_at FROM ct_enveloppes`
)

// listCTs returns every known CT (union of the sources and of the configured
// envelopes) with its label and envelope, sorted by CT. Never nil.
func listCTs(ctx context.Context, ex store.Execer) ([]domain.EnveloppeCT, error) {
	cts := map[string]*ctInfo{}
	info := func(ct string) *ctInfo {
		i := cts[ct]
		if i == nil {
			i = &ctInfo{}
			cts[ct] = i
		}
		return i
	}
	// scan reads (ct, libellé) pairs; empty CT ignored.
	scan := func(q string, fn func(i *ctInfo, ct, lib string)) error {
		rows, err := ex.QueryContext(ctx, q)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ct, lib string
			if err := rows.Scan(&ct, &lib); err != nil {
				return err
			}
			if ct = strings.TrimSpace(ct); ct != "" {
				fn(info(ct), ct, lib)
			}
		}
		return rows.Err()
	}
	if err := scan(qPlan, func(i *ctInfo, _, groupe string) {
		i.sources.Plan = true
		if i.plan == "" {
			i.plan = strings.TrimSpace(groupe)
		}
	}); err != nil {
		return nil, err
	}
	if err := scan(qRealise, func(i *ctInfo, ct, lib string) {
		i.sources.Realise = true
		if i.realise == "" && strings.TrimSpace(lib) != "" {
			i.realise = ctLabel(ct, lib)
		}
	}); err != nil {
		return nil, err
	}
	if err := scan(qProvision, func(i *ctInfo, _, groupe string) {
		i.sources.Provisions = true
		if i.prov == "" {
			i.prov = lastSegment(groupe)
		}
	}); err != nil {
		return nil, err
	}
	if err := loadEnveloppes(ctx, ex, info); err != nil {
		return nil, err
	}

	out := make([]domain.EnveloppeCT, 0, len(cts))
	for ct, i := range cts {
		out = append(out, domain.EnveloppeCT{CT: ct, CTLibelle: i.libelle(), Sources: i.sources, Enveloppe: i.enveloppe})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].CT < out[b].CT })
	return out, nil
}

func loadEnveloppes(ctx context.Context, ex store.Execer, info func(ct string) *ctInfo) error {
	rows, err := ex.QueryContext(ctx, qEnveloppes)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ct, updated string
		var e domain.Enveloppe
		if err := rows.Scan(&ct, &e.DateDebut, &e.DateFin, &e.Montant, &e.Commentaire, &e.Operateur, &updated); err != nil {
			return err
		}
		e.UpdatedAt = store.ParseTime(updated)
		info(ct).enveloppe = &e
	}
	return rows.Err()
}

// getCT returns the EnveloppeCT of ct, store.ErrNotFound when unknown.
func getCT(ctx context.Context, ex store.Execer, ct string) (domain.EnveloppeCT, error) {
	all, err := listCTs(ctx, ex)
	if err != nil {
		return domain.EnveloppeCT{}, err
	}
	k := sort.Search(len(all), func(i int) bool { return all[i].CT >= ct })
	if k == len(all) || all[k].CT != ct {
		return domain.EnveloppeCT{}, store.ErrNotFound
	}
	return all[k], nil
}

// upsertEnveloppe writes the envelope of ct (one per CT).
func upsertEnveloppe(ctx context.Context, tx *sql.Tx, ct string, e domain.Enveloppe, updatedAt string) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO ct_enveloppes(ct, date_debut, date_fin, montant, commentaire, operateur, updated_at) VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(ct) DO UPDATE SET date_debut = excluded.date_debut, date_fin = excluded.date_fin, montant = excluded.montant,
			commentaire = excluded.commentaire, operateur = excluded.operateur, updated_at = excluded.updated_at`,
		ct, e.DateDebut, e.DateFin, e.Montant, e.Commentaire, e.Operateur, updatedAt)
	return err
}

// deleteEnveloppe deletes the envelope of ct, store.ErrNotFound when it has none.
func deleteEnveloppe(ctx context.Context, tx *sql.Tx, ct string) error {
	res, err := tx.ExecContext(ctx, `DELETE FROM ct_enveloppes WHERE ct = ?`, ct)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return store.ErrNotFound
	}
	return nil
}

// ctLabel retire le code en tête du libellé TG du réalisé (« Y99F900011 - Réserve… » → « Réserve… ») ;
// copie de analyse.ctLabel, à garder identique.
func ctLabel(tg, libelle string) string {
	l := strings.TrimSpace(libelle)
	if rest, ok := strings.CutPrefix(l, tg); ok {
		if t := strings.TrimLeft(rest, " -–—:"); t != "" {
			return t
		}
	}
	return l
}

// lastSegment: dernier segment du groupe des provisions (« Programme > Socle » → « Socle »),
// le sous-projet de l'export étant le CT (cf. analyse.provisionLibelles).
func lastSegment(groupe string) string {
	if k := strings.LastIndex(groupe, ">"); k >= 0 {
		groupe = groupe[k+1:]
	}
	return strings.TrimSpace(groupe)
}
