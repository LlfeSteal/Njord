// Utilitaires des pages Pilotage (hors composants) : couleurs des graphiques, formats courts, tri,
// statuts de prévision. Les composants partagés sont dans charts.tsx et ContextControl.tsx.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAppearance, type GlyphKind, type SortDir, type StatusTone } from '../../../ui';
import { fmtHours } from '../../../lib/format';
import type {
  AnalyseResult,
  Anomalie,
  AnomalieCategorie,
  Couverture,
  Enveloppe,
  EnveloppesSynthese,
  PrevisionCT,
  PrevisionPoint,
  PrevisionStatut,
  Previsions,
} from '../../../api/types';

// ------------------------------------------------------------------ Couleurs
// Les attributs SVG de recharts n'acceptent pas var(--…) de façon fiable : on résout les tokens
// en valeurs calculées, recalculées à chaque changement d'apparence (data-theme sur <html>).
function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const themeSnapshot = () => document.documentElement.getAttribute('data-theme') ?? '';

/** Valeurs calculées des tokens CSS demandés (ex. `--blue`), à jour du thème courant. */
export function useTokenColors<N extends string>(names: readonly N[]): Record<N, string> {
  const { resolved } = useAppearance();
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);
  const key = names.join('|');
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {} as Record<N, string>;
    for (const n of key.split('|') as N[]) out[n] = cs.getPropertyValue(n).trim();
    return out;
    // `resolved` et `theme` ne servent qu'à invalider le calcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resolved, theme]);
}

// ------------------------------------------------------------------ Formats
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const nbsp = ' ';

/** Euros abrégés : « 840 k€ », « 1,02 M€ », « 950 € ». */
export function fmtEurShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf2.format(v / 1e6)}${nbsp}M€`;
  if (a >= 1e3) return `${nf0.format(v / 1e3)}${nbsp}k€`;
  return `${nf0.format(v)}${nbsp}€`;
}

/** Euros abrégés signés : « +12 k€ » / « −1,2 M€ ». */
export function fmtEurShortSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0.5 ? '+' : v < -0.5 ? '−' : '';
  return `${s}${fmtEurShort(Math.abs(v))}`;
}

/** Euros signés : « +12 345 € » / « −4 000 € ». */
export function fmtEurSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${nf0.format(Math.abs(Math.round(v)))}${nbsp}€`;
}

/** "2026-W37" → « S37 ». */
export function weekShort(w: string | null | undefined): string {
  const m = w ? /W(\d{2})$/.exec(w) : null;
  return m ? `S${m[1]}` : (w ?? '—');
}

// ------------------------------------------------------------------ Tri
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  return { sort, toggle };
}

export function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

// ------------------------------------------------------------------ Non couvert par le plan (DECISIONS n° 13)
/** Heures MO imputées sur des jours couverts par aucune version du plan (non analysées). */
export const heuresNonCouvertes = (result: AnalyseResult | undefined) => result?.kpis?.heures_non_couvertes ?? 0;

/** Phrase complète de la mention « non couvert ». */
export const uncoveredSentence = (h: number) =>
  `${fmtHours(h)} imputées sur des périodes non couvertes par le plan (non analysées)`;

// ------------------------------------------------------------------ Prévisions
/** Prévisions exploitables (le calcul peut être absent ou vide). */
export function forecastOf(result: AnalyseResult): Previsions | null {
  const p = result.previsions;
  if (!p || !p.global || !p.as_of || !p.global.series?.length) return null;
  return p;
}

export const STATUT_LABEL: Record<PrevisionStatut, string> = {
  ok: 'Dans le budget',
  vigilance: 'Vigilance',
  depassement: 'Dépassement',
};

export const SOUS_CONSO_LABEL = 'Sous-consommation';

/**
 * Ton d'une ligne CT : dépassement ou risque de sécurisation (rouge), vigilance ou sous-consommation (orange).
 * La sous-consommation est un indicateur séparé du statut (DECISIONS n° 17) : elle ne l'emporte jamais sur lui.
 */
// Une ligne ne montre qu'un risque budgétaire : le plus proche dans le temps. La sous-consommation (à la fin
// d'exercice) passe donc avant le dépassement / la vigilance (fin du plan) ; la bulle cite tous les risques.
export function rowTone(statut: PrevisionStatut | null | undefined, risque = false, sousConso = false): 'danger' | 'warning' | undefined {
  if (risque) return 'danger';
  if (sousConso) return 'warning';
  if (statut === 'depassement') return 'danger';
  if (statut === 'vigilance') return 'warning';
  return undefined;
}

/**
 * Glyphe d'une ligne CT. Forme = sens : octogone (dépassement, risque), triangle (vigilance),
 * cercle « ! » (sous-consommation : budget perdu s'il n'est pas consommé, comme le cercle de la sous-imputation).
 */
export function rowGlyph(
  statut: PrevisionStatut | null | undefined,
  risque = false,
  sousConso = false,
): { kind: GlyphKind; tone: StatusTone } | null {
  if (risque) return { kind: 'danger', tone: 'danger' };
  if (sousConso) return SOUS_CONSO_GLYPH;
  if (statut === 'depassement') return { kind: 'danger', tone: 'danger' };
  if (statut === 'vigilance') return { kind: 'warning', tone: 'warning' };
  return null;
}

/** Glyphe du risque de sous-consommation (cercle « ! » orange). */
export const SOUS_CONSO_GLYPH: { kind: GlyphKind; tone: StatusTone } = { kind: 'attention', tone: 'attention' };

/** Raison affichée en bulle du glyphe d'une ligne CT (`enveloppe` : CT configuré, DECISIONS n° 19). */
export function rowReason(statut: PrevisionStatut | null | undefined, risque = false, sousConso = false, enveloppe = false): string {
  const parts: string[] = [];
  if (enveloppe) {
    if (sousConso) parts.push('Enveloppe qui risque de ne pas être consommée (fin de l’enveloppe)');
    if (statut === 'depassement') parts.push('Atterrissage au-delà de l’enveloppe (sur-imputation)');
    if (statut === 'vigilance') parts.push('Atterrissage proche de l’enveloppe');
  } else {
    if (sousConso) parts.push('Budget de l’exercice qui risque de ne pas être consommé (fin d’exercice)');
    if (statut === 'depassement') parts.push('Atterrissage au-delà du budget (charge max, fin du plan)');
    if (statut === 'vigilance') parts.push('Atterrissage proche du budget (fin du plan)');
  }
  if (risque) parts.push('Part non sécurisée au-delà du seuil');
  return parts.join(' · ');
}

/** Ton d'un écart au budget sur tout l'horizon du plan (positif = dépassement). */
export function ecartTextTone(p: Pick<PrevisionCT, 'statut' | 'ecart_plan'>): 'danger' | 'warning' | 'success' | undefined {
  if (p.statut === 'depassement' || p.ecart_plan > 0) return 'danger';
  if (p.statut === 'vigilance') return 'warning';
  return undefined;
}

// ------------------------------------------------------------------ Fin d'exercice (DECISIONS n° 17)
/** Situation à la fin de l'exercice d'un CT ou du périmètre : le budget non consommé à l'échéance est perdu. */
export interface Echeance {
  /**
   * `exercice` : fin d'exercice, budget = charge max (n° 17) ; `enveloppe` : CT configuré, échéance = fin de son
   * enveloppe (n° 19) ; `mixte` : périmètre dont des CT ont leur propre échéance (les montants sont sommés CT par CT).
   */
  kind: 'exercice' | 'enveloppe' | 'mixte';
  /** Enveloppe du CT (kind `enveloppe`), null sinon. */
  enveloppe: Enveloppe | null;
  /** Date de fin d'exercice ou de fin de l'enveloppe (YYYY-MM-DD). */
  date: string;
  /** Budget de l'exercice = PPS prévu jusqu'à l'échéance + provisions de l'exercice. */
  budget: number;
  pps: number;
  provisions: number;
  projPlan: number;
  projTendance: number;
  /** Projection retenue : la plus basse des deux (la pire pour la sous-consommation). */
  worst: number;
  source: 'plan' | 'tendance' | '';
  /** Budget de l'exercice qui risque d'être perdu (≥ 0). */
  nonConsomme: number;
  /** Dépassement du budget de l'exercice par les deux projections (au moins ce montant), 0 sinon. */
  depassement: number;
  rythmeNecessaire: number;
  rythmeActuel: number;
  semaines: number;
  /** Au-delà des seuils de sous-consommation (Réglages). */
  sousConso: boolean;
}

/** Données de fin d'exercice, ou null si le backend ne les fournit pas (lecture défensive). */
export function echeanceOf(p: PrevisionCT | null | undefined): Echeance | null {
  if (!p?.echeance) return null;
  const budget = p.budget_echeance ?? 0;
  const projPlan = p.projection_plan_echeance ?? 0;
  const projTendance = p.projection_tendance_echeance ?? 0;
  const source = p.non_consomme_source ?? '';
  const worst = source === 'plan' ? projPlan : source === 'tendance' ? projTendance : Math.min(projPlan, projTendance);
  const nonConsomme = Math.max(0, p.non_consomme ?? 0);
  const low = Math.min(projPlan, projTendance);
  const src = budgetSourceOf(p);
  return {
    kind: p.enveloppe ? 'enveloppe' : src === 'charge_max' ? 'exercice' : 'mixte',
    enveloppe: p.enveloppe ?? null,
    date: p.enveloppe?.date_fin ?? p.echeance,
    budget,
    pps: p.pps_echeance ?? 0,
    provisions: p.provisions_echeance ?? 0,
    projPlan,
    projTendance,
    worst,
    source,
    nonConsomme,
    depassement: nonConsomme > 0.5 ? 0 : Math.max(0, low - budget),
    rythmeNecessaire: p.rythme_necessaire ?? 0,
    rythmeActuel: p.rythme_hebdo ?? 0,
    semaines: p.semaines_echeance ?? 0,
    sousConso: p.sous_consommation ?? false,
  };
}

const DAY_MS = 86_400_000;

/** Semaine de la série qui contient la date (début ≤ date < début + 7 j), ou null hors horizon. */
export function weekOfDate(series: readonly { week: string; debut?: string }[], date: string): string | null {
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  for (const p of series) {
    const d = p.debut ? Date.parse(`${p.debut.slice(0, 10)}T00:00:00Z`) : NaN;
    if (!Number.isNaN(d) && t >= d && t < d + 7 * DAY_MS) return p.week;
  }
  return null;
}

/** Semaine ISO « YYYY-Www » du lundi `t` (ms UTC). */
function isoWeekOf(t: number): string {
  const thu = new Date(t + 3 * DAY_MS);
  const y = thu.getUTCFullYear();
  const w = Math.ceil(((thu.getTime() - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Point du graphique cumulé : point du backend, ou semaine ajoutée au-delà de la fin du plan (`extension`). */
export type ForecastPoint = Omit<PrevisionPoint, 'couverture'> & { couverture?: Couverture; extension?: boolean };

/**
 * Prolonge la série jusqu'à la semaine de l'échéance quand le plan s'arrête avant (fin du plan ≠ fin d'exercice) :
 * PDC cumulé plat, courbes plan et tendance menées linéairement jusqu'aux projections à l'échéance du backend.
 * Sans effet si l'échéance est dans l'horizon, avant lui, ou si la série n'a pas de date de début.
 */
export function extendToEcheance(series: PrevisionPoint[], e: Echeance | null | undefined): ForecastPoint[] {
  const last = series[series.length - 1];
  if (!e || !last?.debut) return series;
  const end = Date.parse(`${e.date.slice(0, 10)}T00:00:00Z`);
  const lastStart = Date.parse(`${last.debut.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(lastStart) || end < lastStart + 7 * DAY_MS) return series;
  const k = Math.min(Math.floor((end - lastStart) / (7 * DAY_MS)), 60);
  const lerp = (from: number | null, to: number, i: number) => (from == null ? null : from + ((to - from) * i) / k);
  const extra: ForecastPoint[] = [];
  for (let i = 1; i <= k; i++) {
    const t = lastStart + i * 7 * DAY_MS;
    extra.push({
      week: isoWeekOf(t),
      debut: new Date(t).toISOString().slice(0, 10),
      budget_cumul: last.budget_cumul,
      reel_cumul: null,
      plan_cumul: lerp(last.plan_cumul ?? last.reel_cumul, e.projPlan, i),
      tendance_cumul: lerp(last.tendance_cumul ?? last.reel_cumul, e.projTendance, i),
      heures_plan: 0,
      heures_reel: null,
      extension: true,
    });
  }
  return [...series, ...extra];
}

/** "2026-12-31" → « 31/12 ». */
/** « mars 2027 » depuis une date YYYY-MM-DD. */
export function fmtMonthYear(d: string): string {
  const t = new Date(`${d.slice(0, 10)}T00:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function fmtDayMonth(d: string | null | undefined): string {
  const m = d ? /^\d{4}-(\d{2})-(\d{2})/.exec(d) : null;
  return m ? `${m[2]}/${m[1]}` : '—';
}

/** Projection retenue, en clair : « projection tendance ». */
export const sourceLabel = (s: Echeance['source']) => (s === 'tendance' ? 'projection tendance' : s === 'plan' ? 'projection plan' : 'pire projection');

/** Part du non consommé faite de provisions non engagées (les projections ne consomment pas les provisions). */
export const provisionsNonEngagees = (e: Echeance) => Math.min(e.nonConsomme, e.provisions);

/** « il faudrait 12 k€/sem. (actuel 8 k€/sem.) », ou null s'il ne reste aucune semaine. */
export function paceText(e: Echeance): string | null {
  if (e.semaines <= 0) return null;
  return `il faudrait ${fmtEurShort(e.rythmeNecessaire)}/sem. (actuel ${fmtEurShort(e.rythmeActuel)}/sem.)`;
}

/** Mots de l'échéance selon la source du budget : fin d'exercice, fin de l'enveloppe d'un CT, ou échéances mêlées. */
export interface EcheanceWords {
  /** « au 31/12 », « à la fin de l'enveloppe (30/06) », « à l'échéance ». */
  when: string;
  /** Repère du graphique : « Fin d'exercice 31/12 », « Fin de l'enveloppe 30/06 », « Échéance 31/12 ». */
  marker: string;
  /** « budget de l'exercice », « enveloppe », « budget à l'échéance ». */
  budget: string;
  /** « du budget de l'exercice », « de l'enveloppe »… */
  of: string;
  /** « le budget de l'exercice », « l'enveloppe »… */
  the: string;
  /** Accord : « l'enveloppe serait dépassée ». */
  fem: boolean;
}

export function echeanceWords(e: Echeance): EcheanceWords {
  const d = fmtDayMonth(e.date);
  if (e.kind === 'enveloppe')
    return { when: `à la fin de l’enveloppe (${d})`, marker: `Fin de l’enveloppe ${d}`, budget: 'enveloppe', of: 'de l’enveloppe', the: 'l’enveloppe', fem: true };
  if (e.kind === 'mixte')
    return { when: 'à l’échéance', marker: `Échéance ${d}`, budget: 'budget à l’échéance', of: 'du budget à l’échéance', the: 'le budget à l’échéance', fem: false };
  return { when: `au ${d}`, marker: `Fin d’exercice ${d}`, budget: 'budget de l’exercice', of: 'du budget de l’exercice', the: 'le budget de l’exercice', fem: false };
}

/** Majuscule initiale. */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fin de phrase de lecture : « au 31/12, 85 k€ du budget de l'exercice risquent d'être perdus (projection tendance) ». */
export function echeanceSentence(e: Echeance): string {
  const w = echeanceWords(e);
  if (e.nonConsomme > 0.5)
    return `${w.when}, ${fmtEurShort(e.nonConsomme)} ${w.of} (${fmtEurShort(e.budget)}) risquent d’être perdus (${sourceLabel(e.source)})`;
  if (e.depassement > 0.5)
    return `${w.when}, ${w.the} (${fmtEurShort(e.budget)}) serait dépassé${w.fem ? 'e' : ''} d’au moins ${fmtEurShort(e.depassement)}`;
  return `${w.when}, ${w.the} (${fmtEurShort(e.budget)}) serait entièrement consommé${w.fem ? 'e' : ''}`;
}

// ------------------------------------------------------------------ Enveloppes (DECISIONS n° 19)
/** Source du budget d'une prévision (lecture défensive : backend antérieur = charge max). */
export function budgetSourceOf(p: Pick<PrevisionCT, 'budget_source' | 'enveloppe'> | null | undefined): PrevisionCT['budget_source'] {
  if (!p) return 'charge_max';
  if (p.enveloppe) return 'enveloppe';
  return p.budget_source ?? 'charge_max';
}

/** Charge max reconstruite (Σ PPS + provisions), gardée pour comparaison. */
export const chargeMaxOf = (p: Pick<PrevisionCT, 'charge_max' | 'pps' | 'provisions'>) => p.charge_max ?? (p.pps ?? 0) + (p.provisions ?? 0);

/**
 * Plan de charge face aux enveloppes : synthèse du backend, ou recalculée depuis `par_ct` (backend qui
 * fournit les enveloppes par CT sans la synthèse). Sans aucune enveloppe : nb_configures = 0.
 */
export function enveloppesOf(fc: Previsions | null | undefined): EnveloppesSynthese | null {
  if (!fc) return null;
  if (fc.enveloppes && typeof fc.enveloppes.nb_configures === 'number') return fc.enveloppes;
  const s: EnveloppesSynthese = {
    nb_ct: fc.par_ct.length,
    nb_configures: 0,
    montant: 0,
    atterrissage: 0,
    ecart: 0,
    depassement: 0,
    nb_depassement: 0,
    non_consomme: 0,
    nb_sous_consommation: 0,
    plan_hors_enveloppe: 0,
  };
  for (const p of fc.par_ct) {
    if (!p.enveloppe) continue;
    s.nb_configures += 1;
    s.montant += p.enveloppe.montant;
    s.atterrissage += p.atterrissage_plan;
    if (p.ecart_plan > 0) {
      s.depassement += p.ecart_plan;
      s.nb_depassement += 1;
    }
    s.non_consomme += Math.max(0, p.non_consomme ?? 0);
    if (p.sous_consommation) s.nb_sous_consommation += 1;
    s.plan_hors_enveloppe += p.plan_hors_enveloppe ?? 0;
  }
  s.ecart = s.atterrissage - s.montant;
  return s;
}

// ------------------------------------------------------------------ Anomalies
export const CATEGORIE_LABEL: Record<AnomalieCategorie, string> = {
  ecart: 'Écarts de charge',
  ct_risque: 'CT à risque',
  derive: 'Dérives de provision',
  qualite: 'Qualité des données',
  budget: 'Prévisions budgétaires',
};

/** Anomalie de sous-consommation (clé `budget_sous_conso|CT`). */
export const isSousConsoAnomalie = (a: Pick<Anomalie, 'key'>) => a.key.startsWith('budget_sous_conso|');

/** Glyphe d'une anomalie hors écart : sous-consommation = cercle « ! » du risque de perte, sinon gravité. */
export function anomalieGlyph(a: Pick<Anomalie, 'key' | 'gravite'>): { kind: GlyphKind; tone: StatusTone } {
  return isSousConsoAnomalie(a) ? SOUS_CONSO_GLYPH : graviteGlyph(a.gravite);
}

/** Glyphe d'une gravité : 3 octogone rouge, 2 triangle orange, 1 cercle. */
export function graviteGlyph(g: number): { kind: GlyphKind; tone: StatusTone } {
  if (g >= 3) return { kind: 'danger', tone: 'danger' };
  if (g === 2) return { kind: 'warning', tone: 'warning' };
  return { kind: 'attention', tone: 'attention' };
}

/** Anomalies à traiter, regroupées par catégorie (ordre de première apparition = gravité). */
export function anomaliesATraiter(list: Anomalie[] | null | undefined) {
  const open = (list ?? []).filter((a) => a.statut === 'a_traiter');
  const byCat = new Map<AnomalieCategorie, { categorie: AnomalieCategorie; count: number; gravite: number }>();
  for (const a of open) {
    const c = byCat.get(a.categorie) ?? { categorie: a.categorie, count: 0, gravite: 0 };
    c.count += 1;
    c.gravite = Math.max(c.gravite, a.gravite);
    byCat.set(a.categorie, c);
  }
  const categories = [...byCat.values()].sort((a, b) => b.gravite - a.gravite || b.count - a.count);
  const top = [...open].sort((a, b) => b.gravite - a.gravite).slice(0, 3);
  return { total: open.length, categories, top };
}

/**
 * Phrase de lecture du graphique cumulé. Budget max = PDC + provisions ; avec la fin d'exercice (ou la fin de
 * l'enveloppe d'un CT configuré), la phrase dit d'abord ce qui reste du budget à l'échéance (risque de perte).
 */
export function forecastSentence(p: PrevisionCT): string {
  const e = echeanceOf(p);
  const src = budgetSourceOf(p);
  // CT configuré : l'atterrissage est pris à la fin de l'enveloppe, face à son montant (DECISIONS n° 19).
  if (src === 'enveloppe' && p.enveloppe) {
    const d = fmtDayMonth(p.enveloppe.date_fin);
    if (e && e.nonConsomme > 0.5)
      return `À la fin de l’enveloppe (${d}), ${fmtEurShort(e.nonConsomme)} de l’enveloppe (${fmtEurShort(e.budget)}) risquent d’être perdus (${sourceLabel(e.source)}).`;
    if (p.ecart_plan > 0.5)
      return `Atterrissage ${fmtEurShort(p.atterrissage_plan)} à la fin de l’enveloppe (${d}), soit ${fmtEurShort(p.ecart_plan)} au-dessus de l’enveloppe (${fmtEurShort(p.budget)}).`;
    return `Atterrissage ${fmtEurShort(p.atterrissage_plan)} à la fin de l’enveloppe (${d}) pour une enveloppe de ${fmtEurShort(p.budget)}.`;
  }
  // Échéance d'abord, avec le budget de l'exercice : le montant se lit sur le crochet du graphique.
  if (e && e.nonConsomme > 0.5) {
    if (e.kind === 'mixte')
      return `À l’échéance de chaque CT, ${fmtEurShort(e.nonConsomme)} du budget (${fmtEurShort(e.budget)}) risquent d’être perdus (${sourceLabel(e.source)}).`;
    return `Au ${fmtDayMonth(e.date)}, ${fmtEurShort(e.nonConsomme)} du budget ${e.date.slice(0, 4)} (${fmtEurShort(e.budget)}) risquent d’être perdus (${sourceLabel(e.source)}).`;
  }
  const what = src === 'charge_max' ? 'budget max' : 'budget';
  if (p.ecart_plan > 0.5) return `Atterrissage ${fmtEurShort(p.atterrissage_plan)} à la fin du plan, soit ${fmtEurShort(p.ecart_plan)} au-dessus du ${what}.`;
  return `Atterrissage ${fmtEurShort(p.atterrissage_plan)} pour un ${what} de ${fmtEurShort(p.budget)} à la fin du plan.`;
}
