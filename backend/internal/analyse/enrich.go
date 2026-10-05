package analyse

import (
	"strings"

	"njord/internal/domain"
)

// categorieMO is the CATEGORIE that, with TYPE ∈ mo_types, makes an entry an
// hour-based MO entry (DECISIONS « Heures MO »).
const categorieMO = "MAIN D'OEUVRE"

// provisionType is the TYPE of provision entries (dérive de provision).
const provisionType = "PROVISIONS POUR ALEAS"

// canon: comparaison « majuscules + trim » (apostrophe typographique et
// espaces multiples neutralisés).
func canon(s string) string {
	s = strings.ReplaceAll(s, "’", "'")
	return strings.ToUpper(strings.Join(strings.Fields(s), " "))
}

func canonSet(list []string) map[string]bool {
	m := make(map[string]bool, len(list))
	for _, v := range list {
		m[canon(v)] = true
	}
	return m
}

// Enrichment holds the derived columns of SPEC_analyse §3.
type Enrichment struct {
	MO             bool                  `json:"mo"`
	Heures         float64               `json:"heures"`
	Eur            float64               `json:"eur"`
	ISOWeek        string                `json:"iso_week"`
	Classification domain.Classification `json:"classification"`
}

// Enricher applies §3 with the reference lists of the settings.
type Enricher struct {
	mo, sec, nonSec map[string]bool
}

// IsMOLine: une ligne de plan n'entre dans la comparaison des heures que si sa
// ligne de coût est un type MO (DECISIONS) — frais, provisions, stockage exclus.
func (en Enricher) IsMOLine(l *domain.PlanLine) bool { return en.mo[canon(l.LigneCout)] }

func NewEnricher(s domain.Settings) Enricher {
	return Enricher{mo: canonSet(s.MOTypes), sec: canonSet(s.Securise), nonSec: canonSet(s.NonSecurise)}
}

// Enrich computes heures/€ (§3.1 + DECISIONS), iso_week (§3.2) and the
// budget classification (§3.3) of an entry.
func (en Enricher) Enrich(e *domain.RealiseEntry) Enrichment {
	t := canon(e.Type)
	out := Enrichment{ISOWeek: WeekOfDate(e.DateDepense)}
	out.MO = en.mo[t] && canon(e.Categorie) == categorieMO
	if out.MO {
		out.Heures = e.Quantite
	} else {
		out.Eur = e.TotalEur
	}
	switch {
	case en.sec[t]:
		out.Classification = domain.ClassSecurise
	case en.nonSec[t]:
		out.Classification = domain.ClassNonSecurise
	default:
		out.Classification = domain.ClassNonClasse
	}
	return out
}
