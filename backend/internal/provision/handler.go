package provision

import (
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api endpoints of the provision module (see docs/API.md).
type Handler struct {
	st  *store.Store
	svc *Service
}

func New(st *store.Store) *Handler { return &Handler{st: st, svc: NewService(st)} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	r := g.Group("/provision")
	r.POST("/imports/preview", h.preview)
	r.POST("/imports", h.importFile)
	r.GET("/versions", h.listVersions)
	r.GET("/versions/:id", h.getVersion)
	r.POST("/versions/:id/archive", h.archive)
	r.POST("/versions/:id/reactivate", h.reactivate)
	r.POST("/versions/:id/purge", h.purge)
	r.GET("/versions/:id/facets", h.facets)
	r.GET("/versions/:id/lines", h.lines)
	r.GET("/versions/:id/lines.csv", h.linesCSV)
}

// importError maps parser blocking errors to 422.
func importError(c *gin.Context, err error) {
	var pe *ParseError
	if errors.As(err, &pe) {
		httpx.Error(c, httpx.Unprocessable(pe.Code, pe.Msg))
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
	vs, err := h.st.ListVersions(c, domain.KindProvision, httpx.QueryBool(c, "include_purged", false))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, vs)
}

func (h *Handler) getVersion(c *gin.Context) {
	v, err := h.st.GetVersion(c, domain.KindProvision, c.Param("id"))
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
	v, err := h.st.Archive(c, domain.KindProvision, c.Param("id"), httpx.Operateur(c, b.Operateur))
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
	v, err := h.st.Reactivate(c, domain.KindProvision, c.Param("id"), httpx.Operateur(c, b.Operateur))
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
	v, err := h.st.Purge(c, domain.KindProvision, c.Param("id"), b.ConfirmIntitule, httpx.Operateur(c, b.Operateur))
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

// parseFilter reads the lines filters from the query string.
func parseFilter(c *gin.Context) (LineFilter, error) {
	f := LineFilter{
		CT:        queryValues(c, "ct"),
		LigneCout: queryValues(c, "ligne_cout"),
		Groupe:    queryValues(c, "groupe"),
		Statut:    queryValues(c, "statut"),
		Q:         c.Query("q"),
		Sort:      strings.TrimSpace(c.DefaultQuery("sort", "row_num")),
	}
	for _, s := range f.Statut {
		if s != string(domain.ParsingOK) && s != string(domain.ParsingWarn) && s != string(domain.ParsingDrop) {
			return f, httpx.BadRequest("paramètre statut invalide (ok|warn|drop)")
		}
	}
	if f.Sort == "" {
		f.Sort = "row_num"
	}
	valid := false
	for _, s := range SortFields {
		valid = valid || s == f.Sort
	}
	if !valid {
		return f, httpx.BadRequest("tri invalide (row_num, ct, montant ou date_debut)")
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

func (h *Handler) lines(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	limit, offset := httpx.Pagination(c)
	page, err := h.svc.Lines(c, c.Param("id"), f, limit, offset)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

// CSVHeader is the column list of lines.csv.
var CSVHeader = []string{
	"Ligne", "CT", "Libellé", "Groupe", "Ligne de coût", "Type de dépense", "Unité", "Montant",
	"Date de début", "Date de fin", "Statut", "Motif",
}

// CSVRecord renders one line in CSVHeader order.
func CSVRecord(l domain.ProvisionLine) []string {
	return []string{
		strconv.Itoa(l.RowNum), l.CT, l.Libelle, l.Groupe, l.LigneCout, l.TypeDepense, l.Unite,
		httpx.FormatFloat(l.Montant), l.DateDebut, l.DateFin, string(l.StatutParsing), l.MotifRejet,
	}
}

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (h *Handler) linesCSV(c *gin.Context) {
	f, err := parseFilter(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	id := c.Param("id")
	all, err := h.svc.AllLines(c, id, f)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	short := unsafeFilename.ReplaceAllString(id, "")
	if len(short) > 8 {
		short = short[:8]
	}
	httpx.CSV(c, "provisions_"+short+".csv", CSVHeader, func(write func([]string) error) error {
		for _, l := range all {
			if err := write(CSVRecord(l)); err != nil {
				return err
			}
		}
		return nil
	})
}
