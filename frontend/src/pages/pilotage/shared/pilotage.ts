// Utilitaires des pages Pilotage (hors composants) : couleurs des graphiques, formats courts, tri,
// statuts de prévision. Les composants partagés sont dans charts.tsx et ContextControl.tsx.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAppearance, type GlyphKind, type SortDir, type StatusTone } from '../../../ui';
import { fmtHours } from '../../../lib/format';
import type { AnalyseResult, Anomalie, AnomalieCategorie, PrevisionCT, PrevisionStatut, Previsions } from '../../../api/types';

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

/** Ton d'une ligne / d'un glyphe selon le statut de prévision et le risque de sécurisation. */
export function rowTone(statut: PrevisionStatut | null | undefined, risque = false): 'danger' | 'warning' | undefined {
  if (statut === 'depassement' || risque) return 'danger';
  if (statut === 'vigilance') return 'warning';
  return undefined;
}

/** Raison affichée en bulle du glyphe d'une ligne CT. */
export function rowReason(statut: PrevisionStatut | null | undefined, risque = false): string {
  const parts: string[] = [];
  if (statut === 'depassement') parts.push('Atterrissage au-delà du budget');
  if (statut === 'vigilance') parts.push('Atterrissage proche du budget');
  if (risque) parts.push('Part non sécurisée au-delà du seuil');
  return parts.join(' · ');
}

/** Ton d'un écart au budget (positif = dépassement). */
export function ecartTextTone(p: Pick<PrevisionCT, 'statut' | 'ecart_plan'>): 'danger' | 'warning' | 'success' | undefined {
  if (p.statut === 'depassement' || p.ecart_plan > 0) return 'danger';
  if (p.statut === 'vigilance') return 'warning';
  return undefined;
}

// ------------------------------------------------------------------ Anomalies
export const CATEGORIE_LABEL: Record<AnomalieCategorie, string> = {
  ecart: 'Écarts de charge',
  ct_risque: 'CT à risque',
  derive: 'Dérives de provision',
  qualite: 'Qualité des données',
  budget: 'Prévisions budgétaires',
};

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

/** Phrase de lecture du graphique cumulé (`scope` : « le périmètre », « le CT Y99… »). */
export function forecastSentence(p: PrevisionCT, scope: string): string {
  return `Au rythme du plan, ${scope} atterrit à ${fmtEurShort(p.atterrissage_plan)} pour ${fmtEurShort(p.budget)} de budget.`;
}
