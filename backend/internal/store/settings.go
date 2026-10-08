package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"njord/internal/domain"
)

// DefaultSettings returns the business defaults of SPEC_analyse / SPEC_*.
func DefaultSettings() domain.Settings {
	feries := []string{}
	for y := 2024; y <= 2030; y++ {
		feries = append(feries, FrenchHolidays(y)...)
	}
	return domain.Settings{
		SeuilSurImputationH:   15,
		SeuilSousImputationH:  30,
		SeuilCTRisqueEur:      10000,
		SeuilNonSecurisePct:   15,
		PurgeDelaiJours:       30,
		SeuilQuantiteSemaineH: 200,
		SeuilEcartTGEur:       50000,
		SeuilSousConsoPct:     10,
		SeuilSousConsoEur:     5000,
		DiviseurHorsPlanH:     12,
		SemainesVerrouillees:  []int{51, 52},
		JoursFeries:           feries,
		MOTypes:               []string{"MAIN D'OEUVRE SUR SITE", "CAPACITE SUR SITE"},
		Securise:              []string{"MAIN D'OEUVRE SUR SITE", "CAPACITE SUR SITE", "FRAIS ACHATS CAPACITE SUR SITE", "FRAIS DE MISSION"},
		NonSecurise:           []string{"PROVISIONS POUR ALEAS", "Stockage"},
	}
}

// GetSettings returns the stored settings merged over the defaults.
func (s *Store) GetSettings(ctx context.Context) (domain.Settings, error) {
	st := DefaultSettings()
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT json FROM settings WHERE id = 1`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return DefaultSettings(), nil
	}
	return st, nil
}

// PutSettings replaces the settings and journals the change.
func (s *Store) PutSettings(ctx context.Context, st domain.Settings, operateur string) (domain.Settings, error) {
	if st.PurgeDelaiJours < 0 || st.DiviseurHorsPlanH <= 0 {
		return st, Precondition("paramètres invalides : délai de purge ≥ 0 et diviseur hors plan > 0 requis")
	}
	if st.FinExercice != "" {
		if _, err := time.Parse("2006-01-02", st.FinExercice); err != nil {
			return st, Precondition("paramètres invalides : fin d'exercice attendue au format AAAA-MM-JJ (ou vide)")
		}
	}
	if st.SeuilSousConsoPct < 0 || st.SeuilSousConsoPct > 100 || st.SeuilSousConsoEur < 0 {
		return st, Precondition("paramètres invalides : seuil de sous-consommation entre 0 et 100 %% et montant ≥ 0 requis")
	}
	raw, err := json.Marshal(st)
	if err != nil {
		return st, err
	}
	err = s.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings(id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`, string(raw)); err != nil {
			return err
		}
		return s.Audit(ctx, tx, operateur, "update", "settings", "", "")
	})
	if err != nil {
		return st, err
	}
	return s.GetSettings(ctx)
}

// FrenchHolidays returns the 11 French public holidays of year (YYYY-MM-DD).
func FrenchHolidays(year int) []string {
	easter := easterSunday(year)
	d := func(m time.Month, day int) time.Time { return time.Date(year, m, day, 0, 0, 0, 0, time.UTC) }
	days := []time.Time{
		d(time.January, 1),
		easter.AddDate(0, 0, 1), // lundi de Pâques
		d(time.May, 1),
		d(time.May, 8),
		easter.AddDate(0, 0, 39), // Ascension
		easter.AddDate(0, 0, 50), // lundi de Pentecôte
		d(time.July, 14),
		d(time.August, 15),
		d(time.November, 1),
		d(time.November, 11),
		d(time.December, 25),
	}
	out := make([]string, len(days))
	for i, t := range days {
		out[i] = t.Format("2006-01-02")
	}
	return out
}

// easterSunday: anonymous Gregorian algorithm.
func easterSunday(y int) time.Time {
	a := y % 19
	b, c := y/100, y%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return time.Date(y, time.Month(month), day, 0, 0, 0, 0, time.UTC)
}
