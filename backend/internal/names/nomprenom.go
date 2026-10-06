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
	// NomPrenomNonIdentifiable: empty, a single word ("PO") or a code.
	NomPrenomNonIdentifiable
)

// ParseNomPrenom extracts NOM and Prénom from the person part of a plan Libellé
// (output of SplitLibelle). Upper-case words are the family name; without any,
// the SPEC order <Prénom NOM> applies; with only upper-case words, the order is
// <NOM Prénom> (last word = first name).
//
//	"DURAND Claire"        → DURAND Claire
//	"Karim PETIT"          → PETIT Karim
//	"Antoine De La Tour"   → DE LA TOUR Antoine
//	"ROBERT MICHEL"        → ROBERT Michel
//	"PO", ""               → non identifiable
func ParseNomPrenom(person string) (NomPrenom, ParseStatus) {
	toks := []string{}
	for _, t := range strings.Fields(stripParens(person)) {
		if isCivilite(t) {
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
	// Tout en majuscules : <NOM Prénom>, dernier mot = prénom.
	return build(toks[:len(toks)-1], toks[len(toks)-1:]), NomPrenomOK
}

// ParseRealise extracts NOM and Prénom from a réalisé EMPLOYE/FOURNISSEUR value
// <NOM Prénom Civilité>: the trailing civilities (M., Mr., Mme., Mlle.…) are
// removed first. ok is false when no NOM Prénom can be identified.
//
//	"DURAND Claire Mme"       → DURAND Claire
//	"DE LA TOUR Antoine Mr."  → DE LA TOUR Antoine
func ParseRealise(s string) (np NomPrenom, ok bool) {
	toks := strings.Fields(stripParens(s))
	for len(toks) > 0 && isCivilite(toks[len(toks)-1]) {
		toks = toks[:len(toks)-1]
	}
	np, st := ParseNomPrenom(strings.Join(toks, " "))
	return np, st == NomPrenomOK
}

// Key is the identity of a person (the only one, DECISIONS n° 8): NOM and
// Prénom in upper case, without accents nor punctuation, order kept.
// DE LA TOUR Antoine → "DE LA TOUR|ANTOINE". "" when NOM or Prénom is empty.
func Key(np NomPrenom) string {
	nom, prenom := strings.Join(tokens(np.Nom), " "), strings.Join(tokens(np.Prenom), " ")
	if nom == "" || prenom == "" {
		return ""
	}
	return nom + "|" + prenom
}

// KeyOf returns the Key of a « NOM Prénom » string (NomPrenom.String() form,
// as stored in plan_lines.nom_prenom / realise_entries.nom_prenom); "" if none.
func KeyOf(nomPrenom string) string {
	np, st := ParseNomPrenom(nomPrenom)
	if st != NomPrenomOK {
		return ""
	}
	return Key(np)
}

// isCivilite: "M", "M.", "Mr.", "Mme", "Mlle."… (case and accents ignored).
func isCivilite(t string) bool {
	return civilites[strings.ToUpper(strings.Trim(xlsxutil.StripAccents(t), "."))]
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
