// Package core serves the cross-module endpoints: health, settings, audit log.
package core

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"njord/internal/domain"
	"njord/internal/httpx"
	"njord/internal/store"
)

type Handler struct{ st *store.Store }

func New(st *store.Store) *Handler { return &Handler{st: st} }

func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	g.GET("/settings", h.getSettings)
	g.PUT("/settings", h.putSettings)
	g.GET("/audit", h.listAudit)
}

func (h *Handler) getSettings(c *gin.Context) {
	s, err := h.st.GetSettings(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) putSettings(c *gin.Context) {
	var s domain.Settings
	if err := c.ShouldBindJSON(&s); err != nil {
		httpx.Error(c, httpx.BadRequest("paramètres invalides"))
		return
	}
	out, err := h.st.PutSettings(c, s, httpx.Operateur(c, ""))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) listAudit(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	out, err := h.st.ListAudit(c, c.Query("objet_type"), limit)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
