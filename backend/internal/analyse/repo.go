package analyse

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"njord/internal/domain"
	"njord/internal/names"
	"njord/internal/store"
)

// Repo reads the analysis inputs from SQLite and writes the only two things
// the module owns: confirmed aliases and the last rendered result.
type Repo struct{ st *store.Store }

func NewRepo(st *store.Store) *Repo { return &Repo{st: st} }

const planCols = `id, version_id, row_num, layout, ct, ressource, libelle, type_affectation, ligne_cout,
	charge_totale, pps, pourcentage, unite, calcul_duree, date_debut, date_fin, quantite_affectee,
	taux_fixe, depuis, pendant, statut_parsing, motif_rejet, ressource_kind, inactive, personne_id, squad_id, groupe`

// PlanLines returns the non-drop lines of a plan version.
func (r *Repo) PlanLines(ctx context.Context, versionID string) ([]domain.PlanLine, error) {
	rows, err := r.st.DB().QueryContext(ctx, `SELECT `+planCols+` FROM plan_lines
		WHERE version_id = ? AND statut_parsing <> 'drop' ORDER BY row_num, id`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.PlanLine{}
	for rows.Next() {
		var l domain.PlanLine
		var qa sql.NullFloat64
		var pid, sid sql.NullString
		var inactive int
		if err := rows.Scan(&l.ID, &l.VersionID, &l.RowNum, &l.Layout, &l.CT, &l.Ressource, &l.Libelle,
			&l.TypeAffectation, &l.LigneCout, &l.ChargeTotale, &l.PPS, &l.Pourcentage, &l.Unite, &l.CalculDuree,
			&l.DateDebut, &l.DateFin, &qa, &l.TauxFixe, &l.Depuis, &l.Pendant, &l.StatutParsing, &l.MotifRejet,
			&l.RessourceKind, &inactive, &pid, &sid, &l.Groupe); err != nil {
			return nil, err
		}
		if qa.Valid {
			v := qa.Float64
			l.QuantiteAffectee = &v
		}
		l.Inactive = inactive != 0
		l.PersonneID = nullStr(pid)
		l.SquadID = nullStr(sid)
		out = append(out, l)
	}
	return out, rows.Err()
}

const entryCols = `id, version_id, row_num, entite, activite, sous_activite, trigramme, tg, tg_libelle, wp,
	wp_libelle, description_depenses, categorie, type, categorie_fnp, employe_fournisseur, matricule, fpc, cea,
	quantite, total_eur, date_depense, periode_comptable, compte_comptable, num_facture, num_commande, num_ligne,
	lot_ifrs15, nom_ressource, fournisseur, code_article, mois_comptable, statut_parsing, motif_rejet`

// Entries returns the non-drop entries of a réalisé version.
func (r *Repo) Entries(ctx context.Context, versionID string) ([]domain.RealiseEntry, error) {
	rows, err := r.st.DB().QueryContext(ctx, `SELECT `+entryCols+` FROM realise_entries
		WHERE version_id = ? AND statut_parsing <> 'drop' ORDER BY row_num, id`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.RealiseEntry{}
	for rows.Next() {
		var e domain.RealiseEntry
		var nl sql.NullInt64
		if err := rows.Scan(&e.ID, &e.VersionID, &e.RowNum, &e.Entite, &e.Activite, &e.SousActivite, &e.Trigramme,
			&e.TG, &e.TGLibelle, &e.WP, &e.WPLibelle, &e.DescriptionDepenses, &e.Categorie, &e.Type, &e.CategorieFNP,
			&e.EmployeFournisseur, &e.Matricule, &e.FPC, &e.CEA, &e.Quantite, &e.TotalEur, &e.DateDepense,
			&e.PeriodeComptable, &e.CompteComptable, &e.NumFacture, &e.NumCommande, &nl, &e.LotIFRS15,
			&e.NomRessource, &e.Fournisseur, &e.CodeArticle, &e.MoisComptable, &e.StatutParsing, &e.MotifRejet); err != nil {
			return nil, err
		}
		if nl.Valid {
			v := int(nl.Int64)
			e.NumLigne = &v
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func nullStr(ns sql.NullString) *string {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	s := ns.String
	return &s
}

// Personnes returns every person with matricules and aliases (filter by id if ids given).
func (r *Repo) Personnes(ctx context.Context, ids ...string) ([]domain.Personne, error) {
	db := r.st.DB()
	q := `SELECT id, display_name, nom_normalise, statut, squad_id, created_at FROM personnes`
	args := []any{}
	if len(ids) > 0 {
		q += ` WHERE id IN (?` + strings.Repeat(",?", len(ids)-1) + `)`
		for _, id := range ids {
			args = append(args, id)
		}
	}
	q += ` ORDER BY id`
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	out := []domain.Personne{}
	idx := map[string]int{}
	for rows.Next() {
		var p domain.Personne
		var sid sql.NullString
		var created string
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.NomNormalise, &p.Statut, &sid, &created); err != nil {
			rows.Close()
			return nil, err
		}
		p.SquadID = nullStr(sid)
		p.CreatedAt = store.ParseTime(created)
		p.Matricules = []string{}
		p.Alias = []domain.PersonneAlias{}
		idx[p.ID] = len(out)
		out = append(out, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	mrows, err := db.QueryContext(ctx, `SELECT personne_id, matricule FROM personne_matricules ORDER BY personne_id, matricule`)
	if err != nil {
		return nil, err
	}
	for mrows.Next() {
		var pid, m string
		if err := mrows.Scan(&pid, &m); err != nil {
			mrows.Close()
			return nil, err
		}
		if i, ok := idx[pid]; ok {
			out[i].Matricules = append(out[i].Matricules, m)
		}
	}
	mrows.Close()

	arows, err := db.QueryContext(ctx, `SELECT id, personne_id, alias, alias_normalise, source FROM personne_alias ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var a domain.PersonneAlias
		var pid string
		if err := arows.Scan(&a.ID, &pid, &a.Alias, &a.AliasNormalise, &a.Source); err != nil {
			return nil, err
		}
		if i, ok := idx[pid]; ok {
			out[i].Alias = append(out[i].Alias, a)
		}
	}
	return out, arows.Err()
}

// Personne returns one person (store.ErrNotFound if absent).
func (r *Repo) Personne(ctx context.Context, id string) (domain.Personne, error) {
	ps, err := r.Personnes(ctx, id)
	if err != nil {
		return domain.Personne{}, err
	}
	if len(ps) == 0 {
		return domain.Personne{}, store.ErrNotFound
	}
	return ps[0], nil
}

// Squads returns every squad with its aliases.
func (r *Repo) Squads(ctx context.Context) ([]domain.Squad, error) {
	db := r.st.DB()
	rows, err := db.QueryContext(ctx, `SELECT id, nom_canonique, entite_rattachee, parent_id, created_at FROM squads ORDER BY id`)
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
		s.ParentID = nullStr(parent)
		s.CreatedAt = store.ParseTime(created)
		s.Alias = []string{}
		idx[s.ID] = len(out)
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	arows, err := db.QueryContext(ctx, `SELECT squad_id, alias FROM squad_alias ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer arows.Close()
	for arows.Next() {
		var sid, a string
		if err := arows.Scan(&sid, &a); err != nil {
			return nil, err
		}
		if i, ok := idx[sid]; ok {
			out[i].Alias = append(out[i].Alias, a)
		}
	}
	return out, arows.Err()
}

// LoadInput loads every engine input for the two versions.
func (r *Repo) LoadInput(ctx context.Context, plan, realise domain.Version) (Input, error) {
	in := Input{Plan: plan, Realise: realise}
	var err error
	if in.PlanLines, err = r.PlanLines(ctx, plan.ID); err != nil {
		return in, err
	}
	if in.Entries, err = r.Entries(ctx, realise.ID); err != nil {
		return in, err
	}
	if in.Personnes, err = r.Personnes(ctx); err != nil {
		return in, err
	}
	if in.Squads, err = r.Squads(ctx); err != nil {
		return in, err
	}
	return in, nil
}

// Precondition messages (SPEC_analyse §9).
const (
	msgNoPlan    = "Aucun plan de charge actif : importez ou réactivez un plan"
	msgNoRealise = "Aucun réalisé actif : importez ou réactivez un réalisé"
)

// ResolveVersion returns the chosen version (id != "") or the active one.
// Missing active version → store.Precondition; unknown id → store.ErrNotFound;
// purged version → store.Precondition.
func (r *Repo) ResolveVersion(ctx context.Context, kind domain.Kind, id string) (domain.Version, error) {
	if id != "" {
		v, err := r.st.GetVersion(ctx, kind, id)
		if err != nil {
			return v, err
		}
		if v.Statut == domain.StatutPurgee {
			return v, store.Precondition("la version « %s » est purgée : analyse impossible", v.Intitule)
		}
		return v, nil
	}
	v, err := r.st.ActiveVersion(ctx, kind)
	if err != nil {
		return domain.Version{}, err
	}
	if v == nil {
		if kind == domain.KindPlan {
			return domain.Version{}, store.Precondition(msgNoPlan)
		}
		return domain.Version{}, store.Precondition(msgNoRealise)
	}
	return *v, nil
}

// planRange / realRange: dates covered by the non-drop lines of a version.
func (r *Repo) planRange(ctx context.Context, versionID string) (string, string, error) {
	var a, b sql.NullString
	err := r.st.DB().QueryRowContext(ctx, `SELECT MIN(substr(date_debut,1,10)), MAX(substr(date_fin,1,10)) FROM plan_lines
		WHERE version_id = ? AND statut_parsing <> 'drop' AND date_debut <> '' AND date_fin <> ''`, versionID).Scan(&a, &b)
	return a.String, b.String, err
}

func (r *Repo) realRange(ctx context.Context, versionID string) (string, string, error) {
	var a, b sql.NullString
	err := r.st.DB().QueryRowContext(ctx, `SELECT MIN(substr(date_depense,1,10)), MAX(substr(date_depense,1,10)) FROM realise_entries
		WHERE version_id = ? AND statut_parsing <> 'drop' AND date_depense <> ''`, versionID).Scan(&a, &b)
	return a.String, b.String, err
}

// Context builds the analysis screen context (versions, defaults, weeks).
func (r *Repo) Context(ctx context.Context) (domain.AnalyseContext, error) {
	out := domain.AnalyseContext{Weeks: []domain.WeekInfo{}}
	s, err := r.st.GetSettings(ctx)
	if err != nil {
		return out, err
	}
	if out.PlanVersions, err = r.st.ListVersions(ctx, domain.KindPlan, false); err != nil {
		return out, err
	}
	if out.RealiseVersions, err = r.st.ListVersions(ctx, domain.KindRealise, false); err != nil {
		return out, err
	}
	var pMin, pMax, rMin, rMax string
	var msgs []string
	if v, err := r.st.ActiveVersion(ctx, domain.KindPlan); err != nil {
		return out, err
	} else if v != nil {
		out.DefaultPlanID = &v.ID
		if pMin, pMax, err = r.planRange(ctx, v.ID); err != nil {
			return out, err
		}
	} else {
		msgs = append(msgs, msgNoPlan)
	}
	if v, err := r.st.ActiveVersion(ctx, domain.KindRealise); err != nil {
		return out, err
	} else if v != nil {
		out.DefaultRealiseID = &v.ID
		if rMin, rMax, err = r.realRange(ctx, v.ID); err != nil {
			return out, err
		}
	} else {
		msgs = append(msgs, msgNoRealise)
	}
	out.Message = strings.Join(msgs, " — ")
	out.DefaultWeekFrom, out.DefaultWeekTo, _ = DefaultPeriod(pMin, pMax, rMin, rMax)
	// Weeks = union des semaines couvertes par les versions par défaut.
	lo, hi := "", ""
	for _, d := range []string{pMin, rMin} {
		if w := WeekOfDate(d); w != "" && (lo == "" || w < lo) {
			lo = w
		}
	}
	for _, d := range []string{pMax, rMax} {
		if w := WeekOfDate(d); w != "" && w > hi {
			hi = w
		}
	}
	if lo != "" && hi != "" {
		out.Weeks = nonNilWeeks(Weeks(lo, hi, s))
	}
	return out, nil
}

// ConfirmAlias adds a « confirme » alias to a person (an existing « import »
// alias with the same normalised form is upgraded to « confirme »).
func (r *Repo) ConfirmAlias(ctx context.Context, personneID, alias, operateur string) (domain.Personne, error) {
	alias = strings.Join(strings.Fields(alias), " ")
	norm := names.Normalize(alias)
	if norm == "" {
		return domain.Personne{}, errBadAlias
	}
	if _, err := r.Personne(ctx, personneID); err != nil {
		return domain.Personne{}, err
	}
	err := r.st.Tx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO personne_alias(personne_id, alias, alias_normalise, source, created_at)
			VALUES (?,?,?,'confirme',?)
			ON CONFLICT(personne_id, alias_normalise) DO UPDATE SET source = 'confirme' WHERE source = 'import'`,
			personneID, alias, norm, store.FormatTime(r.st.Now()))
		if err != nil {
			return err
		}
		return r.st.Audit(ctx, tx, operateur, "alias_confirm", "personne", personneID, "alias confirmé depuis l'analyse")
	})
	if err != nil {
		return domain.Personne{}, err
	}
	return r.Personne(ctx, personneID)
}

var errBadAlias = errors.New("alias vide")

// lastParams is stored with the last rendered result.
type lastParams struct {
	PlanVersionID    string `json:"plan_version_id"`
	RealiseVersionID string `json:"realise_version_id"`
	WeekFrom         string `json:"week_from"`
	WeekTo           string `json:"week_to"`
	IncludeInactive  bool   `json:"include_inactive"`
}

// SaveLast upserts the last rendered analysis (SPEC_analyse §11).
func (r *Repo) SaveLast(ctx context.Context, p lastParams, res *domain.AnalyseResult) error {
	pj, err := json.Marshal(p)
	if err != nil {
		return err
	}
	rj, err := json.Marshal(res)
	if err != nil {
		return err
	}
	_, err = r.st.DB().ExecContext(ctx, `INSERT INTO analyse_last_result(id, params, json, created_at) VALUES (1,?,?,?)
		ON CONFLICT(id) DO UPDATE SET params = excluded.params, json = excluded.json, created_at = excluded.created_at`,
		string(pj), string(rj), store.FormatTime(r.st.Now()))
	return err
}
