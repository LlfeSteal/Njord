package realise

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
	"njord/internal/xlsxutil"
)

// Handler serves the /api endpoints of the realise module (see docs/API.md).
type Handler struct {
	st  *store.Store
	svc *Service
}

func New(st *store.Store) *Handler { return &Handler{st: st, svc: NewService(st)} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	r := g.Group("/realise")
	r.POST("/imports/preview", h.preview)
	r.POST("/imports", h.importFile)
	r.GET("/versions", h.listVersions)
	r.GET("/versions/:id", h.getVersion)
	r.POST("/versions/:id/archive", h.archive)
	r.POST("/versions/:id/reactivate", h.reactivate)
	r.POST("/versions/:id/purge", h.purge)
	r.GET("/versions/:id/facets", h.facets)
	r.GET("/versions/:id/entries", h.entries)
	r.GET("/versions/:id/entries.csv", h.entriesCSV)
}

// importError maps parser blocking errors to 422.
func importError(c *gin.Context, err error) {
	var fe *FormatError
	if errors.As(err, &fe) {
		httpx.Error(c, httpx.Unprocessable(fe.Code, fe.Msg))
		return
	}
	httpx.Error(c, err)
}

func (h *Handler) preview(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	rep, err := h.svc.Preview(c, data, filename, c.PostForm("intitule"))
	if err != nil {
		importError(c, err)
		return
	}
	c.JSON(http.StatusOK, rep)
}

func (h *Handler) importFile(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	res, err := h.svc.Import(c, data, filename, c.PostForm("intitule"), httpx.Operateur(c, ""),
		httpx.FormBool(c, "archive_active", true))
	if err != nil {
		importError(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) listVersions(c *gin.Context) {
	vs, err := h.st.ListVersions(c, domain.KindRealise, httpx.QueryBool(c, "include_purged", false))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, vs)
}

func (h *Handler) getVersion(c *gin.Context) {
	v, err := h.st.GetVersion(c, domain.KindRealise, c.Param("id"))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

type lifecycleBody struct {
	Operateur       string `json:"operateur"`
	ConfirmIntitule string `json:"confirm_intitule"`
}

// bindBody reads the optional JSON body (empty body accepted).
func bindBody(c *gin.Context) (lifecycleBody, bool) {
	var b lifecycleBody
	if c.Request.ContentLength == 0 {
		return b, true
	}
	if err := c.ShouldBindJSON(&b); err != nil && !errors.Is(err, io.EOF) {
		httpx.Error(c, httpx.BadRequest("corps JSON invalide"))
		return b, false
	}
	return b, true
}

func (h *Handler) archive(c *gin.Context) {
	b, ok := bindBody(c)
	if !ok {
		return
	}
	v, err := h.st.Archive(c, domain.KindRealise, c.Param("id"), httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) reactivate(c *gin.Context) {
	b, ok := bindBody(c)
	if !ok {
		return
	}
	v, err := h.st.Reactivate(c, domain.KindRealise, c.Param("id"), httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) purge(c *gin.Context) {
	b, ok := bindBody(c)
	if !ok {
		return
	}
	v, err := h.st.Purge(c, domain.KindRealise, c.Param("id"), b.ConfirmIntitule, httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) facets(c *gin.Context) {
	f, err := h.svc.Facets(c, c.Param("id"))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, f)
}

// queryValues returns the non-empty values of a (possibly repeated) query param.
func queryValues(c *gin.Context, key string) []string {
	var out []string
	for _, v := range c.QueryArray(key) {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func queryDate(c *gin.Context, key string) (string, error) {
	v := strings.TrimSpace(c.Query(key))
	if v == "" {
		return "", nil
	}
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return "", httpx.BadRequest("paramètre " + key + " invalide (YYYY-MM-DD attendu)")
	}
	return v, nil
}

func queryFloat(c *gin.Context, key string) (*float64, error) {
	v := strings.TrimSpace(c.Query(key))
	if v == "" {
		return nil, nil
	}
	f, err := xlsxutil.ParseNumber(v)
	if err != nil {
		return nil, httpx.BadRequest("paramètre " + key + " invalide (nombre attendu)")
	}
	return &f, nil
}

// parseFilter reads the entries filters from the query string.
func parseFilter(c *gin.Context) (Filter, error) {
	f := Filter{
		Entite:            queryValues(c, "entite"),
		Activite:          queryValues(c, "activite"),
		Trigramme:         queryValues(c, "trigramme"),
		TG:                queryValues(c, "tg"),
		WP:                queryValues(c, "wp"),
		Categorie:         queryValues(c, "categorie"),
		Type:              queryValues(c, "type"),
		Lot:               queryValues(c, "lot"),
		Statut:            queryValues(c, "statut"),
		Q:                 c.Query("q"),
		SearchDescription: httpx.QueryBool(c, "search_description", false),
		MaskSensitive:     httpx.QueryBool(c, "mask_sensitive", false),
		Sort:              strings.TrimSpace(c.DefaultQuery("sort", "row_num")),
	}
	var err error
	if f.DateFrom, err = queryDate(c, "date_from"); err != nil {
		return f, err
	}
	if f.DateTo, err = queryDate(c, "date_to"); err != nil {
		return f, err
	}
	if f.MontantMin, err = queryFloat(c, "montant_min"); err != nil {
		return f, err
	}
	if f.MontantMax, err = queryFloat(c, "montant_max"); err != nil {
		return f, err
	}
	if f.Sort == "" {
		f.Sort = "row_num"
	}
	valid := false
	for _, s := range SortFields {
		valid = valid || s == f.Sort
	}
	if !valid {
		return f, httpx.BadRequest("tri invalide (row_num, date_depense, total_eur ou tg)")
	}
	switch strings.ToLower(strings.TrimSpace(c.DefaultQuery("order", "asc"))) {
	case "asc", "":
	case "desc":
		f.Desc = true
	default:
		return f, httpx.BadRequest("ordre invalide (asc ou desc)")
	}
	return f, nil
}

func (h *Handler) entries(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	limit, offset := httpx.Pagination(c)
	page, err := h.svc.Entries(c, c.Param("id"), f, limit, offset)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

// CSVHeader: every column of the entry (25 spec columns + demo extras).
var CSVHeader = []string{
	"LIGNE EXCEL", "STATUT PARSING", "MOTIF",
	"ENTITE", "ACTIVITE", "SOUS-ACTIVITE", "TRIGRAMME", "TG", "TG - LIBELLE", "WP", "WP LIBELLE",
	"DESCRIPTION DEPENSES", "CATEGORIE", "TYPE", "CATEGORIE DEPENSES POUR FNP AUTOMATIQUES",
	"EMPLOYE/FOURNISSEUR", "MATRICULE", "FPC", "CEA", "QUANTITE", "TOTAL EN €", "DATE DEPENSE",
	"PERIODE COMPTABLE", "COMPTE COMPTABLE", "N° FACTURE", "n° COMMANDE", "n° LIGNE", "LOT DE PROGRAMME IFRS15",
	"NOM RESSOURCE", "FOURNISSEUR", "CODE ARTICLE", "MOIS COMPTABLE",
}

// CSVRecord renders one entry in CSVHeader order.
func CSVRecord(e domain.RealiseEntry) []string {
	numLigne := ""
	if e.NumLigne != nil {
		numLigne = strconv.Itoa(*e.NumLigne)
	}
	return []string{
		strconv.Itoa(e.RowNum), string(e.StatutParsing), e.MotifRejet,
		e.Entite, e.Activite, e.SousActivite, e.Trigramme, e.TG, e.TGLibelle, e.WP, e.WPLibelle,
		e.DescriptionDepenses, e.Categorie, e.Type, e.CategorieFNP,
		e.EmployeFournisseur, e.Matricule, e.FPC, e.CEA, httpx.FormatFloat(e.Quantite), httpx.FormatFloat(e.TotalEur),
		e.DateDepense, e.PeriodeComptable, e.CompteComptable, e.NumFacture, e.NumCommande, numLigne, e.LotIFRS15,
		e.NomRessource, e.Fournisseur, e.CodeArticle, e.MoisComptable,
	}
}

func (h *Handler) entriesCSV(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	id := c.Param("id")
	all, err := h.svc.AllEntries(c, id, f)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	short := id
	if len(short) > 8 {
		short = short[:8]
	}
	httpx.CSV(c, "realise_"+short+".csv", CSVHeader, func(write func([]string) error) error {
		for _, e := range all {
			if err := write(CSVRecord(e)); err != nil {
				return err
			}
		}
		return nil
	})
}
