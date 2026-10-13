package analyse

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"njord/internal/httpx"
)

// previsionsAnnee serves GET /analyse/previsions?annee=N (DECISIONS n° 24) :
// mêmes paramètres que /analyse ; annee absente ou 0 = Tout.
// CONTRAT (phase 0) : corps à écrire par l'agent prévisions.
func (h *Handler) previsionsAnnee(c *gin.Context) {
	httpx.Error(c, httpx.BadRequest("non implémenté"))
	_ = http.StatusOK
}
