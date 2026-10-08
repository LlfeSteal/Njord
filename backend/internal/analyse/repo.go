package analyse

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
)

// Repo reads the analysis inputs from SQLite and writes the last rendered
// result (the anomaly treatments are written by the handler).
type Repo struct{ st *store.Store }

func NewRepo(st *store.Store) *Repo { return &Repo{st: st} }

const planCols = `id, version_id, row_num, layout, ct, ressource, libelle, nom_prenom, type_affectation, ligne_cout,
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
		if err := rows.Scan(&l.ID, &l.VersionID, &l.RowNum, &l.Layout, &l.CT, &l.Ressource, &l.Libelle, &l.NomPrenom,
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
	wp_libelle, description_depenses, categorie, type, categorie_fnp, employe_fournisseur, nom_prenom, matricule, fpc, cea,
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
			&e.EmployeFournisseur, &e.NomPrenom, &e.Matricule, &e.FPC, &e.CEA, &e.Quantite, &e.TotalEur, &e.DateDepense,
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

const provisionCols = `id, version_id, row_num, ct, libelle, montant, unite, ligne_cout, type_depense,
	date_debut, date_fin, groupe, statut_parsing, motif_rejet`

// ProvisionLines returns the non-drop lines of a provision version (DECISIONS n° 16).
func (r *Repo) ProvisionLines(ctx context.Context, versionID string) ([]domain.ProvisionLine, error) {
	rows, err := r.st.DB().QueryContext(ctx, `SELECT `+provisionCols+` FROM provision_lines
		WHERE version_id = ? AND statut_parsing <> 'drop' ORDER BY row_num, id`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProvisionLine{}
	for rows.Next() {
		var l domain.ProvisionLine
		if err := rows.Scan(&l.ID, &l.VersionID, &l.RowNum, &l.CT, &l.Libelle, &l.Montant, &l.Unite, &l.LigneCout,
			&l.TypeDepense, &l.DateDebut, &l.DateFin, &l.Groupe, &l.StatutParsing, &l.MotifRejet); err != nil {
			return nil, err
		}
		out = append(out, l)
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

// Personnes returns every person of the référentiel (identity = nom_normalise).
func (r *Repo) Personnes(ctx context.Context) ([]domain.Personne, error) {
	rows, err := r.st.DB().QueryContext(ctx,
		`SELECT id, display_name, nom_normalise, statut, squad_id, created_at FROM personnes ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Personne{}
	for rows.Next() {
		var p domain.Personne
		var sid sql.NullString
		var created string
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.NomNormalise, &p.Statut, &sid, &created); err != nil {
			return nil, err
		}
		p.SquadID = nullStr(sid)
		p.CreatedAt = store.ParseTime(created)
		out = append(out, p)
	}
	return out, rows.Err()
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

// planSelection returns the plan versions of the timeline known at ref
// (non purgées, importées au plus tard avec elle) and whether a later
// non-purged plan version exists (DECISIONS n° 13).
func (r *Repo) planSelection(ctx context.Context, ref domain.Version) ([]domain.Version, bool, error) {
	all, err := r.st.ListVersions(ctx, domain.KindPlan, false)
	if err != nil {
		return nil, false, err
	}
	var sel []domain.Version
	superseded := false
	for _, v := range all {
		if importedAfter(v, ref) {
			superseded = true
			continue
		}
		sel = append(sel, v)
	}
	return sel, superseded, nil
}

// importedAfter orders versions by (importee_le, id).
func importedAfter(a, b domain.Version) bool {
	if !a.ImporteeLe.Equal(b.ImporteeLe) {
		return a.ImporteeLe.After(b.ImporteeLe)
	}
	return a.ID > b.ID
}

// LoadPlans loads the timeline known at ref: versions and their non-drop lines.
func (r *Repo) LoadPlans(ctx context.Context, ref domain.Version) ([]PlanSource, bool, error) {
	sel, superseded, err := r.planSelection(ctx, ref)
	if err != nil {
		return nil, false, err
	}
	out := make([]PlanSource, 0, len(sel))
	for _, v := range sel {
		lines, err := r.PlanLines(ctx, v.ID)
		if err != nil {
			return nil, false, err
		}
		out = append(out, PlanSource{Version: v, Lines: lines})
	}
	return out, superseded, nil
}

// LoadInput loads every engine input: the plan timeline known at planRef,
// the réalisé version and the provision version (nil = aucune provision).
func (r *Repo) LoadInput(ctx context.Context, planRef, realise domain.Version, provision *domain.Version) (Input, error) {
	in := Input{PlanRef: planRef, Realise: realise, ProvisionVersion: provision}
	var err error
	if in.Plans, in.PlanSuperseded, err = r.LoadPlans(ctx, planRef); err != nil {
		return in, err
	}
	if in.Entries, err = r.Entries(ctx, realise.ID); err != nil {
		return in, err
	}
	if provision != nil {
		if in.Provisions, err = r.ProvisionLines(ctx, provision.ID); err != nil {
			return in, err
		}
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

// defaultVersion: the active version; for the plan, else the most recent
// non-purged one (DECISIONS n° 13). nil if none.
func (r *Repo) defaultVersion(ctx context.Context, kind domain.Kind) (*domain.Version, error) {
	v, err := r.st.ActiveVersion(ctx, kind)
	if err != nil || v != nil || kind != domain.KindPlan {
		return v, err
	}
	all, err := r.st.ListVersions(ctx, kind, false)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if v == nil || importedAfter(all[i], *v) {
			v = &all[i]
		}
	}
	return v, nil
}

// ResolveVersion returns the chosen version (id != "") or the default one.
// Missing default version → store.Precondition; unknown id → store.ErrNotFound;
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
	v, err := r.defaultVersion(ctx, kind)
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

// ResolveProvision returns the chosen provision version (id != "") or the
// active one ; nil if none (les provisions sont facultatives : jamais de 409).
// Unknown or purged id → store.ErrNotFound.
func (r *Repo) ResolveProvision(ctx context.Context, id string) (*domain.Version, error) {
	if id == "" {
		return r.st.ActiveVersion(ctx, domain.KindProvision)
	}
	v, err := r.st.GetVersion(ctx, domain.KindProvision, id)
	if err != nil {
		return nil, err
	}
	if v.Statut == domain.StatutPurgee {
		return nil, store.ErrNotFound
	}
	return &v, nil
}

func (r *Repo) realRange(ctx context.Context, versionID string) (string, string, error) {
	var a, b sql.NullString
	err := r.st.DB().QueryRowContext(ctx, `SELECT MIN(substr(date_depense,1,10)), MAX(substr(date_depense,1,10)) FROM realise_entries
		WHERE version_id = ? AND statut_parsing <> 'drop' AND date_depense <> ''`, versionID).Scan(&a, &b)
	return a.String, b.String, err
}

// ctLibelles: libellé of every TG of the active réalisé (code stripped), for
// the plan timeline. No active réalisé → empty map.
func (r *Repo) ctLibelles(ctx context.Context) (map[string]string, error) {
	out := map[string]string{}
	v, err := r.st.ActiveVersion(ctx, domain.KindRealise)
	if err != nil || v == nil {
		return out, err
	}
	rows, err := r.st.DB().QueryContext(ctx, `SELECT TRIM(tg), MIN(tg_libelle) FROM realise_entries
		WHERE version_id = ? AND statut_parsing <> 'drop' AND TRIM(tg) <> '' AND TRIM(tg_libelle) <> '' GROUP BY TRIM(tg)`, v.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tg, lib string
		if err := rows.Scan(&tg, &lib); err != nil {
			return nil, err
		}
		out[tg] = ctLabel(tg, lib)
	}
	return out, rows.Err()
}

// Context builds the analysis screen context (versions, defaults, weeks).
func (r *Repo) Context(ctx context.Context) (domain.AnalyseContext, error) {
	out := domain.AnalyseContext{Weeks: []domain.WeekInfo{}}
	s, err := r.st.GetSettings(ctx)
	if err != nil {
		return out, err
	}
	cal := NewCalendar(s)
	if out.PlanVersions, err = r.st.ListVersions(ctx, domain.KindPlan, false); err != nil {
		return out, err
	}
	if out.RealiseVersions, err = r.st.ListVersions(ctx, domain.KindRealise, false); err != nil {
		return out, err
	}
	if out.ProvisionVersions, err = r.st.ListVersions(ctx, domain.KindProvision, false); err != nil {
		return out, err
	}
	if v, err := r.st.ActiveVersion(ctx, domain.KindProvision); err != nil {
		return out, err
	} else if v != nil {
		out.DefaultProvisionID = &v.ID
	}
	var pMin, pMax, rMin, rMax string
	var tl Timeline
	var msgs []string
	if v, err := r.defaultVersion(ctx, domain.KindPlan); err != nil {
		return out, err
	} else if v != nil {
		out.DefaultPlanID = &v.ID
		plans, _, err := r.LoadPlans(ctx, *v)
		if err != nil {
			return out, err
		}
		tl = BuildTimeline(cal, plans)
		pMin, pMax = tl.Span()
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
	// Weeks = union des semaines de la timeline et du réalisé par défaut.
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
		out.Weeks = tl.weeks(cal, lo, hi)
	}
	return out, nil
}

// lastParams is stored with the last rendered result.
type lastParams struct {
	PlanVersionID      string `json:"plan_version_id"`
	RealiseVersionID   string `json:"realise_version_id"`
	ProvisionVersionID string `json:"provision_version_id"` // "" = aucune provision
	WeekFrom           string `json:"week_from"`
	WeekTo             string `json:"week_to"`
	IncludeInactive    bool   `json:"include_inactive"`
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
