package analyse

import "njord/internal/domain"

// HideTraites drops the rows whose anomalies (EcartRow.Anomalies, at least one)
// are all traitee or ignoree (DECISIONS n° 26).
// CONTRAT (phase 0) : corps à écrire par l'agent écarts.
func HideTraites(rows []domain.EcartRow, anomalies []domain.Anomalie) []domain.EcartRow {
	return rows
}
