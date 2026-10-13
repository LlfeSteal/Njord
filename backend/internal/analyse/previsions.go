package analyse

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/httpx"
)

// previsionsAnnee serves GET /analyse/previsions?annee=N (DECISIONS n° 24) :
// mêmes paramètres que /analyse ; annee absente ou 0 = Tout (identique à
// AnalyseResult.previsions). Lecture seule : ni dernier rendu sauvegardé, ni
// suivi des anomalies (les prévisions n'en portent pas).
func (h *Handler) previsionsAnnee(c *gin.Context) {
	p, err := readParams(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	annee := 0
	if raw := strings.TrimSpace(c.Query("annee")); raw != "" {
		if annee, err = strconv.Atoi(raw); err != nil || annee < 0 || annee > 9999 {
			httpx.Error(c, httpx.BadRequest("année invalide « "+raw+" » (format attendu AAAA, 0 = Tout)"))
			return
		}
	}
	in, s, err := h.input(c, p)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, RunPrevisions(in, s, annee))
}
