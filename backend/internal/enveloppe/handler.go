// Package enveloppe manages the budget envelopes per CT, imported from the
// « CàT par CT » export (DECISIONS n° 18): parsing, import (each confirmed
// import replaces every envelope) and consultation. No manual entry.
package enveloppe

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api/enveloppes endpoints (see docs/API.md).
type Handler struct {
	st  *store.Store
	svc *Service
}

func New(st *store.Store) *Handler { return &Handler{st: st, svc: NewService(st)} }

// Register mounts GET /enveloppes, POST /enveloppes/import/preview and
// POST /enveloppes/import.
func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/enveloppes", h.list)
	g.POST("/enveloppes/import/preview", h.preview)
	g.POST("/enveloppes/import", h.importFile)
}

// list: GET /enveloppes → EnveloppesListe.
func (h *Handler) list(c *gin.Context) {
	out, err := listCTs(c, h.st.DB())
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
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

// preview: POST /enveloppes/import/preview (multipart file) → ImportReport ; n'écrit rien.
func (h *Handler) preview(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	rep, err := h.svc.Preview(c, data, filename)
	if err != nil {
		importError(c, err)
		return
	}
	c.JSON(http.StatusOK, rep)
}

// importFile: POST /enveloppes/import (multipart file, importeur?) → ImportReport.
func (h *Handler) importFile(c *gin.Context) {
	data, filename, err := httpx.FormFile(c, "file")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	rep, err := h.svc.Import(c, data, filename, httpx.Operateur(c, ""))
	if err != nil {
		importError(c, err)
		return
	}
	c.JSON(http.StatusOK, rep)
}
