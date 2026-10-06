// Package names identifies people by NOM + Prénom only (DECISIONS n° 8): the
// plan de charge (Libellé "DURAND Claire / Squad Alpha", "Antoine De La Tour")
// and the réalisé (EMPLOYE/FOURNISSEUR "DURAND Claire Mme", "DE LA TOUR Antoine
// Mr.") are both reduced to a NomPrenom whose Key is compared by exact equality.
// It also normalises squad names.
package names

import (
	"regexp"
	"strings"
	"unicode"

	"njord/internal/xlsxutil"
)

var civilites = map[string]bool{
	"M": true, "MR": true, "MME": true, "MLLE": true, "MLE": true, "MM": true,
	"MONSIEUR": true, "MADAME": true, "MADEMOISELLE": true,
}

// tokens: no accents, upper case, punctuation → separator.
func tokens(s string) []string {
	s = strings.ToUpper(xlsxutil.StripAccents(s))
	return strings.FieldsFunc(s, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// NormalizeSquad returns the key of a squad name (tokens kept in order).
// "Squad Alpha — Plateforme" → "SQUAD ALPHA PLATEFORME".
func NormalizeSquad(s string) string {
	return strings.Join(tokens(s), " ")
}

var parens = regexp.MustCompile(`\([^)]*\)`)

func stripParens(s string) string { return strings.TrimSpace(parens.ReplaceAllString(s, " ")) }

var squadKeywords = []string{
	"SQUAD", "CELLULE", "DIRECTION", "COMITE", "EQUIPE", "TEAM", "RESERVE", "SERVICE",
	"POLE", "DEPARTEMENT", "PLATEAU", "TRIBU", "CHAPTER", "GUILDE", "TRANSVERSE",
}

// LooksLikeSquad: heuristic on organisation keywords ("Squad Alpha", "Cellule Qualité"…).
func LooksLikeSquad(seg string) bool {
	for _, t := range tokens(seg) {
		for _, k := range squadKeywords {
			if t == k {
				return true
			}
		}
	}
	return false
}

// SplitLibelle splits a plan Libellé into its person part and squad part.
// Parenthesised notes are dropped; segments are separated by "/"; a segment is
// a squad if isSquad(seg) (or LooksLikeSquad when isSquad is nil).
//
//	"DURAND Claire / Squad Alpha"    → ("DURAND Claire", "Squad Alpha")
//	"Cellule Qualité / BONNET Hugo"  → ("BONNET Hugo", "Cellule Qualité")
//	"GUERIN Thomas (support)"        → ("GUERIN Thomas", "")
//	"Squad Beta"                     → ("", "Squad Beta")
func SplitLibelle(libelle string, isSquad func(seg string) bool) (person, squad string) {
	if isSquad == nil {
		isSquad = LooksLikeSquad
	}
	for _, seg := range strings.Split(stripParens(libelle), "/") {
		seg = strings.Join(strings.Fields(seg), " ")
		if seg == "" {
			continue
		}
		if isSquad(seg) {
			if squad == "" {
				squad = seg
			}
		} else if person == "" {
			person = seg
		}
	}
	return person, squad
}
