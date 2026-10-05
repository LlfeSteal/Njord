package analyse

import (
	"github.com/gin-gonic/gin"

	"njord/internal/store"
)

// Handler serves the /api endpoints of the analyse module (see docs/API.md).
type Handler struct{ st *store.Store }

func New(st *store.Store) *Handler { return &Handler{st: st} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	// TODO(analyse agent): routes.
}
