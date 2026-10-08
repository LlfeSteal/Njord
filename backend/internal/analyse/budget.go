package analyse

import (
	"sort"
	"strings"

	"njord/internal/domain"
)

func sortStrings(s []string) { sort.Strings(s) }

// Natures de coût de l'analyse budgétaire (DECISIONS n° 10), dans l'ordre d'affichage.
var natures = []struct{ code, libelle string }{
	{"provision", "Provision"},
	{"mo", "Main d'œuvre"},
	{"capacite", "Capacité"},
	{"frais", "Frais de mission"},
	{"autres", "Autres"},
}

// isProvisionCT: CT dont le libellé (TG du réalisé) ou le groupe du plan parle de provision.
func isProvisionCT(label string) bool { return strings.Contains(canon(label), "PROVISION") }

// planNature classe une ligne de plan ; la provision prime (CT de provision ou ligne de coût).
func planNature(provCT bool, ligneCout string) string {
	lc := canon(ligneCout)
	switch {
	case provCT || lc == provisionType:
		return "provision"
	case lc == "MAIN D'OEUVRE SUR SITE":
		return "mo"
	case strings.Contains(lc, "CAPACITE"):
		return "capacite"
	case lc == "FRAIS DE MISSION":
		return "frais"
	}
	return "autres"
}

// realiseNature classe une écriture ; la provision prime (CT de provision ou TYPE).
func realiseNature(provCT bool, e *domain.RealiseEntry) string {
	cat, typ := canon(e.Categorie), canon(e.Type)
	switch {
	case provCT || typ == provisionType:
		return "provision"
	case cat == categorieMO:
		return "mo"
	case strings.Contains(typ, "CAPACITE"):
		return "capacite"
	case cat == "FRAIS DE MISSION":
		return "frais"
	}
	return "autres"
}

// uncovered: the entry is dated on a day outside the plan timeline (no anomaly).
func (r *run) uncovered(e *domain.RealiseEntry) bool {
	d := day(e.DateDepense)
	return d != "" && !r.tl.Covered(d)
}

func pct(num, den float64) *float64 {
	if den == 0 {
		return nil
	}
	v := round2(num / den * 100)
	return &v
}

// budget computes §7.4 (per CT + global) and the alerts of §7.5 on every
// entry of the réalisé version (avoirs included), independently of the week
// period which only scopes the hours comparison. Charge max d'un CT = PPS du
// plan + provisions (DECISIONS n° 16) ; les natures ventilent les deux.
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
	natCT := map[string]bool{} // CT de provision au sens de l'analyse budgétaire (libellé)
	for i := range r.lines {
		if ct := strings.TrimSpace(r.lines[i].CT); ct != "" && (isProvisionCT(r.ctLibelle[ct]) || isProvisionCT(r.lines[i].Groupe)) {
			natCT[ct] = true
		}
	}
	natPPS, natProv, natReel := map[string]float64{}, map[string]float64{}, map[string]float64{}
	for i := range r.lines {
		l := &r.lines[i]
		ct := strings.TrimSpace(l.CT)
		natPPS[planNature(natCT[ct], l.LigneCout)] += l.PPS
		if ct == "" {
			continue
		}
		get(ct).PPSPlan += l.PPS
		if canon(l.LigneCout) == provisionType {
			provCT[ct] = true
		}
	}
	// Provisions : même classifieur que le plan, sur leur ligne de coût.
	for i := range r.provs {
		p := &r.provs[i]
		ct := strings.TrimSpace(p.CT)
		natProv[planNature(natCT[ct] || (ct != "" && isProvisionCT(r.ctLibelle[ct])), p.LigneCout)] += p.Montant
		if ct != "" {
			get(ct).Provisions += p.Montant
		}
	}

	al := domain.Alertes{CTRisque: []domain.AlerteCT{}, DeriveProvision: []domain.DeriveProvision{}}
	var g domain.BudgetGlobal
	for i := range r.entries {
		e := &r.entries[i]
		ct := strings.TrimSpace(e.TG)
		natReel[realiseNature(natCT[ct] || (ct != "" && isProvisionCT(r.ctLibelle[ct])), e)] += e.TotalEur
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
		if !attached && (isProvType || (unmatchedMO && provCT[ct])) && !r.uncovered(e) {
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
		b.ChargeMax = round2(b.PPSPlan + b.Provisions)
		b.PPSPlan, b.Provisions = round2(b.PPSPlan), round2(b.Provisions)
		b.HeuresMO, b.CoutMOEur = round2(b.HeuresMO), round2(b.CoutMOEur)
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
	out.ParNature = make([]domain.BudgetNature, 0, len(natures))
	for _, n := range natures {
		bud, reel := round2(natPPS[n.code]+natProv[n.code]), round2(natReel[n.code])
		out.ParNature = append(out.ParNature, domain.BudgetNature{Nature: n.code, Libelle: n.libelle,
			PPS: round2(natPPS[n.code]), Provisions: round2(natProv[n.code]), Budget: bud, Realise: reel, PctConsomme: pct(reel, bud)})
	}
	al.PctNonSecurise = g.PctNonSecurise
	al.AlerteGlobale = g.PctNonSecurise != nil && *g.PctNonSecurise > r.s.SeuilNonSecurisePct
	return out, al
}
