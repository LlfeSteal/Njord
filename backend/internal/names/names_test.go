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
