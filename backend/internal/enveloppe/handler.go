// Package enveloppe manages the budget envelopes entered per CT (DECISIONS n° 18).
package enveloppe

import (
	"database/sql"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

// Handler serves the /api/enveloppes endpoints (see docs/API.md).
type Handler struct{ st *store.Store }

func New(st *store.Store) *Handler { return &Handler{st: st} }

// Register mounts GET /enveloppes, PUT /enveloppes/:ct, DELETE /enveloppes/:ct.
func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/enveloppes", h.list)
	g.PUT("/enveloppes/:ct", h.save)
	g.DELETE("/enveloppes/:ct", h.remove)
}

// list: GET /enveloppes → EnveloppeCT[] trié par CT.
func (h *Handler) list(c *gin.Context) {
	out, err := listCTs(c, h.st.DB())
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// validate checks the input and returns the envelope to store (operateur and
// updated_at excepted).
func validate(in domain.EnveloppeInput) (domain.Enveloppe, error) {
	e := domain.Enveloppe{
		DateDebut:   strings.TrimSpace(in.DateDebut),
		DateFin:     strings.TrimSpace(in.DateFin),
		Commentaire: strings.TrimSpace(in.Commentaire),
	}
	for _, d := range []struct{ nom, v string }{{"date de début", e.DateDebut}, {"date de fin", e.DateFin}} {
		if d.v == "" {
			return e, httpx.BadRequest(d.nom + " requise")
		}
		if _, err := time.Parse("2006-01-02", d.v); err != nil {
			return e, httpx.BadRequest(d.nom + " invalide (AAAA-MM-JJ attendu)")
		}
	}
	if e.DateFin < e.DateDebut {
		return e, httpx.BadRequest("la date de fin précède la date de début")
	}
	if in.Montant == nil {
		return e, httpx.BadRequest("montant requis")
	}
	if m := *in.Montant; math.IsNaN(m) || math.IsInf(m, 0) || m < 0 {
		return e, httpx.BadRequest("montant invalide (nombre positif ou nul attendu)")
	}
	e.Montant = *in.Montant
	return e, nil
}

// save: PUT /enveloppes/:ct (body EnveloppeInput) → EnveloppeCT. Le CT doit être
// connu d'une source ou déjà configuré.
func (h *Handler) save(c *gin.Context) {
	var in domain.EnveloppeInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Error(c, httpx.BadRequest("corps JSON invalide"))
		return
	}
	e, err := validate(in)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	ct := strings.TrimSpace(c.Param("ct"))
	e.Operateur = httpx.Operateur(c, in.Operateur)
	at := store.FormatTime(h.st.Now())
	var out domain.EnveloppeCT
	err = h.st.Tx(c, func(tx *sql.Tx) error {
		if _, err := getCT(c, tx, ct); err != nil {
			return err
		}
		if err := upsertEnveloppe(c, tx, ct, e, at); err != nil {
			return err
		}
		// Jamais le montant dans le journal.
		if err := h.st.Audit(c, tx, e.Operateur, "update", "enveloppe", ct, ""); err != nil {
			return err
		}
		got, err := getCT(c, tx, ct)
		out = got
		return err
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// remove: DELETE /enveloppes/:ct → 204 ; 404 si le CT n'a pas d'enveloppe.
func (h *Handler) remove(c *gin.Context) {
	ct := strings.TrimSpace(c.Param("ct"))
	err := h.st.Tx(c, func(tx *sql.Tx) error {
		if err := deleteEnveloppe(c, tx, ct); err != nil {
			return err
		}
		return h.st.Audit(c, tx, httpx.Operateur(c, ""), "delete", "enveloppe", ct, "")
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
