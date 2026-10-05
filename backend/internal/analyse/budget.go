package analyse

import (
	"sort"
	"strings"

	"njord/internal/domain"
)

func sortStrings(s []string) { sort.Strings(s) }

func pct(num, den float64) *float64 {
	if den == 0 {
		return nil
	}
	v := round2(num / den * 100)
	return &v
}

// budget computes §7.4 (per CT + global) and the alerts of §7.5 on every
// entry of the réalisé version (avoirs included), independently of the week
// period which only scopes the hours comparison.
func (r *run) budget() (domain.Budget, domain.Alertes) {
	byCT := map[string]*domain.BudgetCT{}
	get := func(ct string) *domain.BudgetCT {
		b := byCT[ct]
		if b == nil {
			b = &domain.BudgetCT{CT: ct, CTLibelle: r.ctLibelle[ct]}
			byCT[ct] = b
		}
		return b
	}
	provCT := map[string]bool{}
	for i := range r.lines {
		l := &r.lines[i]
		ct := strings.TrimSpace(l.CT)
		if ct == "" {
			continue
		}
		get(ct).PPSPlan += l.PPS
		if canon(l.LigneCout) == provisionType {
			provCT[ct] = true
		}
	}

	al := domain.Alertes{CTRisque: []domain.AlerteCT{}, DeriveProvision: []domain.DeriveProvision{}}
	var g domain.BudgetGlobal
	for i := range r.entries {
		e := &r.entries[i]
		ct := strings.TrimSpace(e.TG)
		if ct == "" {
			continue
		}
		en := r.enr[i]
		b := get(ct)
		switch en.Classification {
		case domain.ClassSecurise:
			b.Securise += en.Eur
		case domain.ClassNonSecurise:
			b.NonSecurise += en.Eur
		default:
			b.NonClasse += en.Eur
		}
		if en.MO {
			b.HeuresMO += en.Heures
			b.CoutMOEur += e.TotalEur
		}

		// Dérive de provision (DECISIONS) : consommation sans ressource identifiée
		// d'une provision (TYPE) ou d'un CT dont le plan porte une provision.
		attached := r.ids[i] != nil && r.ids[i].matched()
		isProvType := canon(e.Type) == provisionType
		unmatchedMO := r.ids[i] != nil && !r.ids[i].matched()
		if !attached && (isProvType || (unmatchedMO && provCT[ct])) {
			al.DeriveProvision = append(al.DeriveProvision, domain.DeriveProvision{
				CT:                 ct,
				RowNum:             e.RowNum,
				EmployeFournisseur: entryName(e),
				Type:               strings.TrimSpace(e.Type),
				DateDepense:        e.DateDepense,
				Heures:             round2(en.Heures),
				Eur:                round2(e.TotalEur),
			})
		}
	}

	cts := make([]string, 0, len(byCT))
	for ct := range byCT {
		cts = append(cts, ct)
	}
	sort.Strings(cts)
	out := domain.Budget{ParCT: make([]domain.BudgetCT, 0, len(cts))}
	for _, ct := range cts {
		b := byCT[ct]
		g.Securise += b.Securise
		g.NonSecurise += b.NonSecurise
		g.NonClasse += b.NonClasse
		b.Securise, b.NonSecurise, b.NonClasse = round2(b.Securise), round2(b.NonSecurise), round2(b.NonClasse)
		b.PPSPlan, b.HeuresMO, b.CoutMOEur = round2(b.PPSPlan), round2(b.HeuresMO), round2(b.CoutMOEur)
		b.PctSecurite = pct(b.Securise, b.Securise+b.NonSecurise)
		b.Risque = b.NonSecurise > r.s.SeuilCTRisqueEur
		if b.Risque {
			al.CTRisque = append(al.CTRisque, domain.AlerteCT{CT: ct, CTLibelle: b.CTLibelle, NonSecurise: b.NonSecurise})
		}
		out.ParCT = append(out.ParCT, *b)
	}
	sort.SliceStable(al.CTRisque, func(i, j int) bool { return al.CTRisque[i].NonSecurise > al.CTRisque[j].NonSecurise })
	g.PctSecurite = pct(g.Securise, g.Securise+g.NonSecurise)
	g.PctNonSecurise = pct(g.NonSecurise, g.Securise+g.NonSecurise)
	g.Securise, g.NonSecurise, g.NonClasse = round2(g.Securise), round2(g.NonSecurise), round2(g.NonClasse)
	out.Global = g
	al.PctNonSecurise = g.PctNonSecurise
	al.AlerteGlobale = g.PctNonSecurise != nil && *g.PctNonSecurise > r.s.SeuilNonSecurisePct
	return out, al
}
