// Utilitaires partagés des sous-onglets Analyse (hors composants) : couleurs des graphiques, tri, confiance, écarts.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAppearance, type GlyphKind, type SortDir, type StatusTone, type TextTone } from '../../ui';
import type { Confidence, Flag } from '../../api/types';

// ------------------------------------------------------------------ Couleurs des graphiques
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

/** Token de couleur d'un flag (ex. `--flag-hors-plan`). */
export const flagToken = (f: Flag) => `--flag-${f.replace(/_/g, '-')}`;

/** Série d'un graphique : clé de donnée, libellé, token de teinte et opacité (piste). */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
  opacity?: number;
}

// ------------------------------------------------------------------ Tri
export type { SortDir };
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  return { sort, toggle, setSort };
}

export function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

// ------------------------------------------------------------------ Confiance de correspondance
export const CONFIDENCE_META: Record<Confidence, { label: string; tone: StatusTone; glyph: GlyphKind; hint: string }> = {
  matricule: { label: 'Matricule', tone: 'success', glyph: 'dot', hint: 'Correspondance directe par matricule' },
  alias: { label: 'Alias', tone: 'accent', glyph: 'dot', hint: 'Alias du référentiel Personne' },
  fuzzy: { label: 'Approximative *', tone: 'warning', glyph: 'warning', hint: 'Correspondance approximative (nom normalisé) — à confirmer' },
  none: { label: 'Aucune', tone: 'hors_plan', glyph: 'warning', hint: 'Écriture non rapprochée → Hors plan' },
  plan: { label: 'Plan seul', tone: 'neutral', glyph: 'ring', hint: 'Ressource présente au plan uniquement' },
};

/** Ton de l'écart signé (le signe « + / − » porte aussi l'information). */
export function ecartTone(flag: Flag, ecart: number): TextTone | undefined {
  if (flag === 'sur_imputation') return 'sur_imputation';
  if (flag === 'sous_imputation') return 'sous_imputation';
  if (ecart === 0) return 'secondary';
  return undefined;
}

export const paginate = <T,>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size);
