package names

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"DE LA TOUR Antoine Mr.": "ANTOINE DE LA TOUR",
		"Antoine De La Tour":     "ANTOINE DE LA TOUR",
		"DURAND Claire Mme":      "CLAIRE DURAND",
		"LE GALL Francois M.":    "FRANCOIS GALL LE",
		"François Le Gall":       "FRANCOIS GALL LE",
		"GUERIN Thomas (support)": "GUERIN THOMAS",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

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
	if PersonKey("DURAND Claire / Squad Alpha") != Normalize("DURAND Claire Mme") {
		t.Error("PersonKey mismatch")
	}
}

func TestParseNomPrenom(t *testing.T) {
	cases := []struct {
		person, ressource string
		want              string
		st                ParseStatus
		code              string
	}{
		{"DURAND Claire", "DURANDC", "DURAND Claire", NomPrenomOK, "DURANDC"},
		{"Karim PETIT", "PETITK", "PETIT Karim", NomPrenomOK, "PETITK"},
		{"Emma FONTAINE", "FONTAINEE", "FONTAINE Emma", NomPrenomOK, "FONTAINEE"},
		{"Sarah Blanc", "BLANCS", "BLANC Sarah", NomPrenomOK, "BLANCS"},
		{"Antoine De La Tour", "DELATOURA", "DE LA TOUR Antoine", NomPrenomOK, "DELATOURA"},
		{"GIRAUD Léa", "GIRAUDL", "GIRAUD Léa", NomPrenomOK, "GIRAUDL"},
		{"LEMOINE Inès", "", "LEMOINE Inès", NomPrenomOK, "LEMOINEI"},
		{"D'ARC jeanne", "", "D'ARC Jeanne", NomPrenomOK, "DARCJ"},
		{"MARTIN Jean-Pierre", "", "MARTIN Jean-Pierre", NomPrenomOK, "MARTINJ"},
		{"GUERIN Thomas Mr.", "", "GUERIN Thomas", NomPrenomOK, "GUERINT"},
		{"ROBERT MICHEL", "ROBERTM", "ROBERT Michel", NomPrenomOK, "ROBERTM"},
		{"MICHEL ROBERT", "ROBERTM", "ROBERT Michel", NomPrenomOK, "ROBERTM"},
		{"ROBERT MICHEL", "R_001", "", NomPrenomAmbigu, ""},
		{"PO", "RESERVEP", "", NomPrenomNonIdentifiable, ""},
		{"", "LEROYN", "", NomPrenomNonIdentifiable, ""},
		{"2GI_DEMO SiteNord", "", "", NomPrenomNonIdentifiable, ""},
	}
	for _, c := range cases {
		np, st := ParseNomPrenom(c.person, c.ressource)
		if st != c.st || np.String() != c.want {
			t.Errorf("ParseNomPrenom(%q, %q) = %q/%d, want %q/%d", c.person, c.ressource, np.String(), st, c.want, c.st)
			continue
		}
		if st == NomPrenomOK {
			if got := ExpectedRessource(np); got != c.code {
				t.Errorf("ExpectedRessource(%q) = %q, want %q", np.String(), got, c.code)
			}
		}
	}
}
