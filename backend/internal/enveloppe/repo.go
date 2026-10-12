package enveloppe

import (
	"context"
	"database/sql"
	"errors"
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
	categorie string // code de la catégorie du fichier
	categLib  string // Descriptif de la catégorie
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
	qEnveloppes = `SELECT ct, categorie, categorie_libelle, date_debut, date_fin, montant FROM enveloppes`
	qImport     = `SELECT filename, importe_le, operateur, nb_enveloppes FROM enveloppes_import WHERE id = 1`
)

// listCTs returns the last import and every known CT (union of the sources and
// of the imported envelopes) with its label, category and envelope; CTs never nil.
func listCTs(ctx context.Context, ex store.Execer) (domain.EnveloppesListe, error) {
	var liste domain.EnveloppesListe
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
		return liste, err
	}
	if err := scan(qRealise, func(i *ctInfo, ct, lib string) {
		i.sources.Realise = true
		if i.realise == "" && strings.TrimSpace(lib) != "" {
			i.realise = ctLabel(ct, lib)
		}
	}); err != nil {
		return liste, err
	}
	if err := scan(qProvision, func(i *ctInfo, _, groupe string) {
		i.sources.Provisions = true
		if i.prov == "" {
			i.prov = lastSegment(groupe)
		}
	}); err != nil {
		return liste, err
	}
	if err := loadEnveloppes(ctx, ex, info); err != nil {
		return liste, err
	}

	imp, err := loadImport(ctx, ex)
	if err != nil {
		return liste, err
	}

	out := make([]domain.EnveloppeCT, 0, len(cts))
	for ct, i := range cts {
		out = append(out, domain.EnveloppeCT{CT: ct, CTLibelle: i.libelle(), Categorie: i.categorie,
			CategorieLibelle: i.categLib, Sources: i.sources, Enveloppe: i.enveloppe})
	}
	// Par code de catégorie puis CT ; hors catégorie (enveloppe sans
	// catégorie) puis hors fichier (sans enveloppe) en dernier.
	rank := func(x domain.EnveloppeCT) int {
		switch {
		case x.Enveloppe == nil:
			return 2
		case x.Categorie == "":
			return 1
		}
		return 0
	}
	sort.Slice(out, func(a, b int) bool {
		x, y := out[a], out[b]
		if rx, ry := rank(x), rank(y); rx != ry {
			return rx < ry
		}
		if x.Categorie != y.Categorie {
			return x.Categorie < y.Categorie
		}
		return x.CT < y.CT
	})
	return domain.EnveloppesListe{Import: imp, CTs: out}, nil
}

func loadEnveloppes(ctx context.Context, ex store.Execer, info func(ct string) *ctInfo) error {
	rows, err := ex.QueryContext(ctx, qEnveloppes)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ct, categ, categLib string
		var e domain.Enveloppe
		if err := rows.Scan(&ct, &categ, &categLib, &e.DateDebut, &e.DateFin, &e.Montant); err != nil {
			return err
		}
		i := info(strings.TrimSpace(ct))
		i.categorie, i.categLib, i.enveloppe = categ, categLib, &e
	}
	return rows.Err()
}

// loadImport returns the last import, nil when no file was ever imported.
func loadImport(ctx context.Context, ex store.Execer) (*domain.EnveloppesImport, error) {
	var imp domain.EnveloppesImport
	var at string
	err := ex.QueryRowContext(ctx, qImport).Scan(&imp.Filename, &at, &imp.Operateur, &imp.NbEnveloppes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	imp.ImporteLe = store.ParseTime(at)
	return &imp, nil
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
