package plan

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api endpoints of the plan module (see docs/API.md).
type Handler struct {
	st  *store.Store
	svc *Service
}

func New(st *store.Store) *Handler { return &Handler{st: st, svc: NewService(st)} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	p := g.Group("/plan")
	p.POST("/imports/preview", h.preview)
	p.POST("/imports", h.commit)
	p.GET("/versions", h.listVersions)
	p.GET("/versions/:id", h.getVersion)
	p.POST("/versions/:id/archive", h.archive)
	p.POST("/versions/:id/reactivate", h.reactivate)
	p.POST("/versions/:id/purge", h.purge)
	p.GET("/versions/:id/facets", h.facets)
	p.GET("/versions/:id/lines", h.lines)
	p.GET("/versions/:id/lines.csv", h.linesCSV)
}

func importError(err error) error {
	var pe *ParseError
	if errors.As(err, &pe) {
		return httpx.Unprocessable(pe.Code, pe.Msg)
	}
	return err
}

func (h *Handler) preview(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	rep, err := h.svc.Preview(c.Request.Context(), data, filename, c.PostForm("intitule"))
	if err != nil {
		httpx.Error(c, importError(err))
		return
	}
	c.JSON(http.StatusOK, rep)
}

func (h *Handler) commit(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	res, err := h.svc.Commit(c.Request.Context(), data, filename, c.PostForm("intitule"),
		httpx.Operateur(c, c.PostForm("importeur")), httpx.FormBool(c, "archive_active", true))
	if err != nil {
		httpx.Error(c, importError(err))
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) listVersions(c *gin.Context) {
	vs, err := h.st.ListVersions(c.Request.Context(), domain.KindPlan, httpx.QueryBool(c, "include_purged", false))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, vs)
}

func (h *Handler) getVersion(c *gin.Context) {
	v, err := h.st.GetVersion(c.Request.Context(), domain.KindPlan, c.Param("id"))
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

func bindOptional(c *gin.Context) (lifecycleBody, error) {
	var b lifecycleBody
	if c.Request.ContentLength != 0 && c.Request.Body != nil {
		if err := c.ShouldBindJSON(&b); err != nil && !errors.Is(err, io.EOF) {
			return b, httpx.BadRequest("corps JSON invalide")
		}
	}
	return b, nil
}

func (h *Handler) archive(c *gin.Context) {
	b, err := bindOptional(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	v, err := h.st.Archive(c.Request.Context(), domain.KindPlan, c.Param("id"), httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) reactivate(c *gin.Context) {
	b, err := bindOptional(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	v, err := h.st.Reactivate(c.Request.Context(), domain.KindPlan, c.Param("id"), httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) purge(c *gin.Context) {
	b, err := bindOptional(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	v, err := h.st.Purge(c.Request.Context(), domain.KindPlan, c.Param("id"), b.ConfirmIntitule, httpx.Operateur(c, b.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) facets(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if _, err := h.st.GetVersion(ctx, domain.KindPlan, id); err != nil {
		httpx.Error(c, err)
		return
	}
	f, err := Facets(ctx, h.st.DB(), id)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, f)
}

func (h *Handler) filteredLines(c *gin.Context) ([]domain.PlanLine, LineFilter, bool) {
	ctx := c.Request.Context()
	id := c.Param("id")
	if _, err := h.st.GetVersion(ctx, domain.KindPlan, id); err != nil {
		httpx.Error(c, err)
		return nil, LineFilter{}, false
	}
	f, err := filterFromQuery(c)
	if err != nil {
		httpx.Error(c, err)
		return nil, f, false
	}
	lines, err := QueryLines(ctx, h.st.DB(), id, f)
	if err != nil {
		httpx.Error(c, err)
		return nil, f, false
	}
	return lines, f, true
}

func (h *Handler) lines(c *gin.Context) {
	lines, _, ok := h.filteredLines(c)
	if !ok {
		return
	}
	limit, offset := httpx.Pagination(c)
	page := domain.PlanLinesPage{Items: []domain.PlanLine{}, Total: len(lines)}
	for _, l := range lines {
		page.Totals.ChargeTotale += l.ChargeTotale
		page.Totals.PPS += l.PPS
	}
	if offset < len(lines) {
		end := offset + limit
		if end > len(lines) {
			end = len(lines)
		}
		page.Items = lines[offset:end]
	}
	c.JSON(http.StatusOK, page)
}

// CSVHeader is the column list of lines.csv (ressource = code brut du fichier,
// conservé par fidélité à la source ; l'identité est nom_prenom).
var CSVHeader = []string{
	"row_num", "statut_parsing", "motif_rejet",
	"ct", "ressource", "libelle", "nom_prenom", "type_affectation", "ligne_cout", "charge_totale", "pps",
	"pourcentage", "unite", "calcul_duree", "date_debut", "date_fin",
	"inactive", "groupe",
}

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (h *Handler) linesCSV(c *gin.Context) {
	lines, _, ok := h.filteredLines(c)
	if !ok {
		return
	}
	name := "plan-" + c.Param("id")
	if v, err := h.st.GetVersion(c.Request.Context(), domain.KindPlan, c.Param("id")); err == nil {
		if s := strings.Trim(unsafeFilename.ReplaceAllString(v.Intitule, "_"), "_"); s != "" {
			name = "plan-" + s
		}
	}
	httpx.CSV(c, name+"-lignes.csv", CSVHeader, func(write func([]string) error) error {
		for _, l := range lines {
			inactive := "false"
			if l.Inactive {
				inactive = "true"
			}
			if err := write([]string{
				fmt.Sprint(l.RowNum), string(l.StatutParsing), l.MotifRejet,
				l.CT, l.Ressource, l.Libelle, l.NomPrenom, l.TypeAffectation, l.LigneCout,
				httpx.FormatFloat(l.ChargeTotale), httpx.FormatFloat(l.PPS), fmt.Sprint(l.Pourcentage),
				l.Unite, l.CalculDuree, l.DateDebut, l.DateFin,
				inactive, l.Groupe,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}
