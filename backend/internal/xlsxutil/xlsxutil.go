// Package xlsxutil reads Excel workbooks for the import parsers: locate the
// data table (sheet + header row) by column names, and convert raw cells.
package xlsxutil

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// ErrSheetNotFound: no sheet contains a header row accepted by the matcher.
var ErrSheetNotFound = errors.New("onglet introuvable")

// Table is a located data table: rows after the header, raw cell values
// (Excel serials are kept as numbers-as-strings).
type Table struct {
	Sheet     string
	HeaderRow int        // 1-based Excel row number of the header
	Header    []string   // raw header cells
	Rows      [][]string // data rows (each padded to len(Header) at least)
	RowNums   []int      // 1-based Excel row numbers of Rows
}

// HeaderMatcher returns true when row is the header row it is looking for.
type HeaderMatcher func(normalizedRow []string) bool

// FindTable opens the workbook and looks for the header row: first in the
// preferred sheets (in order), then in every sheet; only the first maxScan
// rows of each sheet are scanned. The matcher receives NormHeader-ed cells.
func FindTable(data []byte, preferredSheets []string, maxScan int, match HeaderMatcher) (*Table, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("fichier Excel illisible : %w", err)
	}
	defer f.Close()
	sheets := []string{}
	seen := map[string]bool{}
	all := f.GetSheetList()
	for _, p := range preferredSheets {
		for _, s := range all {
			if strings.EqualFold(strings.TrimSpace(s), p) && !seen[s] {
				sheets = append(sheets, s)
				seen[s] = true
			}
		}
	}
	for _, s := range all {
		if !seen[s] {
			sheets = append(sheets, s)
		}
	}
	for _, sheet := range sheets {
		rows, err := f.GetRows(sheet, excelize.Options{RawCellValue: true})
		if err != nil {
			continue
		}
		for i := 0; i < len(rows) && i < maxScan; i++ {
			normed := make([]string, len(rows[i]))
			for j, c := range rows[i] {
				normed[j] = NormHeader(c)
			}
			if !match(normed) {
				continue
			}
			t := &Table{Sheet: sheet, HeaderRow: i + 1, Header: rows[i]}
			for k := i + 1; k < len(rows); k++ {
				r := rows[k]
				for len(r) < len(t.Header) {
					r = append(r, "")
				}
				t.Rows = append(t.Rows, r)
				t.RowNums = append(t.RowNums, k+1)
			}
			return t, nil
		}
	}
	return nil, ErrSheetNotFound
}

var stripMarks = runes.Remove(runes.In(unicode.Mn))

// StripAccents removes diacritics ("Réalisé" → "Realise").
func StripAccents(s string) string {
	out, _, err := transform.String(transform.Chain(norm.NFD, stripMarks, norm.NFC), s)
	if err != nil {
		return s
	}
	return out
}

// NormHeader normalises a header label for comparison: no accents, lower case,
// any run of non-alphanumeric characters collapsed to one space, trimmed.
// "n° COMMANDE" → "n commande", "TG - LIBELLE" → "tg libelle", ".PPS" → "pps".
func NormHeader(s string) string {
	s = strings.ToLower(StripAccents(s))
	var b strings.Builder
	space := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
		} else {
			space = true
		}
	}
	return b.String()
}

// IndexOf returns the position of the first normalized header equal to one of
// the candidates (already NormHeader-ed), or -1.
func IndexOf(normalizedHeader []string, candidates ...string) int {
	for i, h := range normalizedHeader {
		for _, c := range candidates {
			if h == c {
				return i
			}
		}
	}
	return -1
}

// Cell returns row[i] trimmed, "" if out of range.
func Cell(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

// NullDash maps the literal null value "-" (and blanks) to "".
func NullDash(s string) string {
	s = strings.TrimSpace(s)
	if s == "-" {
		return ""
	}
	return s
}

// ParseNumber parses "1 234,5", "1234.5", "-61 800.0"… ("" or "-" → error).
func ParseNumber(s string) (float64, error) {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer(" ", "", " ", "", " ", "", "€", "").Replace(s)
	if s == "" || s == "-" {
		return 0, errors.New("valeur vide")
	}
	if strings.Contains(s, ",") {
		if strings.Contains(s, ".") { // 1.234,5
			s = strings.ReplaceAll(s, ".", "")
		}
		s = strings.ReplaceAll(s, ",", ".")
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("nombre invalide %q", s)
	}
	return v, nil
}

var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

// SerialToDate converts an Excel serial (possibly fractional, e.g.
// 46112.9999) to a date: the serial is rounded to the nearest day.
func SerialToDate(serial float64) time.Time {
	return excelEpoch.AddDate(0, 0, int(math.Round(serial)))
}

// ParseDate accepts an Excel serial, "YYYY-MM-DD", "DD/MM/YYYY" or "DD/MM/YY"
// and returns "YYYY-MM-DD".
func ParseDate(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "-" {
		return "", errors.New("date vide")
	}
	if v, err := ParseNumber(s); err == nil {
		if v < 1 || v > 2958465 {
			return "", fmt.Errorf("date invalide %q", s)
		}
		return SerialToDate(v).Format("2006-01-02"), nil
	}
	for _, layout := range []string{"2006-01-02", "2006-01-02T15:04:05Z07:00", "2006-01-02 15:04:05", "02/01/2006", "02/01/06", "2/1/2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02"), nil
		}
	}
	return "", fmt.Errorf("date invalide %q", s)
}

// CodeAndLabel splits "Y99F90001 - Alpha Core Team" into ("Y99F90001", full).
func CodeAndLabel(s string) (code, label string) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, " - "); i >= 0 {
		return strings.TrimSpace(s[:i]), s
	}
	return s, s
}
