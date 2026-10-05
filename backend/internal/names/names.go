// Package names normalises person and squad names so that the plan de charge
// (Libellé "DURAND Claire / Squad Alpha", "Antoine De La Tour") and the réalisé
// (EMPLOYE/FOURNISSEUR "DURAND Claire Mme", "DE LA TOUR Antoine Mr.") can be
// compared by exact equality (SPEC_analyse §5.1 strategy 3: no fuzzy distance).
package names

import (
	"regexp"
	"sort"
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

// Normalize returns the matching key of a person name: accents removed, upper
// case, punctuation removed, civilities (M., Mme, Mr.…) removed, tokens sorted.
// "DE LA TOUR Antoine Mr." and "Antoine De La Tour" → "ANTOINE DE LA TOUR".
func Normalize(s string) string {
	toks := []string{}
	for _, t := range tokens(stripParens(s)) {
		if !civilites[t] {
			toks = append(toks, t)
		}
	}
	sort.Strings(toks)
	return strings.Join(toks, " ")
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

// PersonKey is Normalize(person part of a plan Libellé).
func PersonKey(libelle string) string {
	p, _ := SplitLibelle(libelle, nil)
	return Normalize(p)
}
