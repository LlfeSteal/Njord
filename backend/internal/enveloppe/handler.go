// Package enveloppe manages the budget envelopes per CT (DECISIONS n° 18 and
// 27): one envelope per CT (period and amount, free category label), entered
// in the interface (PUT / DELETE /enveloppes/:ct), and the list of every known
// CT with its envelope. The « CàT par CT » file import was removed (n° 27).
package enveloppe

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api/enveloppes endpoints (see docs/API.md).
type Handler struct {
	st  *store.Store
	svc *Service
}

func New(st *store.Store) *Handler { return &Handler{st: st, svc: NewService(st)} }

// Register mounts GET /enveloppes, PUT /enveloppes/:ct and DELETE /enveloppes/:ct.
func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/enveloppes", h.list)
	g.PUT("/enveloppes/:ct", h.put)
	g.DELETE("/enveloppes/:ct", h.delete)
}

// list: GET /enveloppes → EnveloppesListe.
func (h *Handler) list(c *gin.Context) {
	out, err := listCTs(c.Request.Context(), h.st.DB())
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// put: PUT /enveloppes/:ct (EnveloppeInput) → EnveloppeCT ; crée ou remplace l'enveloppe.
func (h *Handler) put(c *gin.Context) {
	var in domain.EnveloppeInput
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	if strings.TrimSpace(string(data)) == "" {
		httpx.Error(c, httpx.BadRequest("corps JSON requis"))
		return
	}
	if err := json.Unmarshal(data, &in); err != nil {
		httpx.Error(c, httpx.BadRequest("corps JSON invalide"))
		return
	}
	out, err := h.svc.Put(c.Request.Context(), c.Param("ct"), in, httpx.Operateur(c, in.Operateur))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// delete: DELETE /enveloppes/:ct?operateur= → 204 ; 404 si le CT n'a pas d'enveloppe.
func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.Param("ct"), httpx.Operateur(c, "")); err != nil {
		httpx.Error(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
