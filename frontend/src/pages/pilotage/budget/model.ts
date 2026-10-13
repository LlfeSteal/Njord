// Ligne CT du pilotage budgétaire : fusion de la synthèse budget (classification, MO, risque)
// et des prévisions (consommé, atterrissage, statut), par code CT. Partagé avec /previsions.
// Budget d'un CT = montant de son enveloppe, rien d'autre (DECISIONS n° 20) : sans enveloppe, budget,
// %, écart, statut et reste sont null (« Sans enveloppe »). Les prévisions sont celles de l'année choisie
// (DECISIONS n° 24) : enveloppe = tranche de l'année ; la synthèse budget (classification de repli, MO, risque)
// reste « Tout ».
import type { AnalyseResult, BudgetCT, Enveloppe, PrevisionCT, PrevisionStatut, Previsions } from '../../../api/types';
import { anneeOf, echeanceOf, forecastOf, hasEnveloppe, type Echeance } from '../shared/pilotage';

/** Source du budget d'une ligne CT : enveloppe importée, ou aucun budget. */
export type BudgetSource = PrevisionCT['budget_source'];

export interface CtRow {
  ct: string;
  libelle: string;
  /** Σ PPS du plan de charge (segments de la timeline). */
  pps: number;
  /** Provisions restantes du CT (toutes lignes ; détail sécurisées / aléas dans la prévision `p`). */
  provisions: number;
  /** Budget = montant de l'enveloppe ; null sans enveloppe. Référence du % consommé et de l'écart. */
  budget: number | null;
  source: BudgetSource;
  /** Enveloppe du CT (null = sans enveloppe, ou prévisions absentes). */
  enveloppe: Enveloppe | null;
  consomme: number | null;
  /** % de l'enveloppe consommé (0..100+) ; null sans enveloppe. */
  pct: number | null;
  atterrissage: number | null;
  tendance: number | null;
  ecart: number | null;
  statut: PrevisionStatut | null;
  risque: boolean;
  /** Fin de l'enveloppe, null sans enveloppe ou sans prévision. */
  echeance: Echeance | null;
  /** Non consommé au-delà des seuils (indicateur séparé du statut). */
  sousConso: boolean;
  /**
   * « Reste à l'échéance » : non consommé (> 0) ou dépassement à la fin de l'enveloppe ; null sans enveloppe.
   * Montant du risque, toujours ≥ 0 : sert au tri.
   */
  reste: number | null;
  /** Le reste est un dépassement (affiché « + » en rouge). */
  resteOver: boolean;
  /**
   * Année choisie où le CT, qui a une enveloppe (Tout), n'en a pas de tranche (DECISIONS n° 24) : affiché
   * « Hors 2027 » plutôt que « Sans enveloppe ». 0 sinon.
   */
  horsAnnee: number;
  b?: BudgetCT;
  p?: PrevisionCT;
}

/** Lignes CT ; `fc` = prévisions de l'année choisie (défaut : celles de l'analyse, « Tout »). */
export function mergeCtRows(result: AnalyseResult, fc: Previsions | null = forecastOf(result)): CtRow[] {
  const annee = anneeOf(fc);
  // CT qui ont une enveloppe sur toute la période : sans tranche dans l'année choisie, ils sont « hors année ».
  const withEnvTout = new Set(annee > 0 ? (result.previsions?.par_ct ?? []).filter(hasEnveloppe).map((p) => p.ct) : []);
  const byCt = new Map<string, CtRow>();
  for (const b of result.budget.par_ct) {
    byCt.set(b.ct, {
      ct: b.ct,
      libelle: b.ct_libelle,
      pps: b.pps_plan,
      provisions: b.provisions ?? 0,
      budget: null,
      source: 'aucun',
      enveloppe: null,
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
      horsAnnee: withEnvTout.has(b.ct) ? annee : 0,
      b,
    });
  }
  for (const p of fc?.par_ct ?? []) {
    const row = byCt.get(p.ct) ?? {
      ct: p.ct,
      libelle: p.ct_libelle,
      pps: p.pps ?? 0,
      provisions: p.provisions ?? 0,
      budget: null,
      source: 'aucun',
      enveloppe: null,
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
      horsAnnee: 0,
    };
    const env = hasEnveloppe(p);
    const e = echeanceOf(p, annee);
    const r = resteOf(e);
    byCt.set(p.ct, {
      ...row,
      libelle: row.libelle || p.ct_libelle,
      pps: p.pps ?? row.pps,
      provisions: p.provisions ?? row.provisions,
      budget: env ? p.budget : null,
      source: env ? 'enveloppe' : 'aucun',
      enveloppe: env ? (p.enveloppe ?? null) : null,
      consomme: p.consomme,
      pct: env ? (p.pct_consomme ?? (p.budget ? (p.consomme / p.budget) * 100 : null)) : null,
      atterrissage: p.atterrissage_plan,
      tendance: p.atterrissage_tendance,
      ecart: env ? p.ecart_plan : null,
      statut: env ? p.statut : null,
      echeance: e,
      sousConso: env && (e?.sousConso ?? false),
      reste: r.value,
      resteOver: r.over,
      horsAnnee: !env && withEnvTout.has(p.ct) ? annee : 0,
      p,
    });
  }
  return [...byCt.values()];
}

/** Reste à l'échéance : non consommé s'il y en a, sinon dépassement à la fin de l'enveloppe ; null sans enveloppe. */
export function resteOf(e: Echeance | null): { value: number | null; over: boolean } {
  if (!e) return { value: null, over: false };
  if (e.nonConsomme > 0.5) return { value: e.nonConsomme, over: false };
  if (e.depassement > 0.5) return { value: e.depassement, over: true };
  return { value: 0, over: false };
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
