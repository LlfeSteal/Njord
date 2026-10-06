package referentiel

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"njord/internal/httpx"
	"njord/internal/names"
	"njord/internal/store"
)

// Handler serves the /api endpoints of the referentiel module (see docs/API.md).
type Handler struct{ st *store.Store }

func New(st *store.Store) *Handler { return &Handler{st: st} }

// Register mounts the module routes on the /api group.
func (h *Handler) Register(g *gin.RouterGroup) {
	g.GET("/personnes", h.listPersonnes)
	g.GET("/personnes/:id", h.getPersonne)
	g.PATCH("/personnes/:id", h.patchPersonne)
	g.GET("/squads", h.listSquads)
	g.POST("/squads", h.createSquad)
	g.GET("/squads/:id", h.getSquad)
	g.PATCH("/squads/:id", h.patchSquad)
	g.POST("/squads/:id/alias", h.addSquadAlias)
}

// bind decodes an optional JSON body into a field map (absent ≠ null).
func bind(c *gin.Context) (map[string]json.RawMessage, error) {
	m := map[string]json.RawMessage{}
	if c.Request.Body == nil {
		return m, nil
	}
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(data)) == "" {
		return m, nil
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, httpx.BadRequest("corps JSON invalide")
	}
	return m, nil
}

// str returns (value, present). A JSON null yields ("", true).
func str(m map[string]json.RawMessage, key string) (string, bool, error) {
	raw, ok := m[key]
	if !ok {
		return "", false, nil
	}
	if string(raw) == "null" {
		return "", true, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", true, httpx.BadRequest("champ « " + key + " » : texte attendu")
	}
	return strings.TrimSpace(s), true, nil
}

func operateur(c *gin.Context, m map[string]json.RawMessage) string {
	op, _, _ := str(m, "operateur")
	return httpx.Operateur(c, op)
}

// ---------------------------------------------------------------------------
// Personnes

func (h *Handler) listPersonnes(c *gin.Context) {
	ps, err := listPersonnes(c.Request.Context(), h.st.DB(), "")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	q := fold(strings.TrimSpace(c.Query("q")))
	out := ps[:0]
	for _, p := range ps {
		if matchPersonne(p, q) {
			out = append(out, p)
		}
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) getPersonne(c *gin.Context) {
	p, err := getPersonne(c.Request.Context(), h.st.DB(), c.Param("id"))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// personneTx runs fn in a transaction on an existing personne and returns it reloaded.
func (h *Handler) personneTx(c *gin.Context, id string, fn func(ctx context.Context, tx *sql.Tx) error) {
	ctx := c.Request.Context()
	var out any
	err := h.st.Tx(ctx, func(tx *sql.Tx) error {
		ok, err := exists(ctx, tx, `SELECT 1 FROM personnes WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if !ok {
			return store.ErrNotFound
		}
		if err := fn(ctx, tx); err != nil {
			return err
		}
		p, err := getPersonne(ctx, tx, id)
		out = p
		return err
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) patchPersonne(c *gin.Context) {
	m, err := bind(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	// DECISIONS n° 8 : NOM + Prénom est l'identité de la personne, il ne se modifie pas.
	if _, ok := m["display_name"]; ok {
		httpx.Error(c, httpx.BadRequest("le nom est l'identité de la personne : non modifiable"))
		return
	}
	id := c.Param("id")
	h.personneTx(c, id, func(ctx context.Context, tx *sql.Tx) error {
		changed := []string{}
		if v, ok, err := str(m, "statut"); err != nil {
			return err
		} else if ok {
			if v != "brouillon" && v != "validee" {
				return httpx.BadRequest("statut invalide (brouillon | validee)")
			}
			if _, err := tx.ExecContext(ctx, `UPDATE personnes SET statut = ? WHERE id = ?`, v, id); err != nil {
				return err
			}
			changed = append(changed, "statut="+v)
		}
		if v, ok, err := str(m, "squad_id"); err != nil {
			return err
		} else if ok {
			var sq any
			if v != "" {
				found, err := exists(ctx, tx, `SELECT 1 FROM squads WHERE id = ?`, v)
				if err != nil {
					return err
				}
				if !found {
					return httpx.BadRequest("squad inconnu")
				}
				sq = v
			}
			if _, err := tx.ExecContext(ctx, `UPDATE personnes SET squad_id = ? WHERE id = ?`, sq, id); err != nil {
				return err
			}
			changed = append(changed, "squad_id")
		}
		if len(changed) == 0 {
			return nil
		}
		return h.st.Audit(ctx, tx, operateur(c, m), "update", "personne", id, "champs : "+strings.Join(changed, ", "))
	})
}

// ---------------------------------------------------------------------------
// Squads

func (h *Handler) listSquads(c *gin.Context) {
	ss, err := listSquads(c.Request.Context(), h.st.DB(), "")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	if q := fold(strings.TrimSpace(c.Query("q"))); q != "" {
		out := ss[:0]
		for _, s := range ss {
			hit := strings.Contains(fold(s.NomCanonique), q)
			for _, a := range s.Alias {
				hit = hit || strings.Contains(fold(a), q)
			}
			if hit {
				out = append(out, s)
			}
		}
		ss = out
	}
	sort.SliceStable(ss, func(i, j int) bool { return fold(ss[i].NomCanonique) < fold(ss[j].NomCanonique) })
	c.JSON(http.StatusOK, ss)
}

func (h *Handler) getSquad(c *gin.Context) {
	s, err := getSquad(c.Request.Context(), h.st.DB(), c.Param("id"))
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

// checkParent validates parent_id for squad id ("" for a new squad): it must
// exist and not be the squad itself nor one of its descendants.
func checkParent(ctx context.Context, tx *sql.Tx, id, parent string) error {
	cur := parent
	for depth := 0; cur != ""; depth++ {
		if cur == id || depth > 1000 {
			return store.Precondition("rattachement impossible : boucle dans la hiérarchie des squads")
		}
		var p sql.NullString
		err := tx.QueryRowContext(ctx, `SELECT parent_id FROM squads WHERE id = ?`, cur).Scan(&p)
		if errors.Is(err, sql.ErrNoRows) {
			if cur == parent {
				return httpx.BadRequest("squad parent inconnu")
			}
			return nil
		}
		if err != nil {
			return err
		}
		cur = p.String
	}
	return nil
}

func (h *Handler) createSquad(c *gin.Context) {
	m, err := bind(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	nom, _, err1 := str(m, "nom_canonique")
	entite, _, err2 := str(m, "entite_rattachee")
	parent, _, err3 := str(m, "parent_id")
	for _, e := range []error{err1, err2, err3} {
		if e != nil {
			httpx.Error(c, e)
			return
		}
	}
	key := names.NormalizeSquad(nom)
	if key == "" {
		httpx.Error(c, httpx.BadRequest("nom canonique requis"))
		return
	}
	ctx := c.Request.Context()
	id := uuid.NewString()
	var out any
	err = h.st.Tx(ctx, func(tx *sql.Tx) error {
		if owner, err := squadKeyOwner(ctx, tx, key); err != nil {
			return err
		} else if owner != "" {
			return store.Precondition("un squad portant ce nom (ou cet alias) existe déjà")
		}
		var p any
		if parent != "" {
			if err := checkParent(ctx, tx, id, parent); err != nil {
				return err
			}
			p = parent
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO squads(id, nom_canonique, nom_normalise, entite_rattachee, parent_id, created_at) VALUES (?,?,?,?,?,?)`,
			id, nom, key, entite, p, store.FormatTime(h.st.Now())); err != nil {
			return err
		}
		if err := h.st.Audit(ctx, tx, operateur(c, m), "create", "squad", id, "nom="+nom); err != nil {
			return err
		}
		s, err := getSquad(ctx, tx, id)
		out = s
		return err
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) squadTx(c *gin.Context, id string, fn func(ctx context.Context, tx *sql.Tx) error) {
	ctx := c.Request.Context()
	var out any
	err := h.st.Tx(ctx, func(tx *sql.Tx) error {
		ok, err := exists(ctx, tx, `SELECT 1 FROM squads WHERE id = ?`, id)
		if err != nil {
			return err
		}
		if !ok {
			return store.ErrNotFound
		}
		if err := fn(ctx, tx); err != nil {
			return err
		}
		s, err := getSquad(ctx, tx, id)
		out = s
		return err
	})
	if err != nil {
		httpx.Error(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) patchSquad(c *gin.Context) {
	m, err := bind(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	id := c.Param("id")
	h.squadTx(c, id, func(ctx context.Context, tx *sql.Tx) error {
		changed := []string{}
		if v, ok, err := str(m, "nom_canonique"); err != nil {
			return err
		} else if ok {
			key := names.NormalizeSquad(v)
			if key == "" {
				return httpx.BadRequest("nom canonique requis")
			}
			var other string
			err := tx.QueryRowContext(ctx, `SELECT id FROM squads WHERE nom_normalise = ? AND id <> ?
				UNION ALL SELECT squad_id FROM squad_alias WHERE alias_normalise = ? AND squad_id <> ? LIMIT 1`, key, id, key, id).Scan(&other)
			if err == nil {
				return store.Precondition("un autre squad porte déjà ce nom (ou cet alias)")
			} else if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			// Le nom devient canonique : il ne reste pas en alias du même squad.
			if _, err := tx.ExecContext(ctx, `DELETE FROM squad_alias WHERE squad_id = ? AND alias_normalise = ?`, id, key); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE squads SET nom_canonique = ?, nom_normalise = ? WHERE id = ?`, v, key, id); err != nil {
				return err
			}
			changed = append(changed, "nom_canonique="+v)
		}
		if v, ok, err := str(m, "entite_rattachee"); err != nil {
			return err
		} else if ok {
			if _, err := tx.ExecContext(ctx, `UPDATE squads SET entite_rattachee = ? WHERE id = ?`, v, id); err != nil {
				return err
			}
			changed = append(changed, "entite_rattachee="+v)
		}
		if v, ok, err := str(m, "parent_id"); err != nil {
			return err
		} else if ok {
			var p any
			if v != "" {
				if err := checkParent(ctx, tx, id, v); err != nil {
					return err
				}
				p = v
			}
			if _, err := tx.ExecContext(ctx, `UPDATE squads SET parent_id = ? WHERE id = ?`, p, id); err != nil {
				return err
			}
			changed = append(changed, "parent_id="+v)
		}
		if len(changed) == 0 {
			return nil
		}
		return h.st.Audit(ctx, tx, operateur(c, m), "update", "squad", id, strings.Join(changed, ", "))
	})
}

func (h *Handler) addSquadAlias(c *gin.Context) {
	m, err := bind(c)
	if err != nil {
		httpx.Error(c, err)
		return
	}
	alias, _, err := str(m, "alias")
	if err != nil {
		httpx.Error(c, err)
		return
	}
	key := names.NormalizeSquad(alias)
	if key == "" {
		httpx.Error(c, httpx.BadRequest("alias vide"))
		return
	}
	id := c.Param("id")
	h.squadTx(c, id, func(ctx context.Context, tx *sql.Tx) error {
		owner, err := squadKeyOwner(ctx, tx, key)
		if err != nil {
			return err
		}
		if owner == id {
			return nil // déjà le nom ou un alias de ce squad
		}
		if owner != "" {
			return store.Precondition("ce nom est déjà le nom ou l'alias d'un autre squad")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO squad_alias(squad_id, alias, alias_normalise) VALUES (?,?,?)`, id, alias, key); err != nil {
			return err
		}
		return h.st.Audit(ctx, tx, operateur(c, m), "alias_add", "squad", id, "alias="+alias)
	})
}
