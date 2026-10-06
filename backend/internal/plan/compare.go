package plan

import (
	"context"
	"math"
	"sort"
	"strings"

	"njord/internal/domain"
	"njord/internal/store"
)

// NonNominatif labels plan lines without « NOM Prénom » in the comparison.
const NonNominatif = "(non nominatif)"

// deriveSeuil : écart minimal (PPS ou charge) pour qu'un agrégat soit « modifie ».
const deriveSeuil = 0.01

// Compare computes the plan drift between two plan versions (DECISIONS n° 12).
// fromID / toID may be empty: to = active version, from = oldest non-purged
// plan version other than to. Unknown, non-plan or purged ids → store.ErrNotFound;
// identical versions or not enough versions → store.Precondition.
func Compare(ctx context.Context, st *store.Store, fromID, toID string) (domain.PlanCompare, error) {
	var out domain.PlanCompare
	from, to, err := resolveCompareVersions(ctx, st, strings.TrimSpace(fromID), strings.TrimSpace(toID))
	if err != nil {
		return out, err
	}
	out.From, out.To = from, to

	af, err := aggregatePlan(ctx, st, from.ID)
	if err != nil {
		return out, err
	}
	at, err := aggregatePlan(ctx, st, to.ID)
	if err != nil {
		return out, err
	}

	out.Totaux = domain.PlanCompareTotaux{
		PPSFrom:         round2(af.pps),
		PPSTo:           round2(at.pps),
		ChargeFrom:      round2(af.charge),
		ChargeTo:        round2(at.charge),
		NbCTFrom:        len(af.cts),
		NbCTTo:          len(at.cts),
		NbPersonnesFrom: af.nbPersonnes,
		NbPersonnesTo:   at.nbPersonnes,
	}

	out.ParCT = []domain.PlanCompareCT{}
	for _, k := range unionKeys(af.cts, at.cts) {
		f, inFrom := aggOf(af.cts, k)
		t, inTo := aggOf(at.cts, k)
		groupe := t.groupe
		if groupe == "" {
			groupe = f.groupe
		}
		row := domain.PlanCompareCT{
			CT: k, Groupe: groupe,
			PPSFrom: round2(f.pps), PPSTo: round2(t.pps),
			ChargeFrom: round2(f.charge), ChargeTo: round2(t.charge),
		}
		row.Statut = deriveStatut(inFrom, inTo, row.PPSFrom, row.PPSTo, row.ChargeFrom, row.ChargeTo)
		out.ParCT = append(out.ParCT, row)
	}
	sort.SliceStable(out.ParCT, func(i, j int) bool {
		a, b := out.ParCT[i], out.ParCT[j]
		da, db := math.Abs(a.PPSTo-a.PPSFrom), math.Abs(b.PPSTo-b.PPSFrom)
		if da != db {
			return da > db
		}
		return a.CT < b.CT
	})

	out.ParPersonne = []domain.PlanComparePersonne{}
	for _, k := range unionKeys(af.personnes, at.personnes) {
		f, inFrom := aggOf(af.personnes, k)
		t, inTo := aggOf(at.personnes, k)
		row := domain.PlanComparePersonne{
			NomPrenom: k,
			PPSFrom:   round2(f.pps), PPSTo: round2(t.pps),
			ChargeFrom: round2(f.charge), ChargeTo: round2(t.charge),
		}
		row.Statut = deriveStatut(inFrom, inTo, row.PPSFrom, row.PPSTo, row.ChargeFrom, row.ChargeTo)
		out.ParPersonne = append(out.ParPersonne, row)
	}
	sort.SliceStable(out.ParPersonne, func(i, j int) bool {
		a, b := out.ParPersonne[i], out.ParPersonne[j]
		da, db := math.Abs(a.ChargeTo-a.ChargeFrom), math.Abs(b.ChargeTo-b.ChargeFrom)
		if da != db {
			return da > db
		}
		return a.NomPrenom < b.NomPrenom
	})
	return out, nil
}

func resolveCompareVersions(ctx context.Context, st *store.Store, fromID, toID string) (from, to domain.Version, err error) {
	get := func(id string) (domain.Version, error) {
		v, err := st.GetVersion(ctx, domain.KindPlan, id)
		if err != nil {
			return v, err
		}
		if v.Statut == domain.StatutPurgee {
			return v, store.ErrNotFound
		}
		return v, nil
	}

	if toID != "" {
		if to, err = get(toID); err != nil {
			return
		}
	}
	if fromID != "" {
		if from, err = get(fromID); err != nil {
			return
		}
	}
	if toID == "" {
		active, aerr := st.ActiveVersion(ctx, domain.KindPlan)
		if aerr != nil {
			return from, to, aerr
		}
		if active == nil {
			return from, to, store.Precondition("aucune version de plan active : précisez la version à comparer (to)")
		}
		to = *active
	}
	if fromID == "" {
		vs, lerr := st.ListVersions(ctx, domain.KindPlan, false)
		if lerr != nil {
			return from, to, lerr
		}
		sort.Slice(vs, func(i, j int) bool {
			if !vs[i].ImporteeLe.Equal(vs[j].ImporteeLe) {
				return vs[i].ImporteeLe.Before(vs[j].ImporteeLe)
			}
			return vs[i].ID < vs[j].ID
		})
		found := false
		for _, v := range vs {
			if v.ID != to.ID {
				from, found = v, true
				break
			}
		}
		if !found {
			return from, to, store.Precondition("il faut au moins deux versions de plan non purgées pour comparer")
		}
	}
	if from.ID == to.ID {
		return from, to, store.Precondition("les deux versions comparées doivent être distinctes")
	}
	return from, to, nil
}

type planAgg struct {
	pps, charge float64
	groupe      string
}

type planSide struct {
	pps, charge float64
	cts         map[string]*planAgg
	personnes   map[string]*planAgg
	nbPersonnes int
}

func aggregatePlan(ctx context.Context, st *store.Store, versionID string) (planSide, error) {
	side := planSide{cts: map[string]*planAgg{}, personnes: map[string]*planAgg{}}
	rows, err := st.DB().QueryContext(ctx, `SELECT ct, nom_prenom, groupe, pps, charge_totale
		FROM plan_lines WHERE version_id = ? AND statut_parsing <> 'drop' ORDER BY row_num, id`, versionID)
	if err != nil {
		return side, err
	}
	defer rows.Close()
	for rows.Next() {
		var ct, nom, groupe string
		var pps, charge float64
		if err := rows.Scan(&ct, &nom, &groupe, &pps, &charge); err != nil {
			return side, err
		}
		side.pps += pps
		side.charge += charge

		a := side.cts[ct]
		if a == nil {
			a = &planAgg{}
			side.cts[ct] = a
		}
		a.pps += pps
		a.charge += charge
		if a.groupe == "" {
			a.groupe = groupe
		}

		key := nom
		if key == "" {
			key = NonNominatif
		} else if _, seen := side.personnes[key]; !seen {
			side.nbPersonnes++
		}
		p := side.personnes[key]
		if p == nil {
			p = &planAgg{}
			side.personnes[key] = p
		}
		p.pps += pps
		p.charge += charge
	}
	if err := rows.Err(); err != nil {
		return side, err
	}
	return side, nil
}

// aggOf returns m[k] (zero value if absent) and whether it was present.
func aggOf(m map[string]*planAgg, k string) (planAgg, bool) {
	if a, ok := m[k]; ok {
		return *a, true
	}
	return planAgg{}, false
}

// unionKeys returns the keys of both maps (no particular order).
func unionKeys(a, b map[string]*planAgg) []string {
	out := make([]string, 0, len(a)+len(b))
	for k := range a {
		out = append(out, k)
	}
	for k := range b {
		if _, ok := a[k]; !ok {
			out = append(out, k)
		}
	}
	return out
}

// deriveStatut compares already rounded values.
func deriveStatut(inFrom, inTo bool, ppsFrom, ppsTo, chargeFrom, chargeTo float64) domain.DeriveStatut {
	switch {
	case !inFrom:
		return domain.DeriveAjoute
	case !inTo:
		return domain.DeriveRetire
	case math.Abs(ppsTo-ppsFrom) >= deriveSeuil-1e-9 || math.Abs(chargeTo-chargeFrom) >= deriveSeuil-1e-9:
		return domain.DeriveModifie
	default:
		return domain.DeriveInchange
	}
}

func round2(v float64) float64 {
	r := math.Round(v*100) / 100
	if r == 0 {
		return 0 // pas de -0
	}
	return r
}
