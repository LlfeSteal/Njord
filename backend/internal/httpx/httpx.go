// Package httpx gathers the HTTP helpers shared by the module handlers:
// uniform JSON errors, multipart upload, pagination, CSV streaming.
package httpx

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"njord/internal/store"
)

// APIError is rendered as {"error": {"code": ..., "message": ...}}.
type APIError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string { return e.Message }

func BadRequest(msg string) error { return &APIError{http.StatusBadRequest, "bad_request", msg} }

// Unprocessable is used for blocking import errors ("onglet introuvable", en-tête non conforme).
func Unprocessable(code, msg string) error {
	return &APIError{http.StatusUnprocessableEntity, code, msg}
}

// Error renders err: APIError as is, store.ErrNotFound → 404,
// store.PreconditionError → 409, anything else → 500 (logged without payload).
func Error(c *gin.Context, err error) {
	var api *APIError
	var pre *store.PreconditionError
	switch {
	case errors.As(err, &api):
	case errors.Is(err, store.ErrNotFound):
		api = &APIError{http.StatusNotFound, "not_found", "objet introuvable"}
	case errors.As(err, &pre):
		api = &APIError{http.StatusConflict, "precondition", pre.Msg}
	default:
		log.Printf("ERROR %s %s: %v", c.Request.Method, c.FullPath(), err)
		api = &APIError{http.StatusInternalServerError, "internal", "erreur interne"}
	}
	c.AbortWithStatusJSON(api.Status, gin.H{"error": api})
}

// MaxUpload is the maximum accepted upload size.
const MaxUpload = 50 << 20

// FormFile reads the multipart file field (default "file").
func FormFile(c *gin.Context, field string) (data []byte, filename string, err error) {
	if field == "" {
		field = "file"
	}
	fh, err := c.FormFile(field)
	if err != nil {
		return nil, "", BadRequest("fichier manquant (champ « " + field + " »)")
	}
	if fh.Size > MaxUpload {
		return nil, "", BadRequest("fichier trop volumineux")
	}
	f, err := fh.Open()
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	data, err = io.ReadAll(io.LimitReader(f, MaxUpload+1))
	if err != nil {
		return nil, "", err
	}
	return data, fh.Filename, nil
}

// Operateur returns the free-text operator name (no authentication in Njord):
// form/query/JSON field "operateur" or "importeur", header X-User, else "local".
func Operateur(c *gin.Context, fromBody string) string {
	for _, v := range []string{fromBody, c.PostForm("operateur"), c.PostForm("importeur"), c.Query("operateur"), c.GetHeader("X-User")} {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return "local"
}

// Pagination reads limit (default 100, max 5000) and offset query params.
func Pagination(c *gin.Context) (limit, offset int) {
	limit, _ = strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ = strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 {
		limit = 100
	}
	if limit > 5000 {
		limit = 5000
	}
	if offset < 0 {
		offset = 0
	}
	return
}

// QueryBool parses ?key=true|1|false|0, def when absent/invalid.
func QueryBool(c *gin.Context, key string, def bool) bool {
	v, ok := c.GetQuery(key)
	if !ok {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// FormBool is QueryBool for multipart/form fields.
func FormBool(c *gin.Context, key string, def bool) bool {
	v, ok := c.GetPostForm(key)
	if !ok {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// CSV streams a ';'-separated UTF-8 CSV with BOM (opens cleanly in French Excel).
// rows is called with a write function for each record.
func CSV(c *gin.Context, filename string, header []string, rows func(write func(record []string) error) error) {
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Status(http.StatusOK)
	c.Writer.WriteString("\xef\xbb\xbf")
	w := csv.NewWriter(c.Writer)
	w.Comma = ';'
	if err := w.Write(header); err != nil {
		return
	}
	if err := rows(w.Write); err != nil {
		log.Printf("ERROR csv %s: %v", filename, err)
	}
	w.Flush()
}

// FormatFloat formats numbers for CSV ("1234.5", no exponent).
func FormatFloat(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
