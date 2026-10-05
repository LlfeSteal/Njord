package names

import (
	"strings"
	"unicode"

	"njord/internal/xlsxutil"
)

// NomPrenom is a person name split into family name (upper case) and first name.
type NomPrenom struct {
	Nom    string // "DE LA TOUR"
	Prenom string // "Antoine"
}

// String renders "NOM Prénom".
func (np NomPrenom) String() string {
	return strings.TrimSpace(np.Nom + " " + np.Prenom)
}

// ParseStatus is the outcome of ParseNomPrenom.
type ParseStatus int

const (
	// NomPrenomOK: NOM and Prénom identified.
	NomPrenomOK ParseStatus = iota
	// NomPrenomAmbigu: only upper-case words ("ROBERT MICHEL") and the resource
	// code does not tell which one is the family name.
	NomPrenomAmbigu
	// NomPrenomNonIdentifiable: empty, a single word ("PO") or a code.
	NomPrenomNonIdentifiable
)

// ParseNomPrenom extracts NOM and Prénom from the person part of a plan Libellé
// (output of SplitLibelle). Upper-case words are the family name; without any,
// the SPEC order <Prénom NOM> applies; with only upper-case words, the resource
// code (convention NOM + initiale du prénom) decides the order.
//
//	"DURAND Claire"        → DURAND Claire
//	"Karim PETIT"          → PETIT Karim
//	"Antoine De La Tour"   → DE LA TOUR Antoine
//	"ROBERT MICHEL", ROBERTM → ROBERT Michel ; sans code concordant → ambigu
//	"PO", ""               → non identifiable
func ParseNomPrenom(person, ressource string) (NomPrenom, ParseStatus) {
	toks := []string{}
	for _, t := range strings.Fields(stripParens(person)) {
		if civilites[strings.ToUpper(strings.Trim(xlsxutil.StripAccents(t), "."))] {
			continue
		}
		toks = append(toks, t)
	}
	if len(toks) < 2 {
		return NomPrenom{}, NomPrenomNonIdentifiable
	}
	for _, t := range toks {
		if !isNameWord(t) {
			return NomPrenom{}, NomPrenomNonIdentifiable
		}
	}

	var upper, other []string
	for _, t := range toks {
		if isUpperWord(t) {
			upper = append(upper, t)
		} else {
			other = append(other, t)
		}
	}
	switch {
	case len(upper) > 0 && len(other) > 0:
		return build(upper, other), NomPrenomOK
	case len(upper) == 0:
		// Convention SPEC <Prénom NOM> : premier mot = prénom.
		return build(toks[1:], toks[:1]), NomPrenomOK
	}
	// Tout en majuscules : l'ordre est tranché par le code ressource.
	nomFirst := build(toks[:len(toks)-1], toks[len(toks)-1:])
	prenomFirst := build(toks[1:], toks[:1])
	code := strings.ToUpper(strings.TrimSpace(ressource))
	okNomFirst := code != "" && ExpectedRessource(nomFirst) == code
	okPrenomFirst := code != "" && ExpectedRessource(prenomFirst) == code
	switch {
	case okNomFirst:
		return nomFirst, NomPrenomOK
	case okPrenomFirst:
		return prenomFirst, NomPrenomOK
	}
	return NomPrenom{}, NomPrenomAmbigu
}

// ExpectedRessource returns the resource code expected by the convention
// NOM + initiale du prénom: DE LA TOUR Antoine → DELATOURA, D'ARC Jeanne → DARCJ.
func ExpectedRessource(np NomPrenom) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(xlsxutil.StripAccents(np.Nom)) {
		if unicode.IsLetter(r) {
			b.WriteRune(r)
		}
	}
	for _, r := range strings.ToUpper(xlsxutil.StripAccents(np.Prenom)) {
		if unicode.IsLetter(r) {
			b.WriteRune(r)
			break
		}
	}
	return b.String()
}

func build(nom, prenom []string) NomPrenom {
	return NomPrenom{Nom: strings.ToUpper(strings.Join(nom, " ")), Prenom: formatPrenom(strings.Join(prenom, " "))}
}

// formatPrenom capitalises a first name written all upper or all lower case
// ("MICHEL" → "Michel", "jean-pierre" → "Jean-Pierre"); mixed case is kept.
func formatPrenom(s string) string {
	if s != strings.ToUpper(s) && s != strings.ToLower(s) {
		return s
	}
	var b strings.Builder
	start := true
	for _, r := range strings.ToLower(s) {
		if start && unicode.IsLetter(r) {
			r = unicode.ToUpper(r)
		}
		start = r == ' ' || r == '-' || r == '\''
		b.WriteRune(r)
	}
	return b.String()
}

// isNameWord: letters, hyphens, apostrophes and dots only (no digits, no "_").
func isNameWord(t string) bool {
	letters := 0
	for _, r := range t {
		switch {
		case unicode.IsLetter(r):
			letters++
		case r == '-' || r == '\'' || r == '’' || r == '.':
		default:
			return false
		}
	}
	return letters > 0
}

// isUpperWord: at least two letters, all upper case ("DURAND", "D'ARC").
func isUpperWord(t string) bool {
	letters := 0
	for _, r := range t {
		if unicode.IsLetter(r) {
			if !unicode.IsUpper(r) {
				return false
			}
			letters++
		}
	}
	return letters >= 2
}
