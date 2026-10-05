package analyse

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// categorieOrder is the display order of the categories (after gravité).
var categorieOrder = map[domain.AnomalieCategorie]int{
	domain.AnomalieBudget:         0,
	domain.AnomalieCTRisque:       1,
	domain.AnomalieEcart:          2,
	domain.AnomalieDerive:         3,
	domain.AnomalieQualite:        4,
	domain.AnomalieCorrespondance: 5,
}

// ecartGravite: gravité of an ecart anomaly per flag.
var ecartGravite = map[domain.Flag]int{
	domain.FlagSurImputation:  3,
	domain.FlagAbsence:        3,
	domain.FlagHorsPlan:       2,
	domain.FlagSousImputation: 2,
}

// keyPart sanitises a key component (the key is « | »-separated and has no « / »).
func keyPart(s string) string {
	return strings.NewReplacer("/", "_", "|", "_").Replace(strings.TrimSpace(s))
}

func anomalieKey(parts ...string) string {
	for i := range parts {
		parts[i] = keyPart(parts[i])
	}
	return strings.Join(parts, "|")
}

// fpH rounds hours to 0.5 h, fpE euros to 1 € (fingerprint inputs).
func fpH(v float64) string { return strconv.FormatFloat(noNegZero(math.Round(v*2)/2), 'f', 1, 64) }
func fpE(v float64) string { return strconv.FormatFloat(noNegZero(math.Round(v)), 'f', 0, 64) }

func noNegZero(v float64) float64 {
	if v == 0 {
		return 0
	}
	return v
}

// fingerprint: 12 first hex chars of the sha1 of the rounded figures.
func fingerprint(parts ...string) string {
	sum := sha1.Sum([]byte(strings.Join(parts, ";")))
	return hex.EncodeToString(sum[:])[:12]
}

// fmtEur formats euros for titles: "12 345 €" (non-breaking spaces, no decimals).
func fmtEur(v float64) string {
	n := int64(math.Round(v))
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteString(" ")
		}
		b.WriteRune(c)
	}
	out := b.String() + " €"
	if neg {
		out = "-" + out
	}
	return out
}

// fmtSigned formats signed hours ("+12.5", "-3", "0").
// fmtHFr formats hours the French way for anomaly texts ("12,5").
func fmtHFr(v float64) string { return strings.Replace(fmtH(v), ".", ",", 1) }

func fmtSigned(v float64) string {
	if round2(v) > 0 {
		return "+" + fmtHFr(v)
	}
	return fmtHFr(v)
}

func ptrF(v float64) *float64 { return &v }

func ptrS(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// query builds "path?k1=v1&k2=v2" keeping the given order (values escaped).
func query(path string, kv ...string) string {
	var b strings.Builder
	b.WriteString(path)
	sep := "?"
	for i := 0; i+1 < len(kv); i += 2 {
		b.WriteString(sep + url.QueryEscape(kv[i]) + "=" + url.QueryEscape(kv[i+1]))
		sep = "&"
	}
	return b.String()
}

// flagLibelle: FlagLabel without the « FLAG » prefix, lower-cased ("sur-imputation").
func flagLibelle(f domain.Flag) string {
	l := strings.TrimSpace(strings.TrimPrefix(FlagLabel[f], "FLAG "))
	if l == "" {
		l = string(f)
	}
	return strings.ToLower(l)
}

func pluriel(n int, sing, plur string) string {
	if n > 1 {
		return itoa(n) + " " + plur
	}
	return itoa(n) + " " + sing
}

// anomalies builds the controller's inbox from the computed result (SPEC_analyse §7.8).
// Statut = a_traiter ; la fusion avec anomalie_suivi est faite par mergeSuivi.
func (r *run) anomalies(res *domain.AnalyseResult) []domain.Anomalie {
	out := []domain.Anomalie{}
	out = append(out, ecartAnomalies(res)...)
	out = append(out, ctRisqueAnomalies(res, r.s.SeuilCTRisqueEur)...)
	out = append(out, deriveAnomalies(res)...)
	out = append(out, qualiteAnomalies(res)...)
	out = append(out, correspondanceAnomalies(res)...)
	out = append(out, budgetAnomalies(res)...)
	for i := range out {
		out[i].Statut = domain.AnomalieATraiter
	}
	SortAnomalies(out)
	return out
}

// magnitude is the secondary sort value: |montant|, else |heures|.
func magnitude(a *domain.Anomalie) float64 {
	if a.Montant != nil {
		return math.Abs(*a.Montant)
	}
	if a.Heures != nil {
		return math.Abs(*a.Heures)
	}
	return 0
}

// SortAnomalies: gravité desc, catégorie, |montant| / |heures| desc, clé.
func SortAnomalies(as []domain.Anomalie) {
	sort.SliceStable(as, func(i, j int) bool {
		a, b := &as[i], &as[j]
		if a.Gravite != b.Gravite {
			return a.Gravite > b.Gravite
		}
		if ca, cb := categorieOrder[a.Categorie], categorieOrder[b.Categorie]; ca != cb {
			return ca < cb
		}
		if ma, mb := magnitude(a), magnitude(b); ma != mb {
			return ma > mb
		}
		return a.Key < b.Key
	})
}

// ecartAnomalies groups the non-compliant rows per (CT, ressource, flag).
// Inactive resources are left out unless include_inactive (as for the KPIs),
// except hors plan rows which never depend on the plan.
func ecartAnomalies(res *domain.AnalyseResult) []domain.Anomalie {
	type group struct {
		row                domain.EcartRow
		ecart, prevu, reel float64
		weeks              map[string]bool
	}
	groups := map[string]*group{}
	var order []string
	for _, row := range res.Ecarts {
		if _, ok := ecartGravite[row.Flag]; !ok {
			continue
		}
		if row.Inactive && row.Flag != domain.FlagHorsPlan && !res.Meta.IncludeInactive {
			continue
		}
		k := anomalieKey("ecart", row.CT, row.Ressource, string(row.Flag))
		g := groups[k]
		if g == nil {
			g = &group{row: row, weeks: map[string]bool{}}
			groups[k] = g
			order = append(order, k)
		}
		g.ecart += row.Ecart
		g.prevu += row.Prevu
		g.reel += row.Reel
		g.weeks[row.Semaine] = true
		if g.row.PersonneID == nil && row.PersonneID != nil {
			g.row.PersonneID = row.PersonneID
		}
		if g.row.RessourceLabel == "" {
			g.row.RessourceLabel = row.RessourceLabel
		}
		if g.row.CTLibelle == "" {
			g.row.CTLibelle = row.CTLibelle
		}
	}
	out := make([]domain.Anomalie, 0, len(order))
	for _, k := range order {
		g := groups[k]
		weeks := make([]string, 0, len(g.weeks))
		for w := range g.weeks {
			weeks = append(weeks, w)
		}
		sort.Strings(weeks)
		label := g.row.RessourceLabel
		if label == "" {
			label = g.row.Ressource
		}
		flag := g.row.Flag
		out = append(out, domain.Anomalie{
			Key:       k,
			Categorie: domain.AnomalieEcart,
			Gravite:   ecartGravite[flag],
			Titre:     label + " · " + g.row.CT + " : " + flagLibelle(flag),
			Detail: pluriel(len(weeks), "semaine", "semaines") + ", écart cumulé " + fmtSigned(g.ecart) +
				" h (prévu " + fmtHFr(g.prevu) + " h, réel " + fmtHFr(g.reel) + " h)",
			Flag:        &flag,
			CT:          g.row.CT,
			CTLibelle:   g.row.CTLibelle,
			Ressource:   g.row.Ressource,
			PersonneID:  g.row.PersonneID,
			Heures:      ptrF(round2(g.ecart)),
			Semaines:    weeks,
			Lien:        query("/ecarts", "ct", g.row.CT, "ressource", g.row.Ressource, "flag", string(flag)),
			Fingerprint: fingerprint(string(flag), fpH(g.ecart), fpH(g.prevu), fpH(g.reel), itoa(len(weeks))),
		})
	}
	return out
}

func ctRisqueAnomalies(res *domain.AnalyseResult, seuil float64) []domain.Anomalie {
	out := []domain.Anomalie{}
	for _, a := range res.Alertes.CTRisque {
		out = append(out, domain.Anomalie{
			Key:       anomalieKey("ct_risque", a.CT),
			Categorie: domain.AnomalieCTRisque,
			Gravite:   3,
			Titre:     "CT à risque · " + a.CT + " : " + fmtEur(a.NonSecurise) + " non sécurisés",
			Detail: fmtEur(a.NonSecurise) + " de dépenses non sécurisées sur le CT, au-delà du seuil de " +
				fmtEur(seuil),
			CT:          a.CT,
			CTLibelle:   a.CTLibelle,
			Montant:     ptrF(a.NonSecurise),
			Lien:        query("/budget", "ct", a.CT),
			Fingerprint: fingerprint(fpE(a.NonSecurise)),
		})
	}
	return out
}

func deriveAnomalies(res *domain.AnalyseResult) []domain.Anomalie {
	realiseID := ""
	if res.Meta.RealiseVersion != nil {
		realiseID = res.Meta.RealiseVersion.ID
	}
	out := []domain.Anomalie{}
	for _, d := range res.Alertes.DeriveProvision {
		who := d.EmployeFournisseur
		if who == "" {
			who = "ressource non identifiée"
		}
		parts := []string{who}
		if d.Type != "" {
			parts = append(parts, d.Type)
		}
		if d.DateDepense != "" {
			parts = append(parts, d.DateDepense)
		}
		detail := "Consommation de provision sans ressource identifiée (ligne " + itoa(d.RowNum) + ") : " +
			strings.Join(parts, " · ") + " — " + fmtEur(d.Eur)
		if d.Heures != 0 {
			detail += ", " + fmtHFr(d.Heures) + " h"
		}
		a := domain.Anomalie{
			Key:         anomalieKey("derive", d.CT, itoa(d.RowNum)),
			Categorie:   domain.AnomalieDerive,
			Gravite:     2,
			Titre:       "Dérive de provision · " + d.CT + " : " + who,
			Detail:      detail,
			CT:          d.CT,
			Ressource:   d.EmployeFournisseur,
			Montant:     ptrF(d.Eur),
			Lien:        query("/realise/"+url.PathEscape(realiseID), "tg", d.CT),
			Fingerprint: fingerprint(fpE(d.Eur), fpH(d.Heures), d.Type, d.DateDepense),
		}
		if d.Heures != 0 {
			a.Heures = ptrF(d.Heures)
		}
		out = append(out, a)
	}
	return out
}

func qualiteAnomalies(res *domain.AnalyseResult) []domain.Anomalie {
	planID, realiseID := "", ""
	if res.Meta.PlanVersion != nil {
		planID = res.Meta.PlanVersion.ID
	}
	if res.Meta.RealiseVersion != nil {
		realiseID = res.Meta.RealiseVersion.ID
	}
	out := []domain.Anomalie{}
	for _, w := range res.Qualite {
		g := 1
		if w.Code == "tg_ecart_budget" || w.Code == "mo_quantite_semaine" {
			g = 2
		}
		var lien string
		switch w.Code {
		case "plan_warn":
			lien = query("/plan/"+url.PathEscape(planID), "statut", "warn")
		case "realise_warn":
			lien = query("/realise/"+url.PathEscape(realiseID), "statut", "warn")
		case "fuzzy":
			lien = query("/anomalies", "categorie", string(domain.AnomalieCorrespondance))
		default:
			lien = "/ecarts"
		}
		details := w.Details
		if len(details) > maxDetails {
			details = details[:maxDetails]
		}
		details = append([]string{}, details...)
		detail := "Contrôle qualité"
		if w.Regle > 0 {
			detail += " §10 règle " + itoa(w.Regle)
		}
		detail += " : " + pluriel(w.Count, "occurrence", "occurrences")
		out = append(out, domain.Anomalie{
			Key:         anomalieKey("qualite", w.Code),
			Categorie:   domain.AnomalieQualite,
			Gravite:     g,
			Titre:       w.Message,
			Detail:      detail,
			Details:     details,
			Lien:        lien,
			Fingerprint: fingerprint(itoa(w.Count), itoa(len(w.Details))),
		})
	}
	return out
}

// correspondanceAnomalies: one per fuzzy match to confirm (merged per normalised name).
func correspondanceAnomalies(res *domain.AnalyseResult) []domain.Anomalie {
	out := []domain.Anomalie{}
	idx := map[string]int{}
	nb := map[string]int{}
	for _, c := range res.Correspondances {
		if c.Confidence != domain.ConfFuzzy {
			continue
		}
		norm := c.NomNormalise
		if norm == "" {
			norm = c.NomRealise
		}
		k := anomalieKey("correspondance", norm)
		if i, ok := idx[k]; ok {
			*out[i].Heures = round2(*out[i].Heures + c.Heures)
			nb[k] += c.NbEcritures
			continue
		}
		idx[k] = len(out)
		nb[k] = c.NbEcritures
		personne := c.PersonneNom
		if personne == "" && c.PersonneID != nil {
			personne = *c.PersonneID
		}
		pid := ""
		if c.PersonneID != nil {
			pid = *c.PersonneID
		}
		ressource := c.Ressource
		if ressource == "" {
			ressource = c.NomRealise
		}
		out = append(out, domain.Anomalie{
			Key:        k,
			Categorie:  domain.AnomalieCorrespondance,
			Gravite:    1,
			Titre:      c.NomRealise + " → " + personne + " ?",
			Ressource:  ressource,
			NomRealise: c.NomRealise,
			PersonneID: ptrS(pid),
			Heures:     ptrF(c.Heures),
			Lien:       query("/personnes", "personne", pid),
		})
	}
	for i := range out {
		a := &out[i]
		n := nb[a.Key]
		a.Detail = "Rapprochement nominal approximatif (" + pluriel(n, "écriture", "écritures") + ", " + fmtHFr(*a.Heures) +
			" h) : confirmez l'alias si la correspondance est juste"
		pid := ""
		if a.PersonneID != nil {
			pid = *a.PersonneID
		}
		a.Fingerprint = fingerprint(pid, fpH(*a.Heures), itoa(n))
	}
	return out
}

// budgetAnomalies: one per CT whose landing forecast is not ok.
func budgetAnomalies(res *domain.AnalyseResult) []domain.Anomalie {
	out := []domain.Anomalie{}
	for _, p := range res.Previsions.ParCT {
		if p.Statut == domain.PrevisionOK || p.Statut == "" {
			continue
		}
		g, what := 2, "vigilance"
		if p.Statut == domain.PrevisionDepassement {
			g, what = 3, "dépassement prévu"
		}
		montant := p.EcartPlan
		if p.EcartTendance > montant {
			montant = p.EcartTendance
		}
		titre := "Atterrissage · " + p.CT + " : " + what
		if montant > 0 {
			titre += " (+" + fmtEur(montant) + ")"
		}
		detail := "Atterrissage prévu " + fmtEur(p.AtterrissagePlan) + " pour un budget de " + fmtEur(p.Budget) +
			" (tendance " + fmtEur(p.AtterrissageTendance) + ")"
		if p.Budget == 0 {
			// CT présent au réalisé mais absent du plan : dépense sans budget plutôt que « dépassement ».
			titre = "Dépense hors budget · " + p.CT + " (" + fmtEur(p.Consomme) + ")"
			detail = fmtEur(p.Consomme) + " dépensés sur un CT absent du plan de charge (aucun budget prévu)"
		}
		out = append(out, domain.Anomalie{
			Key:       anomalieKey("budget", p.CT),
			Categorie: domain.AnomalieBudget,
			Gravite:   g,
			Titre:     titre,
			Detail:    detail,
			CT:        p.CT,
			CTLibelle: p.CTLibelle,
			Montant:   ptrF(round2(montant)),
			Lien:      query("/previsions", "ct", p.CT),
			Fingerprint: fingerprint(string(p.Statut), fpE(p.Budget), fpE(p.AtterrissagePlan),
				fpE(p.AtterrissageTendance)),
		})
	}
	return out
}

// ---------------------------------------------------------------------------
// Suivi (table anomalie_suivi)

func (h *Handler) loadSuivi(ctx context.Context) (map[string]domain.AnomalieSuivi, error) {
	rows, err := h.st.DB().QueryContext(ctx,
		`SELECT key, fingerprint, statut, commentaire, operateur, updated_at FROM anomalie_suivi`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]domain.AnomalieSuivi{}
	for rows.Next() {
		var s domain.AnomalieSuivi
		var statut, at string
		if err := rows.Scan(&s.Key, &s.Fingerprint, &statut, &s.Commentaire, &s.Operateur, &at); err != nil {
			return nil, err
		}
		s.Statut = domain.AnomalieStatut(statut)
		s.UpdatedAt = store.ParseTime(at)
		out[s.Key] = s
	}
	return out, rows.Err()
}

// mergeSuivi applies the stored treatments (table anomalie_suivi) to res.Anomalies.
func (h *Handler) mergeSuivi(ctx context.Context, res *domain.AnalyseResult) error {
	if res.Anomalies == nil {
		res.Anomalies = []domain.Anomalie{}
	}
	if len(res.Anomalies) == 0 {
		return nil
	}
	suivis, err := h.loadSuivi(ctx)
	if err != nil {
		return err
	}
	for i := range res.Anomalies {
		a := &res.Anomalies[i]
		s, ok := suivis[a.Key]
		if !ok {
			continue
		}
		if s.Fingerprint == a.Fingerprint {
			a.Statut = s.Statut
		} else {
			a.Statut = domain.AnomalieATraiter
			s.Obsolete = true
		}
		a.Suivi = &s
	}
	return nil
}

// truncRunes cuts s to n runes.
func truncRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// putSuivi: PUT /analyse/anomalies/suivi (body AnomalieSuiviInput) → AnomalieSuivi.
func (h *Handler) putSuivi(c *gin.Context) {
	var in domain.AnomalieSuiviInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Error(c, httpx.BadRequest("corps JSON invalide"))
		return
	}
	in.Key, in.Fingerprint = strings.TrimSpace(in.Key), strings.TrimSpace(in.Fingerprint)
	if in.Key == "" || in.Fingerprint == "" {
		httpx.Error(c, httpx.BadRequest("key et fingerprint sont requis"))
		return
	}
	if in.Statut != domain.AnomalieTraitee && in.Statut != domain.AnomalieIgnoree {
		httpx.Error(c, httpx.BadRequest("statut invalide : traitee ou ignoree attendu"))
		return
	}
	s := domain.AnomalieSuivi{
		Key:         in.Key,
		Fingerprint: in.Fingerprint,
		Statut:      in.Statut,
		Commentaire: strings.TrimSpace(in.Commentaire),
		Operateur:   httpx.Operateur(c, in.Operateur),
	}
	at := store.FormatTime(h.st.Now())
	s.UpdatedAt = store.ParseTime(at)
	err := h.st.Tx(c, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(c,
			`INSERT INTO anomalie_suivi(key, fingerprint, statut, commentaire, operateur, updated_at) VALUES (?,?,?,?,?,?)
			ON CONFLICT(key) DO UPDATE SET fingerprint = excluded.fingerprint, statut = excluded.statut,
				commentaire = excluded.commentaire, operateur = excluded.operateur, updated_at = excluded.updated_at`,
			s.Key, s.Fingerprint, string(s.Statut), s.Commentaire, s.Operateur, at); err != nil {
			return err
		}
		return h.st.Audit(c, tx, s.Operateur, "anomalie."+string(s.Statut), "anomalie", s.Key, truncRunes(s.Commentaire, 200))
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

// deleteSuivi: DELETE /analyse/anomalies/suivi?key=… → 204 (anomalie rouverte).
func (h *Handler) deleteSuivi(c *gin.Context) {
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		httpx.Error(c, httpx.BadRequest("paramètre key requis"))
		return
	}
	err := h.st.Tx(c, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(c, `DELETE FROM anomalie_suivi WHERE key = ?`, key); err != nil {
			return err
		}
		return h.st.Audit(c, tx, httpx.Operateur(c, ""), "anomalie.rouverte", "anomalie", key, "")
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
