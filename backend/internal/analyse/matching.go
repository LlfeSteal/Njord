package analyse

import (
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/names"
)

// Resource keys (identity of a « ressource » in the join):
//
//	"P:<personne_id>"  personne du référentiel
//	"R:<code>"         ligne de plan sans personne_id (code ressource PDC)
//	"L:<libellé>"      ligne de plan sans personne ni code
//	"N:<nom normalisé>" écriture réalisée non appariée
//	"M:<matricule>"    écriture non appariée sans nom, avec matricule
//	"X:"               écriture MO sans nom ni matricule
func personKey(id string) string { return "P:" + id }

func planLineKey(l *domain.PlanLine) string {
	switch {
	case l.PersonneID != nil && *l.PersonneID != "":
		return personKey(*l.PersonneID)
	case strings.TrimSpace(l.Ressource) != "":
		return "R:" + strings.TrimSpace(l.Ressource)
	default:
		return "L:" + strings.TrimSpace(l.Libelle)
	}
}

// identity is the result of the §5.1 resolution of a réalisé entry.
type identity struct {
	Key        string
	PersonneID *string
	Confidence domain.Confidence
}

func (id identity) matched() bool { return id.Confidence != domain.ConfNone }

// matcher implements SPEC_analyse §5.1 as refined by DECISIONS « Correspondance ».
type matcher struct {
	byMatricule map[string]string   // matricule (canon) → key
	strong      map[string][]string // alias manuel/confirmé normalisé → keys
	weak        map[string][]string // alias import / nom personne / PersonKey(libellé) → keys
	planned     map[string]bool     // keys present in the plan
	cache       map[string]identity
}

func addKey(m map[string][]string, norm, key string) {
	if norm == "" {
		return
	}
	for _, k := range m[norm] {
		if k == key {
			return
		}
	}
	m[norm] = append(m[norm], key)
}

func newMatcher(personnes []domain.Personne, lines []domain.PlanLine) *matcher {
	m := &matcher{
		byMatricule: map[string]string{},
		strong:      map[string][]string{},
		weak:        map[string][]string{},
		planned:     map[string]bool{},
		cache:       map[string]identity{},
	}
	for i := range lines {
		m.planned[planLineKey(&lines[i])] = true
	}
	for _, p := range personnes {
		k := personKey(p.ID)
		for _, mat := range p.Matricules {
			if c := canon(mat); c != "" {
				m.byMatricule[c] = k
			}
		}
		for _, a := range p.Alias {
			norm := names.Normalize(a.Alias)
			if norm == "" {
				norm = a.AliasNormalise
			}
			switch a.Source {
			case domain.AliasManuel, domain.AliasConfirme:
				addKey(m.strong, norm, k)
			default:
				addKey(m.weak, norm, k)
			}
		}
		addKey(m.weak, names.Normalize(p.DisplayName), k)
		if p.NomNormalise != "" {
			addKey(m.weak, names.Normalize(p.NomNormalise), k)
		}
	}
	for i := range lines {
		addKey(m.weak, names.PersonKey(lines[i].Libelle), planLineKey(&lines[i]))
	}
	return m
}

// pick returns the single candidate, preferring keys planned in the plan when
// several persons share the same normalised name; "" if ambiguous.
func (m *matcher) pick(keys []string) string {
	if len(keys) == 1 {
		return keys[0]
	}
	var planned []string
	for _, k := range keys {
		if m.planned[k] {
			planned = append(planned, k)
		}
	}
	if len(planned) == 1 {
		return planned[0]
	}
	return ""
}

func identityOf(key string, conf domain.Confidence) identity {
	id := identity{Key: key, Confidence: conf}
	if strings.HasPrefix(key, "P:") {
		pid := key[2:]
		id.PersonneID = &pid
	}
	return id
}

// resolve applies the ordered strategies: matricule → alias (manuel/confirmé)
// → fuzzy (alias import, nom normalisé, libellé du plan) → none.
func (m *matcher) resolve(matricule, nom string) identity {
	mat := canon(matricule)
	norm := names.Normalize(nom)
	ck := mat + "\x00" + norm
	if id, ok := m.cache[ck]; ok {
		return id
	}
	var id identity
	if k, ok := m.byMatricule[mat]; ok && mat != "" {
		id = identityOf(k, domain.ConfMatricule)
	} else if k := m.pick(m.strong[norm]); norm != "" && k != "" {
		id = identityOf(k, domain.ConfAlias)
	} else if k := m.pick(m.weak[norm]); norm != "" && k != "" {
		id = identityOf(k, domain.ConfFuzzy)
	} else {
		switch {
		case norm != "":
			id = identity{Key: "N:" + norm, Confidence: domain.ConfNone}
		case mat != "":
			id = identity{Key: "M:" + mat, Confidence: domain.ConfNone}
		default:
			id = identity{Key: "X:", Confidence: domain.ConfNone}
		}
	}
	m.cache[ck] = id
	return id
}

// confRank: lower = weaker evidence (used to keep the weakest confidence of a tuple).
var confRank = map[domain.Confidence]int{
	domain.ConfNone: 0, domain.ConfFuzzy: 1, domain.ConfAlias: 2, domain.ConfMatricule: 3, domain.ConfPlan: 4,
}

func weakest(a, b domain.Confidence) domain.Confidence {
	if a == "" {
		return b
	}
	if confRank[b] < confRank[a] {
		return b
	}
	return a
}

// entryName returns the réalisé name used for matching.
func entryName(e *domain.RealiseEntry) string {
	if n := strings.TrimSpace(e.EmployeFournisseur); n != "" {
		return n
	}
	return strings.TrimSpace(e.NomRessource)
}

func sortCorrespondances(cs []domain.Correspondance) {
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if confRank[a.Confidence] != confRank[b.Confidence] {
			return confRank[a.Confidence] < confRank[b.Confidence]
		}
		if a.NomNormalise != b.NomNormalise {
			return a.NomNormalise < b.NomNormalise
		}
		return a.NomRealise < b.NomRealise
	})
}
