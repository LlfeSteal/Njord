// Ligne CT du pilotage budgétaire : fusion de la synthèse budget (classification, MO, risque)
// et des prévisions (consommé, atterrissage, statut), par code CT. Partagé avec /previsions.
import type { AnalyseResult, BudgetCT, PrevisionCT, PrevisionStatut } from '../../../api/types';
import { forecastOf } from '../shared/pilotage';

export interface CtRow {
  ct: string;
  libelle: string;
  budget: number;
  consomme: number | null;
  /** % du budget consommé (0..100+). */
  pct: number | null;
  atterrissage: number | null;
  tendance: number | null;
  ecart: number | null;
  statut: PrevisionStatut | null;
  risque: boolean;
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
      budget: b.pps_plan,
      consomme: null,
      pct: null,
      atterrissage: null,
      tendance: null,
      ecart: null,
      statut: null,
      risque: b.risque,
      b,
    });
  }
  for (const p of fc?.par_ct ?? []) {
    const row = byCt.get(p.ct) ?? {
      ct: p.ct,
      libelle: p.ct_libelle,
      budget: p.budget,
      consomme: null,
      pct: null,
      atterrissage: null,
      tendance: null,
      ecart: null,
      statut: null,
      risque: false,
    };
    byCt.set(p.ct, {
      ...row,
      libelle: row.libelle || p.ct_libelle,
      budget: p.budget,
      consomme: p.consomme,
      pct: p.pct_consomme ?? (p.budget ? (p.consomme / p.budget) * 100 : null),
      atterrissage: p.atterrissage_plan,
      tendance: p.atterrissage_tendance,
      ecart: p.ecart_plan,
      statut: p.statut,
      p,
    });
  }
  return [...byCt.values()];
}

/** Somme d'un champ numérique, null si aucune valeur. */
export function sumOf(rows: CtRow[], k: 'budget' | 'consomme' | 'atterrissage' | 'tendance' | 'ecart'): number | null {
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
