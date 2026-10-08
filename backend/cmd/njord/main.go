// Command njord serves the Njord API (and optionally the built frontend).
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/analyse"
	"njord/internal/core"
	"njord/internal/plan"
	"njord/internal/provision"
	"njord/internal/realise"
	"njord/internal/referentiel"
	"njord/internal/store"
)

func main() {
	addr := flag.String("addr", ":8080", "adresse d'écoute")
	dbPath := flag.String("db", "./data/njord.db", "fichier SQLite")
	static := flag.String("static", "", "répertoire du frontend buildé à servir (optionnel)")
	flag.Parse()

	st, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("ouverture base: %v", err)
	}
	defer st.Close()

	r := NewRouter(st)
	if *static != "" {
		serveSPA(r, *static)
	}
	log.Printf("Njord API sur %s (base %s)", *addr, *dbPath)
	if err := r.Run(*addr); err != nil {
		log.Fatal(err)
	}
}

// NewRouter builds the gin engine with every module mounted under /api.
func NewRouter(st *store.Store) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery(), gin.LoggerWithConfig(gin.LoggerConfig{SkipPaths: []string{"/api/health"}}))
	r.MaxMultipartMemory = 64 << 20
	api := r.Group("/api")
	core.New(st).Register(api)
	plan.New(st).Register(api)
	referentiel.New(st).Register(api)
	realise.New(st).Register(api)
	provision.New(st).Register(api)
	analyse.New(st).Register(api)
	return r
}

func serveSPA(r *gin.Engine, dir string) {
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "not_found", "message": "route inconnue"}})
			return
		}
		p := filepath.Join(dir, filepath.Clean("/"+c.Request.URL.Path))
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			c.File(p)
			return
		}
		c.File(filepath.Join(dir, "index.html"))
	})
}
