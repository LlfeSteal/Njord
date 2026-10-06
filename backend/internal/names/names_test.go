package names

import "testing"

func TestSplitLibelle(t *testing.T) {
	cases := []struct{ in, person, squad string }{
		{"DURAND Claire / Squad Alpha", "DURAND Claire", "Squad Alpha"},
		{"Cellule Qualité / BONNET Hugo", "BONNET Hugo", "Cellule Qualité"},
		{"GUERIN Thomas (support)", "GUERIN Thomas", ""},
		{"MARTIN Théo / Direction Technique", "MARTIN Théo", "Direction Technique"},
		{"Karim PETIT", "Karim PETIT", ""},
		{"", "", ""},
	}
	for _, c := range cases {
		p, s := SplitLibelle(c.in, nil)
		if p != c.person || s != c.squad {
			t.Errorf("SplitLibelle(%q) = (%q,%q), want (%q,%q)", c.in, p, s, c.person, c.squad)
		}
	}
}

func TestParseNomPrenom(t *testing.T) {
	cases := []struct {
		person, want string
		st           ParseStatus
	}{
		{"DURAND Claire", "DURAND Claire", NomPrenomOK},
		{"Karim PETIT", "PETIT Karim", NomPrenomOK},
		{"Emma FONTAINE", "FONTAINE Emma", NomPrenomOK},
		{"Sarah Blanc", "BLANC Sarah", NomPrenomOK},
		{"Antoine De La Tour", "DE LA TOUR Antoine", NomPrenomOK},
		{"GIRAUD Léa", "GIRAUD Léa", NomPrenomOK},
		{"D'ARC jeanne", "D'ARC Jeanne", NomPrenomOK},
		{"MARTIN Jean-Pierre", "MARTIN Jean-Pierre", NomPrenomOK},
		{"ROBERT MICHEL", "ROBERT Michel", NomPrenomOK},
		{"MICHEL ROBERT", "MICHEL Robert", NomPrenomOK},
		{"PO", "", NomPrenomNonIdentifiable},
		{"", "", NomPrenomNonIdentifiable},
		{"2GI_DEMO SiteNord", "", NomPrenomNonIdentifiable},
	}
	for _, c := range cases {
		np, st := ParseNomPrenom(c.person)
		if st != c.st || np.String() != c.want {
			t.Errorf("ParseNomPrenom(%q) = %q/%d, want %q/%d", c.person, np.String(), st, c.want, c.st)
		}
	}
}

func TestParseRealise(t *testing.T) {
	cases := map[string]string{
		"DURAND Claire Mme":      "DURAND Claire",
		"DURAND Claire Mme.":     "DURAND Claire",
		"DE LA TOUR Antoine Mr.": "DE LA TOUR Antoine",
		"LE GALL François M.":    "LE GALL François",
		"BONNET Hugo M":          "BONNET Hugo",
		"GIRAUD Léa Mlle.":       "GIRAUD Léa",
		"PETIT Karim":            "PETIT Karim",
		"ROBERT MICHEL MR":       "ROBERT Michel",
		"Mme":                    "",
		"":                       "",
	}
	for in, want := range cases {
		np, ok := ParseRealise(in)
		if np.String() != want || ok != (want != "") {
			t.Errorf("ParseRealise(%q) = %q/%v, want %q", in, np.String(), ok, want)
		}
	}
}

func TestKey(t *testing.T) {
	plan, _ := ParseNomPrenom("Antoine De La Tour")
	real, _ := ParseRealise("DE LA TOUR Antoine Mr.")
	if Key(plan) != "DE LA TOUR|ANTOINE" || Key(plan) != Key(real) {
		t.Errorf("Key: plan %q, réalisé %q", Key(plan), Key(real))
	}
	accents, _ := ParseRealise("LEMOINE Inès Mme")
	if got := Key(accents); got != "LEMOINE|INES" {
		t.Errorf("Key(LEMOINE Inès) = %q", got)
	}
	// Ordre conservé : prénom et nom inversés ne correspondent pas.
	swapped, _ := ParseRealise("CLAIRE DURAND Mme")
	if Key(swapped) == KeyOf("DURAND Claire") {
		t.Error("swapped NOM/Prénom must not match")
	}
	for _, s := range []string{"DURAND Claire", "DE LA TOUR Antoine", "D'ARC Jeanne", "MARTIN Jean-Pierre"} {
		np, _ := ParseNomPrenom(s)
		if KeyOf(np.String()) != Key(np) {
			t.Errorf("KeyOf(%q) does not round-trip", s)
		}
	}
	if KeyOf("PO") != "" || Key(NomPrenom{}) != "" {
		t.Error("empty key expected")
	}
}
