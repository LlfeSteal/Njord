package plan

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"njord/internal/domain"
	"njord/internal/names"
	"njord/internal/store"
)

// maxReportIssues bounds ImportReport.Issues.
const maxReportIssues = 500

// Service implements the plan import (preview / commit).
type Service struct{ st *store.Store }

func NewService(st *store.Store) *Service { return &Service{st: st} }

// DefaultIntitule: file name without directory nor extension.
func DefaultIntitule(filename string) string {
	base := filepath.Base(strings.ReplaceAll(filename, "\\", "/"))
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func buildReport(res *ParseResult, filename, intitule string) domain.ImportReport {
	if strings.TrimSpace(intitule) == "" {
		intitule = DefaultIntitule(filename)
	}
	pct := res.PctInactifs
	rep := domain.ImportReport{
		Kind:         domain.KindPlan,
		Intitule:     strings.TrimSpace(intitule),
		Filename:     filename,
		SourceFormat: res.SourceFormat,
		SheetName:    res.Sheet,
		HeaderRow:    res.HeaderRow,
		Total:        res.Total,
		OK:           res.OK,
		Warn:         res.Warn,
		Drop:         res.Drop,
		PeriodeDebut: res.PeriodeDebut,
		PeriodeFin:   res.PeriodeFin,
		Layout:       res.Layout,
		PctInactifs:  &pct,
		Issues:       res.Issues,
		MotifsCount:  res.MotifsCount,
	}
	if rep.Issues == nil {
		rep.Issues = []domain.ParseIssue{}
	}
	if len(rep.Issues) > maxReportIssues {
		rep.Issues = rep.Issues[:maxReportIssues]
	}
	return rep
}

// Preview parses the file and computes what would be created, without writing
// anything (the enrichment runs in a transaction that is rolled back).
func (s *Service) Preview(ctx context.Context, data []byte, filename, intitule string) (*domain.ImportReport, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename, intitule)
	active, err := s.st.ActiveVersion(ctx, domain.KindPlan)
	if err != nil {
		return nil, err
	}
	rep.ActiveVersion = active
	tx, err := s.st.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	en, err := enrich(ctx, tx, store.FormatTime(s.st.Now()), res.Lines)
	if err != nil {
		return nil, err
	}
	rep.NouvellesPersonnes, rep.NouveauxSquads = en.newPersonnes, en.newSquads
	return &rep, nil
}

// Commit parses and writes a new version (lines + référentiels) in one transaction.
func (s *Service) Commit(ctx context.Context, data []byte, filename, intitule, importeur string, archiveActive bool) (*domain.ImportResult, error) {
	res, err := Parse(data)
	if err != nil {
		return nil, err
	}
	rep := buildReport(res, filename, intitule)
	active, err := s.st.ActiveVersion(ctx, domain.KindPlan)
	if err != nil {
		return nil, err
	}
	rep.ActiveVersion = active
	v := domain.Version{
		Kind:         domain.KindPlan,
		Intitule:     rep.Intitule,
		Importeur:    importeur,
		NbLignes:     res.OK + res.Warn,
		NbWarn:       res.Warn,
		NbDrop:       res.Drop,
		PeriodeDebut: res.PeriodeDebut,
		PeriodeFin:   res.PeriodeFin,
		SourceFormat: res.SourceFormat,
		Filename:     filename,
		Layout:       res.Layout,
	}
	var en *enricher
	err = s.st.CreateVersion(ctx, &v, archiveActive, func(tx *sql.Tx, versionID string) error {
		var err error
		en, err = enrich(ctx, tx, store.FormatTime(s.st.Now()), res.Lines)
		if err != nil {
			return err
		}
		if err := insertLines(ctx, tx, versionID, res.Lines); err != nil {
			return err
		}
		if len(en.newPersonnes)+len(en.newSquads)+en.nbAlias+en.nbMatricules > 0 {
			return s.st.Audit(ctx, tx, v.Importeur, "referentiel_import", "plan_version", versionID,
				fmt.Sprintf("personnes créées=%d squads créés=%d alias ajoutés=%d matricules rattachés=%d",
					len(en.newPersonnes), len(en.newSquads), en.nbAlias, en.nbMatricules))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	rep.NouvellesPersonnes, rep.NouveauxSquads = en.newPersonnes, en.newSquads
	return &domain.ImportResult{Version: v, Report: rep}, nil
}

// ---------------------------------------------------------------------------
// Enrichissement des référentiels

type enricher struct {
	ctx context.Context
	tx  *sql.Tx
	now string

	squadByKey map[string]string          // nom_normalise / alias_normalise → squad id
	pathCache  map[string][]string        // chemin de groupes → ids
	persByMat  map[string]string          // matricule → personne id
	persByNom  map[string]string          // nom_normalise → personne id
	aliases    map[string]map[string]bool // personne id → alias_normalise
	fromCode   map[string]bool            // personnes créées ici avec display_name = code ressource

	newPersonnes []string
	newSquads    []string
	nbAlias      int
	nbMatricules int
}

func enrich(ctx context.Context, tx *sql.Tx, now string, lines []ParsedLine) (*enricher, error) {
	e := &enricher{
		ctx: ctx, tx: tx, now: now,
		squadByKey: map[string]string{}, pathCache: map[string][]string{},
		persByMat: map[string]string{}, persByNom: map[string]string{},
		aliases: map[string]map[string]bool{}, fromCode: map[string]bool{},
		newPersonnes: []string{}, newSquads: []string{},
	}
	if err := e.load(); err != nil {
		return nil, err
	}
	for i := range lines {
		if err := e.line(&lines[i]); err != nil {
			return nil, err
		}
	}
	return e, nil
}

func (e *enricher) load() error {
	pairs := func(q string, fn func(a, b string)) error {
		rows, err := e.tx.QueryContext(e.ctx, q)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a, b string
			if err := rows.Scan(&a, &b); err != nil {
				return err
			}
			fn(a, b)
		}
		return rows.Err()
	}
	setIfAbsent := func(m map[string]string, k, v string) {
		if _, ok := m[k]; !ok && k != "" {
			m[k] = v
		}
	}
	if err := pairs(`SELECT id, nom_normalise FROM squads ORDER BY created_at, id`, func(id, k string) { setIfAbsent(e.squadByKey, k, id) }); err != nil {
		return err
	}
	if err := pairs(`SELECT squad_id, alias_normalise FROM squad_alias ORDER BY id`, func(id, k string) { setIfAbsent(e.squadByKey, k, id) }); err != nil {
		return err
	}
	if err := pairs(`SELECT personne_id, matricule FROM personne_matricules`, func(id, m string) { e.persByMat[m] = id }); err != nil {
		return err
	}
	if err := pairs(`SELECT id, nom_normalise FROM personnes ORDER BY created_at, id`, func(id, k string) { setIfAbsent(e.persByNom, k, id) }); err != nil {
		return err
	}
	return pairs(`SELECT personne_id, alias_normalise FROM personne_alias`, func(id, k string) { e.aliasSet(id)[k] = true })
}

func (e *enricher) aliasSet(pid string) map[string]bool {
	s := e.aliases[pid]
	if s == nil {
		s = map[string]bool{}
		e.aliases[pid] = s
	}
	return s
}

func (e *enricher) line(l *ParsedLine) error {
	pathIDs, err := e.groupPath(l.GroupPath)
	if err != nil {
		return err
	}
	var squadID string
	if len(pathIDs) > 0 {
		squadID = pathIDs[len(pathIDs)-1]
	}
	drop := l.StatutParsing == domain.ParsingDrop
	person, squadSeg := names.SplitLibelle(l.Libelle, nil)
	if !drop && squadSeg != "" {
		id, err := e.libelleSquad(squadSeg, l.GroupPath, pathIDs)
		if err != nil {
			return err
		}
		if squadID == "" {
			squadID = id
		}
	}
	if squadID != "" {
		sid := squadID
		l.SquadID = &sid
	}
	if l.Ressource == "" {
		return nil
	}
	if drop {
		// Pas de création pour une ligne rejetée ; rattachement si déjà connue.
		if pid, ok := e.persByMat[l.Ressource]; ok {
			l.PersonneID = &pid
		}
		return nil
	}
	pid, err := e.person(l.Ressource, person, squadID)
	if err != nil {
		return err
	}
	l.PersonneID = &pid
	return nil
}

// groupPath returns the squad ids of an Excel group path, creating missing
// squads (parent_id = enclosing group).
func (e *enricher) groupPath(path []string) ([]string, error) {
	if len(path) == 0 {
		return nil, nil
	}
	ck := strings.Join(path, "\x00")
	if ids, ok := e.pathCache[ck]; ok {
		return ids, nil
	}
	ids := make([]string, 0, len(path))
	parent := ""
	for _, name := range path {
		key := names.NormalizeSquad(name)
		if key == "" {
			continue
		}
		id, ok := e.squadByKey[key]
		if !ok {
			var err error
			if id, err = e.createSquad(name, key, parent); err != nil {
				return nil, err
			}
		}
		ids = append(ids, id)
		parent = id
	}
	e.pathCache[ck] = ids
	return ids, nil
}

func (e *enricher) createSquad(name, key, parent string) (string, error) {
	id := uuid.NewString()
	var p any
	if parent != "" {
		p = parent
	}
	if _, err := e.tx.ExecContext(e.ctx,
		`INSERT INTO squads(id, nom_canonique, nom_normalise, entite_rattachee, parent_id, created_at) VALUES (?,?,?,?,?,?)`,
		id, name, key, "", p, e.now); err != nil {
		return "", err
	}
	e.squadByKey[key] = id
	e.newSquads = append(e.newSquads, name)
	return id, nil
}

// libelleSquad resolves a squad segment of a Libellé ("Squad Alpha"): existing
// squad or alias; otherwise alias of the line's group squad (the group of the
// path whose name contains every token of the segment, else the innermost);
// otherwise a new squad.
func (e *enricher) libelleSquad(seg string, path, pathIDs []string) (string, error) {
	key := names.NormalizeSquad(seg)
	if key == "" {
		return "", nil
	}
	if id, ok := e.squadByKey[key]; ok {
		return id, nil
	}
	if len(pathIDs) == 0 {
		return e.createSquad(seg, key, "")
	}
	target := pathIDs[len(pathIDs)-1]
	segToks := strings.Fields(key)
	for i := len(pathIDs) - 1; i >= 0 && i < len(path); i-- {
		gt := map[string]bool{}
		for _, t := range strings.Fields(names.NormalizeSquad(path[i])) {
			gt[t] = true
		}
		all := true
		for _, t := range segToks {
			if !gt[t] {
				all = false
				break
			}
		}
		if all {
			target = pathIDs[i]
			break
		}
	}
	if _, err := e.tx.ExecContext(e.ctx, `INSERT INTO squad_alias(squad_id, alias, alias_normalise) VALUES (?,?,?)`, target, seg, key); err != nil {
		return "", err
	}
	e.squadByKey[key] = target
	return target, nil
}

// person resolves (or creates) the personne of a ressource code (SPEC §6.2).
func (e *enricher) person(code, personPart, squadID string) (string, error) {
	nom := names.Normalize(personPart)
	pid, ok := e.persByMat[code]
	if !ok && nom != "" {
		if pid, ok = e.persByNom[nom]; ok {
			if _, err := e.tx.ExecContext(e.ctx, `INSERT INTO personne_matricules(personne_id, matricule) VALUES (?,?)`, pid, code); err != nil {
				return "", err
			}
			e.persByMat[code] = pid
			e.nbMatricules++
		}
	}
	if !ok {
		display := personPart
		if display == "" {
			display = code
		}
		pid = uuid.NewString()
		var sq any
		if squadID != "" {
			sq = squadID
		}
		if _, err := e.tx.ExecContext(e.ctx,
			`INSERT INTO personnes(id, display_name, nom_normalise, statut, squad_id, created_at) VALUES (?,?,?,'brouillon',?,?)`,
			pid, display, names.Normalize(display), sq, e.now); err != nil {
			return "", err
		}
		if _, err := e.tx.ExecContext(e.ctx, `INSERT INTO personne_matricules(personne_id, matricule) VALUES (?,?)`, pid, code); err != nil {
			return "", err
		}
		e.persByMat[code] = pid
		if k := names.Normalize(display); k != "" {
			if _, exists := e.persByNom[k]; !exists {
				e.persByNom[k] = pid
			}
		}
		e.newPersonnes = append(e.newPersonnes, display)
		if personPart == "" {
			e.fromCode[pid] = true
		}
	} else if e.fromCode[pid] && personPart != "" {
		// Fiche créée dans ce même import sans libellé : on lui donne le vrai nom.
		if _, err := e.tx.ExecContext(e.ctx, `UPDATE personnes SET display_name = ?, nom_normalise = ? WHERE id = ?`, personPart, nom, pid); err != nil {
			return "", err
		}
		for i, n := range e.newPersonnes {
			if n == code {
				e.newPersonnes[i] = personPart
				break
			}
		}
		if _, exists := e.persByNom[nom]; !exists {
			e.persByNom[nom] = pid
		}
		delete(e.fromCode, pid)
	}
	if nom != "" && !e.aliasSet(pid)[nom] {
		if _, err := e.tx.ExecContext(e.ctx,
			`INSERT INTO personne_alias(personne_id, alias, alias_normalise, source, created_at) VALUES (?,?,?,'import',?)`,
			pid, personPart, nom, e.now); err != nil {
			return "", err
		}
		e.aliasSet(pid)[nom] = true
		e.nbAlias++
	}
	return pid, nil
}

// ---------------------------------------------------------------------------

func insertLines(ctx context.Context, tx *sql.Tx, versionID string, lines []ParsedLine) error {
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO plan_lines(version_id, row_num, layout, ct, ressource, libelle,
		type_affectation, ligne_cout, charge_totale, pps, pourcentage, unite, calcul_duree, date_debut, date_fin,
		quantite_affectee, taux_fixe, depuis, pendant, statut_parsing, motif_rejet, ressource_kind, inactive,
		personne_id, squad_id, groupe) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for i := range lines {
		l := &lines[i].PlanLine
		var qte, pid, sid any
		if l.QuantiteAffectee != nil {
			qte = *l.QuantiteAffectee
		}
		if l.PersonneID != nil {
			pid = *l.PersonneID
		}
		if l.SquadID != nil {
			sid = *l.SquadID
		}
		if _, err := stmt.ExecContext(ctx, versionID, l.RowNum, l.Layout, l.CT, l.Ressource, l.Libelle,
			l.TypeAffectation, l.LigneCout, l.ChargeTotale, l.PPS, l.Pourcentage, l.Unite, l.CalculDuree,
			l.DateDebut, l.DateFin, qte, l.TauxFixe, l.Depuis, l.Pendant, l.StatutParsing, l.MotifRejet,
			l.RessourceKind, l.Inactive, pid, sid, l.Groupe); err != nil {
			return err
		}
		l.VersionID = versionID
	}
	return nil
}
