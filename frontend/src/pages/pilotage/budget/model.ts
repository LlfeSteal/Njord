// Ligne CT du pilotage budgétaire : fusion de la synthèse budget (classification, MO, risque)
// et des prévisions (consommé, atterrissage, statut), par code CT. Partagé avec /previsions.
// Budget d'un CT = charge max = Σ PPS du plan + provisions restantes (DECISIONS n° 16).
import type { AnalyseResult, BudgetCT, PrevisionCT, PrevisionStatut } from '../../../api/types';
import { echeanceOf, forecastOf, type Echeance } from '../shared/pilotage';

export interface CtRow {
  ct: string;
  libelle: string;
  /** Σ PPS du plan de charge (segments de la timeline). */
  pps: number;
  /** Provisions restantes du CT. */
  provisions: number;
  /** Charge max = pps + provisions : référence du % consommé et de l'écart. */
  budget: number;
  consomme: number | null;
  /** % du budget consommé (0..100+). */
  pct: number | null;
  atterrissage: number | null;
  tendance: number | null;
  ecart: number | null;
  statut: PrevisionStatut | null;
  risque: boolean;
  /** Fin d'exercice (DECISIONS n° 17), null sans prévision ou avec un backend antérieur. */
  echeance: Echeance | null;
  /** Non consommé au-delà des seuils (indicateur séparé du statut). */
  sousConso: boolean;
  /**
   * « Reste à l'échéance » : non consommé (> 0) ou dépassement à l'échéance ; repli sur l'écart d'atterrissage
   * (tout l'horizon) s'il n'y a pas de fin d'exercice. Montant du risque, toujours ≥ 0 : sert au tri.
   */
  reste: number | null;
  /** Le reste est un dépassement (affiché « + » en rouge). */
  resteOver: boolean;
  b?: BudgetCT;
  p?: PrevisionCT;
}

export function mergeCtRows(result: AnalyseResult): CtRow[] {
  const fc = forecastOf(result);
  const byCt = new Map<string, CtRow>();
  for (const b of result.budget.par_ct) {
    byCt.set(b.ct, {
      ct: b.ct,
      libelle: b.ct_libelle,
      pps: b.pps_plan,
      provisions: b.provisions ?? 0,
      budget: b.charge_max ?? b.pps_plan + (b.provisions ?? 0),
      consomme: null,
      pct: null,
      atterrissage: null,
      tendance: null,
      ecart: null,
      statut: null,
      risque: b.risque,
      echeance: null,
      sousConso: false,
      reste: null,
      resteOver: false,
      b,
    });
  }
  for (const p of fc?.par_ct ?? []) {
    const row = byCt.get(p.ct) ?? {
      ct: p.ct,
      libelle: p.ct_libelle,
      pps: p.pps ?? 0,
      provisions: p.provisions ?? 0,
      budget: p.budget,
      consomme: null,
      pct: null,
      atterrissage: null,
      tendance: null,
      ecart: null,
      statut: null,
      risque: false,
      echeance: null,
      sousConso: false,
      reste: null,
      resteOver: false,
    };
    const e = echeanceOf(p);
    const r = resteOf(e, p.ecart_plan);
    byCt.set(p.ct, {
      ...row,
      libelle: row.libelle || p.ct_libelle,
      pps: p.pps ?? row.pps,
      provisions: p.provisions ?? row.provisions,
      budget: p.budget,
      consomme: p.consomme,
      pct: p.pct_consomme ?? (p.budget ? (p.consomme / p.budget) * 100 : null),
      atterrissage: p.atterrissage_plan,
      tendance: p.atterrissage_tendance,
      ecart: p.ecart_plan,
      statut: p.statut,
      echeance: e,
      sousConso: e?.sousConso ?? false,
      reste: r.value,
      resteOver: r.over,
      p,
    });
  }
  return [...byCt.values()];
}

/**
 * Reste à l'échéance : non consommé s'il y en a, sinon dépassement à l'échéance ; sans fin d'exercice
 * (backend antérieur), écart d'atterrissage sur tout l'horizon s'il est positif.
 */
export function resteOf(e: Echeance | null, ecartPlan: number | null): { value: number | null; over: boolean } {
  if (e) {
    if (e.nonConsomme > 0.5) return { value: e.nonConsomme, over: false };
    if (e.depassement > 0.5) return { value: e.depassement, over: true };
    return { value: 0, over: false };
  }
  if (ecartPlan != null && ecartPlan > 0) return { value: ecartPlan, over: true };
  return { value: ecartPlan == null ? null : 0, over: false };
}

/** Somme d'un champ numérique, null si aucune valeur. */
export function sumOf(rows: CtRow[], k: 'pps' | 'provisions' | 'budget' | 'consomme' | 'atterrissage' | 'tendance' | 'ecart'): number | null {
  let n = 0;
  let any = false;
  for (const r of rows) {
    const v = r[k];
    if (v != null) {
      n += v;
      any = true;
    }
  }
  return any ? n : null;
}
