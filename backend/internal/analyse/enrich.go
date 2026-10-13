package analyse

import (
	"strings"

	"njord/internal/domain"
	"njord/internal/xlsxutil"
)

// categorieMO is the CATEGORIE that, with TYPE ∈ mo_types, makes an entry an
// hour-based MO entry (DECISIONS « Heures MO »).
const categorieMO = "MAIN D'OEUVRE"

// provisionType is the TYPE of provision entries (dérive de provision) and the
// ligne de coût of the non-secured provisions (aléas, DECISIONS n° 23).
const provisionType = "PROVISIONS POUR ALEAS"

// isAleas: ligne de coût d'une provision non sécurisée (DECISIONS n° 23),
// insensible à la casse, aux espaces et aux accents (« ALÉAS »).
func isAleas(ligneCout string) bool {
	return canon(xlsxutil.StripAccents(ligneCout)) == provisionType
}

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

// Enrichment holds the derived columns of SPEC_analyse §3 (la classification
// du réalisé par TYPE, §3.3, est supprimée par DECISIONS n° 23 : la
// classification est prévisionnelle, cf. budget).
type Enrichment struct {
	MO      bool    `json:"mo"`
	Heures  float64 `json:"heures"`
	Eur     float64 `json:"eur"`
	ISOWeek string  `json:"iso_week"`
}

// Enricher applies §3 with the reference lists of the settings.
type Enricher struct {
	mo map[string]bool
}

// IsMOLine: une ligne de plan n'entre dans la comparaison des heures que si sa
// ligne de coût est un type MO (DECISIONS) — frais, provisions, stockage exclus.
func (en Enricher) IsMOLine(l *domain.PlanLine) bool { return en.mo[canon(l.LigneCout)] }

func NewEnricher(s domain.Settings) Enricher {
	return Enricher{mo: canonSet(s.MOTypes)}
}

// Enrich computes heures/€ (§3.1 + DECISIONS) and iso_week (§3.2) of an entry.
func (en Enricher) Enrich(e *domain.RealiseEntry) Enrichment {
	out := Enrichment{ISOWeek: WeekOfDate(e.DateDepense)}
	out.MO = en.mo[canon(e.Type)] && canon(e.Categorie) == categorieMO
	if out.MO {
		out.Heures = e.Quantite
	} else {
		out.Eur = e.TotalEur
	}
	return out
}
