package analyse

import (
	"strings"
	"testing"

	"njord/internal/domain"
)

// DECISIONS n° 26 : un tuple disparaît quand il a au moins une clé et que toutes
// ses anomalies sont traitee ou ignoree.
func TestHideTraites(t *testing.T) {
	row := func(id string, keys ...string) domain.EcartRow {
		if keys == nil {
			keys = []string{}
		}
		return domain.EcartRow{Ressource: id, Anomalies: keys}
	}
	an := func(key string, s domain.AnomalieStatut) domain.Anomalie { return domain.Anomalie{Key: key, Statut: s} }
	anomalies := []domain.Anomalie{
		an("t", domain.AnomalieTraitee),
		an("i", domain.AnomalieIgnoree),
		an("a", domain.AnomalieATraiter),
	}
	rows := []domain.EcartRow{
		row("conforme"),           // aucune clé : jamais masqué
		row("traitee", "t"),       // masqué
		row("ignoree", "i"),       // masqué
		row("mixte_ti", "i", "t"), // toutes traitées / ignorées : masqué
		row("a_traiter", "a"),
		row("partiel", "a", "t"), // une clé encore à traiter : visible
		row("inconnue", "x"),     // clé absente : à traiter, visible
		{Ressource: "nil"},       // Anomalies nil : visible
	}
	got := HideTraites(rows, anomalies)
	var ids []string
	for _, r := range got {
		ids = append(ids, r.Ressource)
	}
	if strings.Join(ids, ",") != "conforme,a_traiter,partiel,inconnue,nil" {
		t.Errorf("visibles : %v", ids)
	}
	// Ordre préservé, entrée intacte, jamais null.
	if len(rows) != 8 || rows[1].Ressource != "traitee" {
		t.Error("entrée modifiée")
	}
	if out := HideTraites(nil, nil); out == nil || len(out) != 0 {
		t.Errorf("vide : %#v", out)
	}
	// Sans anomalie traitée : tout reste.
	if out := HideTraites(rows, nil); len(out) != len(rows) {
		t.Errorf("sans suivi : %d / %d", len(out), len(rows))
	}
}
