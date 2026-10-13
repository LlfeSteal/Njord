package analyse

import "njord/internal/domain"

// HideTraites drops the rows whose anomalies (EcartRow.Anomalies, at least one)
// are all traitee or ignoree (DECISIONS n° 26). Les statuts sont ceux de
// anomalies après mergeSuivi : une anomalie rouverte (empreinte changée) est
// a_traiter et fait revenir ses tuples. Une clé absente de anomalies compte
// comme à traiter (le tuple reste). Les tuples sans clé (conformes, inactifs
// exclus) ne sont jamais masqués.
func HideTraites(rows []domain.EcartRow, anomalies []domain.Anomalie) []domain.EcartRow {
	traitee := make(map[string]bool, len(anomalies))
	for _, a := range anomalies {
		traitee[a.Key] = a.Statut == domain.AnomalieTraitee || a.Statut == domain.AnomalieIgnoree
	}
	out := make([]domain.EcartRow, 0, len(rows))
	for _, r := range rows {
		if !toutesTraitees(r.Anomalies, traitee) {
			out = append(out, r)
		}
	}
	return out
}

// toutesTraitees: au moins une clé et toutes traitee / ignoree.
func toutesTraitees(keys []string, traitee map[string]bool) bool {
	if len(keys) == 0 {
		return false
	}
	for _, k := range keys {
		if !traitee[k] {
			return false
		}
	}
	return true
}
