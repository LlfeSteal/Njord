package analyse

import (
	"strconv"
	"strings"

	"njord/internal/domain"
)

// maxDetails bounds QualiteWarning.Details.
const maxDetails = 50

// qualityDef: code → (règle §10, message ; %d = count).
type qualityDef struct {
	regle int
	msg   string
}

// qualityOrder is the display order of the quality banner.
var qualityOrder = []string{
	"tg_ecart_budget", "mo_quantite_semaine", "sans_tg", "cloture",
	"plan_repartition", "mo_sans_nom", "sans_date", "periode_disjointe", "plan_warn", "realise_warn",
}

var qualityDefs = map[string]qualityDef{
	"tg_ecart_budget":     {1, "%d CT dont le Σ € réalisé s'écarte du PPS planifié au-delà du seuil"},
	"mo_quantite_semaine": {2, "%d imputations MO hebdomadaires dépassent le seuil d'heures par personne (physiquement impossibles)"},
	"sans_tg":             {4, "%d écritures sans TG exclues de l'analyse"},
	"cloture":             {5, "%d écritures dont la période comptable précède la date de dépense de plus de 7 jours"},
	"plan_repartition":    {0, "%d lignes de plan dont la répartition hebdomadaire ne retrouve pas la charge totale (±0.5 h)"},
	"mo_sans_nom":         {0, "%d écritures MO sans NOM Prénom identifiable, classées hors plan"},
	"sans_date":           {0, "%d écritures MO sans date de dépense exclues du tableau d'écarts"},
	"periode_disjointe":   {0, "Les périodes du plan et du réalisé ne se recouvrent pas : période par défaut = union des deux"},
	"plan_warn":           {0, "%d lignes de plan en statut warn conservées dans l'analyse"},
	"realise_warn":        {0, "%d écritures en statut warn conservées dans l'analyse"},
}

type qualite struct {
	m map[string]*domain.QualiteWarning
}

func newQualite() *qualite { return &qualite{m: map[string]*domain.QualiteWarning{}} }

func (q *qualite) get(code string) *domain.QualiteWarning {
	w := q.m[code]
	if w == nil {
		w = &domain.QualiteWarning{Code: code, Regle: qualityDefs[code].regle, Details: []string{}}
		q.m[code] = w
	}
	return w
}

// add counts one occurrence (detail "" = none).
func (q *qualite) add(code, detail string) {
	w := q.get(code)
	w.Count++
	if detail != "" && len(w.Details) < maxDetails {
		w.Details = append(w.Details, detail)
	}
}

func (q *qualite) list() []domain.QualiteWarning {
	out := []domain.QualiteWarning{}
	for _, code := range qualityOrder {
		w := q.m[code]
		if w == nil || w.Count == 0 {
			continue
		}
		msg := qualityDefs[code].msg
		if strings.Contains(msg, "%d") {
			msg = strings.Replace(msg, "%d", itoa(w.Count), 1)
		}
		w.Message = msg
		out = append(out, *w)
	}
	return out
}

func itoa(n int) string { return strconv.Itoa(n) }

// fmtH formats hours / euros for messages ("12.5").
func fmtH(v float64) string { return strconv.FormatFloat(round2(v), 'f', -1, 64) }

// dataQuality: §10 rules 1, 4, 5 and the warn counts (segments of the
// timeline, whole réalisé version).
func (r *run) dataQuality() {
	ppsByCT := map[string]float64{}
	for i := range r.lines {
		l := &r.lines[i]
		ppsByCT[strings.TrimSpace(l.CT)] += l.PPS
		if l.StatutParsing == domain.ParsingWarn {
			r.q.add("plan_warn", r.lineRef(l)+motif(l.MotifRejet))
		}
	}
	eurByTG := map[string]float64{}
	var tgs []string
	for i := range r.entries {
		e := &r.entries[i]
		tg := strings.TrimSpace(e.TG)
		if e.StatutParsing == domain.ParsingWarn {
			r.q.add("realise_warn", "ligne "+itoa(e.RowNum)+motif(e.MotifRejet))
		}
		if tg == "" {
			r.q.add("sans_tg", "ligne "+itoa(e.RowNum))
			continue
		}
		if _, ok := eurByTG[tg]; !ok {
			tgs = append(tgs, tg)
		}
		eurByTG[tg] += e.TotalEur
		dd, ok1 := ParseDate(e.DateDepense)
		pc, ok2 := ParseDate(e.PeriodeComptable)
		if ok1 && ok2 && pc.Before(dd.AddDate(0, 0, -7)) {
			r.q.add("cloture", "ligne "+itoa(e.RowNum)+" : période "+pc.Format(dateLayout)+" < dépense "+dd.Format(dateLayout))
		}
	}
	sortStrings(tgs)
	for _, tg := range tgs {
		pps, inPlan := ppsByCT[tg]
		if !inPlan {
			continue
		}
		if d := eurByTG[tg] - pps; d > r.s.SeuilEcartTGEur || -d > r.s.SeuilEcartTGEur {
			r.q.add("tg_ecart_budget", tg+" : réalisé "+fmtH(eurByTG[tg])+" € / PPS "+fmtH(pps)+" €")
		}
	}
}

func motif(m string) string {
	if m = strings.TrimSpace(m); m != "" {
		return " : " + m
	}
	return ""
}
