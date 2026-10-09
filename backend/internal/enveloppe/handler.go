// Package enveloppe manages the budget envelopes entered per CT (DECISIONS n° 18).
package enveloppe

import (
	"github.com/gin-gonic/gin"

	"njord/internal/store"
)

type Handler struct{ st *store.Store }

func New(st *store.Store) *Handler { return &Handler{st: st} }

// Register mounts GET /enveloppes, PUT /enveloppes/:ct, DELETE /enveloppes/:ct.
func (h *Handler) Register(g *gin.RouterGroup) {}
