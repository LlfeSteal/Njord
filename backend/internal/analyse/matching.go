package analyse

import (
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/names"
)

// Resource keys (identity of a « ressource » in the join, DECISIONS n° 8 :
// NOM + Prénom uniquement, égalité stricte de names.Key) :
//
//	"N:<names.Key>"  ligne de plan nominative ou écriture au NOM Prénom lisible
//	"L:<libellé>"    ligne de plan non nominative (jamais rapprochée du réalisé)
//	"U:<nom brut>"   écriture MO dont le nom est illisible (hors plan)
//	"X:"             écriture MO sans nom (hors plan)
//
// Seules les clés "N:" peuvent être communes au plan et au réalisé.
func nameKey(nomPrenom string) string {
	if k := names.KeyOf(nomPrenom); k != "" {
		return "N:" + k
	}
	return ""
}

// noLibelle labels a non-nominative plan line without libellé.
const noLibelle = "(sans libellé)"

// noName labels a réalisé MO entry without any name.
const noName = "(sans nom)"

func planLineKey(l *domain.PlanLine) string {
	if k := nameKey(l.NomPrenom); k != "" {
		return k
	}
	return "L:" + strings.TrimSpace(l.Libelle)
}

// planLineLabel is the « ressource » of a plan line: its « NOM Prénom », or its
// libellé when the line is non nominative.
func planLineLabel(l *domain.PlanLine) string {
	if nameKey(l.NomPrenom) != "" {
		return strings.TrimSpace(l.NomPrenom)
	}
	if lib := strings.TrimSpace(l.Libelle); lib != "" {
		return lib
	}
	return noLibelle
}

// identity is the resolution of a réalisé MO entry.
type identity struct {
	Key        string
	PersonneID *string // fiche personne de même clé, même hors plan
	Confidence domain.Confidence
}

// matched: the entry is attached to the plan (ConfNom).
func (id identity) matched() bool { return id.Confidence == domain.ConfNom }

// matcher resolves réalisé entries against the plan by exact NOM + Prénom key.
type matcher struct {
	planned map[string]bool             // keys present in the plan
	byKey   map[string]*domain.Personne // names.Key → personne
}

// personneKey: names.Key of a personne (nom_normalise, else recomputed from the display name).
func personneKey(p *domain.Personne) string {
	if k := strings.TrimSpace(p.NomNormalise); k != "" {
		return k
	}
	return names.KeyOf(p.DisplayName)
}

func newMatcher(personnes []domain.Personne, lines []domain.PlanLine) *matcher {
	m := &matcher{planned: map[string]bool{}, byKey: map[string]*domain.Personne{}}
	for i := range lines {
		m.planned[planLineKey(&lines[i])] = true
	}
	for i := range personnes {
		if k := personneKey(&personnes[i]); k != "" {
			if _, dup := m.byKey[k]; !dup {
				m.byKey[k] = &personnes[i]
			}
		}
	}
	return m
}

// personne returns the personne of a "N:" resource key (nil otherwise).
func (m *matcher) personne(key string) *domain.Personne {
	if k, ok := strings.CutPrefix(key, "N:"); ok {
		return m.byKey[k]
	}
	return nil
}

// resolve: the entry's NOM Prénom key is matched (ConfNom) iff it is present
// in the plan; otherwise ConfNone (hors plan). PersonneID is set whenever a
// personne record has the same key, even if not planned.
func (m *matcher) resolve(nomPrenom, raw string) identity {
	var id identity
	switch k := nameKey(nomPrenom); {
	case k != "":
		id.Key = k
	case strings.TrimSpace(raw) != "":
		id.Key = "U:" + canon(raw)
	default:
		id.Key = "X:"
	}
	id.Confidence = domain.ConfNone
	if m.planned[id.Key] && strings.HasPrefix(id.Key, "N:") {
		id.Confidence = domain.ConfNom
	}
	if p := m.personne(id.Key); p != nil {
		pid := p.ID
		id.PersonneID = &pid
	}
	return id
}

// entryName returns the raw réalisé name (EMPLOYE/FOURNISSEUR, else NOM RESSOURCE).
func entryName(e *domain.RealiseEntry) string {
	if n := strings.TrimSpace(e.EmployeFournisseur); n != "" {
		return n
	}
	return strings.TrimSpace(e.NomRessource)
}

// sortCorrespondances: hors plan (none) first, then by NOM Prénom and raw name.
func sortCorrespondances(cs []domain.Correspondance) {
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if an, bn := a.Confidence == domain.ConfNone, b.Confidence == domain.ConfNone; an != bn {
			return an
		}
		if a.NomPrenom != b.NomPrenom {
			return a.NomPrenom < b.NomPrenom
		}
		return a.NomRealise < b.NomRealise
	})
}
