package analyse

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api endpoints of the analyse module (see docs/API.md).
type Handler struct {
	st   *store.Store
	repo *Repo
}

func New(st *store.Store) *Handler { return &Handler{st: st, repo: NewRepo(st)} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/analyse/context", h.context)
	g.GET("/analyse", h.analyse)
	g.GET("/analyse/ecarts.csv", h.ecartsCSV)
	g.GET("/analyse/realise-enrichi.csv", h.realiseCSV)
	g.POST("/analyse/alias/confirm", h.confirmAlias)
	g.PUT("/analyse/anomalies/suivi", h.putSuivi)
	g.DELETE("/analyse/anomalies/suivi", h.deleteSuivi)
}

func (h *Handler) context(c *gin.Context) {
	out, err := h.repo.Context(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// params reads the common analysis query parameters.
type params struct {
	planID, realiseID string
	weekFrom, weekTo  string
	includeInactive   bool
}

func readParams(c *gin.Context) (params, error) {
	p := params{
		planID:          strings.TrimSpace(c.Query("plan_version_id")),
		realiseID:       strings.TrimSpace(c.Query("realise_version_id")),
		includeInactive: httpx.QueryBool(c, "include_inactive", false),
	}
	var err error
	if w := strings.TrimSpace(c.Query("week_from")); w != "" {
		if p.weekFrom, err = NormalizeWeek(w); err != nil {
			return p, httpx.BadRequest(err.Error())
		}
	}
	if w := strings.TrimSpace(c.Query("week_to")); w != "" {
		if p.weekTo, err = NormalizeWeek(w); err != nil {
			return p, httpx.BadRequest(err.Error())
		}
	}
	if p.weekFrom != "" && p.weekTo != "" && p.weekFrom > p.weekTo {
		return p, httpx.BadRequest("période invalide : week_from postérieure à week_to")
	}
	return p, nil
}

// compute resolves the versions, loads the data and runs the engine.
func (h *Handler) compute(ctx context.Context, p params) (domain.AnalyseResult, error) {
	plan, err := h.repo.ResolveVersion(ctx, domain.KindPlan, p.planID)
	if err != nil {
		return domain.AnalyseResult{}, err
	}
	realise, err := h.repo.ResolveVersion(ctx, domain.KindRealise, p.realiseID)
	if err != nil {
		return domain.AnalyseResult{}, err
	}
	s, err := h.st.GetSettings(ctx)
	if err != nil {
		return domain.AnalyseResult{}, err
	}
	in, err := h.repo.LoadInput(ctx, plan, realise)
	if err != nil {
		return domain.AnalyseResult{}, err
	}
	in.WeekFrom, in.WeekTo, in.IncludeInactive = p.weekFrom, p.weekTo, p.includeInactive
	in.Now = h.st.Now()
	res := Run(in, s)
	if err := h.mergeSuivi(ctx, &res); err != nil {
		return domain.AnalyseResult{}, err
	}
	return res, nil
}

func (h *Handler) analyse(c *gin.Context) {
	p, err := readParams(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	res, err := h.compute(c, p)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	lp := lastParams{
		PlanVersionID: res.Meta.PlanVersion.ID, RealiseVersionID: res.Meta.RealiseVersion.ID,
		WeekFrom: res.Meta.WeekFrom, WeekTo: res.Meta.WeekTo, IncludeInactive: p.includeInactive,
	}
	if err := h.repo.SaveLast(c, lp, &res); err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// FlagLabel is the human label of a flag (CSV).
var FlagLabel = map[domain.Flag]string{
	domain.FlagAbsence:        "Absence totale",
	domain.FlagHorsPlan:       "Hors plan",
	domain.FlagSurImputation:  "FLAG sur-imputation",
	domain.FlagSousImputation: "FLAG sous-imputation",
	domain.FlagConforme:       "Conforme",
}

// FilterEcarts applies the CSV filters (ct, ressource, flag, squad_id).
// ressource matches the PDC code or the label, case-insensitively.
// FilterEcarts applies the CSV filters; flags is a set (empty = all flags).
func FilterEcarts(rows []domain.EcartRow, ct, ressource string, flags map[domain.Flag]bool, squadID string) []domain.EcartRow {
	out := []domain.EcartRow{}
	for _, r := range rows {
		if ct != "" && !strings.EqualFold(r.CT, ct) {
			continue
		}
		if ressource != "" && !strings.EqualFold(r.Ressource, ressource) && !strings.EqualFold(r.RessourceLabel, ressource) {
			continue
		}
		if len(flags) > 0 && !flags[r.Flag] {
			continue
		}
		if squadID != "" && (r.SquadID == nil || *r.SquadID != squadID) {
			continue
		}
		out = append(out, r)
	}
	return out
}

func (h *Handler) ecartsCSV(c *gin.Context) {
	p, err := readParams(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	// flag accepte une liste séparée par des virgules et/ou des paramètres répétés.
	flags := map[domain.Flag]bool{}
	for _, raw := range c.QueryArray("flag") {
		for _, f := range strings.Split(raw, ",") {
			if f = strings.TrimSpace(f); f == "" {
				continue
			}
			if _, ok := domain.FlagSeverity[domain.Flag(f)]; !ok {
				httpx.Error(c, httpx.BadRequest("flag inconnu : "+f))
				return
			}
			flags[domain.Flag(f)] = true
		}
	}
	res, err := h.compute(c, p)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	rows := FilterEcarts(res.Ecarts, strings.TrimSpace(c.Query("ct")), strings.TrimSpace(c.Query("ressource")),
		flags, strings.TrimSpace(c.Query("squad_id")))
	header := []string{"Ressource", "CT", "Semaine", "Prévu (h)", "Réel (h)", "Écart (h)", "Flag", "Confiance"}
	httpx.CSV(c, "ecarts.csv", header, func(write func([]string) error) error {
		for _, r := range rows {
			if err := write([]string{r.Ressource, r.CT, r.Semaine, httpx.FormatFloat(r.Prevu), httpx.FormatFloat(r.Reel),
				httpx.FormatFloat(r.Ecart), FlagLabel[r.Flag], string(r.Confidence)}); err != nil {
				return err
			}
		}
		return nil
	})
}

func (h *Handler) realiseCSV(c *gin.Context) {
	p, err := readParams(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	v, err := h.repo.ResolveVersion(c, domain.KindRealise, p.realiseID)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	s, err := h.st.GetSettings(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	entries, err := h.repo.Entries(c, v.ID)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	mask := httpx.QueryBool(c, "mask_sensitive", false)
	en := NewEnricher(s)
	header := append(append([]string{}, realiseHeader...), "iso_week", "heures", "eur", "classification")
	httpx.CSV(c, "realise-enrichi.csv", header, func(write func([]string) error) error {
		for i := range entries {
			e := &entries[i]
			x := en.Enrich(e)
			// Les bornes de période ne filtrent l'export que si elles sont explicites.
			if p.weekFrom != "" && (x.ISOWeek == "" || x.ISOWeek < p.weekFrom) {
				continue
			}
			if p.weekTo != "" && (x.ISOWeek == "" || x.ISOWeek > p.weekTo) {
				continue
			}
			rec := append(realiseRecord(e, mask), x.ISOWeek, httpx.FormatFloat(x.Heures), httpx.FormatFloat(x.Eur), string(x.Classification))
			if err := write(rec); err != nil {
				return err
			}
		}
		return nil
	})
}

var realiseHeader = []string{
	"ENTITE", "ACTIVITE", "SOUS-ACTIVITE", "TRIGRAMME", "TG", "TG - LIBELLE", "WP", "WP LIBELLE",
	"DESCRIPTION DEPENSES", "CATEGORIE", "TYPE", "CATEGORIE DEPENSES POUR FNP AUTOMATIQUES",
	"EMPLOYE/FOURNISSEUR", "MATRICULE", "FPC", "CEA", "QUANTITE", "TOTAL EN €", "DATE DEPENSE",
	"PERIODE COMPTABLE", "COMPTE COMPTABLE", "N° FACTURE", "n° COMMANDE", "n° LIGNE", "LOT DE PROGRAMME IFRS15",
	"NOM RESSOURCE", "FOURNISSEUR", "CODE ARTICLE", "MOIS COMPTABLE", "LIGNE EXCEL", "STATUT PARSING", "MOTIF",
}

func realiseRecord(e *domain.RealiseEntry, mask bool) []string {
	sens := func(v string) string {
		if mask {
			return ""
		}
		return v
	}
	numLigne := ""
	if e.NumLigne != nil {
		numLigne = itoa(*e.NumLigne)
	}
	return []string{
		e.Entite, e.Activite, e.SousActivite, e.Trigramme, e.TG, e.TGLibelle, e.WP, e.WPLibelle,
		sens(e.DescriptionDepenses), e.Categorie, e.Type, e.CategorieFNP,
		sens(e.EmployeFournisseur), sens(e.Matricule), e.FPC, e.CEA, httpx.FormatFloat(e.Quantite), httpx.FormatFloat(e.TotalEur),
		e.DateDepense, e.PeriodeComptable, e.CompteComptable, sens(e.NumFacture), sens(e.NumCommande), numLigne, e.LotIFRS15,
		sens(e.NomRessource), sens(e.Fournisseur), e.CodeArticle, e.MoisComptable, itoa(e.RowNum), string(e.StatutParsing), e.MotifRejet,
	}
}

type confirmBody struct {
	PersonneID string `json:"personne_id"`
	Alias      string `json:"alias"`
	Operateur  string `json:"operateur"`
}

func (h *Handler) confirmAlias(c *gin.Context) {
	var b confirmBody
	if err := c.ShouldBindJSON(&b); err != nil {
		httpx.Error(c, httpx.BadRequest("corps JSON invalide"))
		return
	}
	if strings.TrimSpace(b.PersonneID) == "" || strings.TrimSpace(b.Alias) == "" {
		httpx.Error(c, httpx.BadRequest("personne_id et alias sont requis"))
		return
	}
	p, err := h.repo.ConfirmAlias(c, strings.TrimSpace(b.PersonneID), b.Alias, httpx.Operateur(c, b.Operateur))
	if errors.Is(err, errBadAlias) {
		err = httpx.BadRequest("alias vide après normalisation")
	}
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}
