// Utilitaires du cycle de vie des versions (opérateur mémorisé, éligibilité à la purge, invalidations).
import type { QueryClient } from '@tanstack/react-query';
import type { Version } from '../../api/types';

const OPERATEUR_KEY = 'njord.operateur';

/** Nom de l'opérateur/importeur mémorisé localement ('' si absent ou stockage indisponible). */
export function loadOperateur(): string {
  try {
    return window.localStorage.getItem(OPERATEUR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveOperateur(v: string): void {
  try {
    const t = v.trim();
    if (t) window.localStorage.setItem(OPERATEUR_KEY, t);
    else window.localStorage.removeItem(OPERATEUR_KEY);
  } catch {
    /* stockage indisponible : ignoré */
  }
}

/** Date à partir de laquelle la purge devient possible (null si non archivée / date inconnue). */
export function purgeAvailableFrom(v: Version, delaiJours: number): Date | null {
  if (v.statut !== 'archivee' || !v.archivee_le) return null;
  const t = new Date(v.archivee_le);
  if (Number.isNaN(t.getTime())) return null;
  t.setDate(t.getDate() + delaiJours);
  return t;
}

/** true si la purge est autorisée maintenant (le serveur reste l'arbitre final). */
export function canPurgeNow(v: Version, delaiJours: number | undefined): boolean {
  if (v.statut !== 'archivee') return false;
  if (delaiJours == null) return true; // paramètres non chargés : on laisse le serveur trancher
  const from = purgeAvailableFrom(v, delaiJours);
  return from != null && from.getTime() < Date.now();
}

export const fmtDay = (d: Date) => d.toLocaleDateString('fr-FR', { dateStyle: 'short' });

/** Invalidations après une mutation de cycle de vie. */
export function invalidateLifecycle(qc: QueryClient, withReferentiels = false): void {
  void qc.invalidateQueries({ queryKey: ['versions'] });
  void qc.invalidateQueries({ queryKey: ['analyse'] });
  if (withReferentiels) {
    void qc.invalidateQueries({ queryKey: ['personnes'] });
    void qc.invalidateQueries({ queryKey: ['squads'] });
  }
}

export const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** « 1 ligne » / « 3 lignes » (pluriel régulier en s). */
export const plural = (n: number, word: string) => `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;

/** Intervalle de dates court : « 01/09 → 30/11/2026 » (année omise au début si identique). */
export function fmtRange(from?: string, to?: string): string {
  const d = (s?: string) => (s ? s.slice(0, 10).split('-') : null);
  const a = d(from);
  const b = d(to);
  if (!a && !b) return '—';
  const full = (p: string[] | null) => (p && p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '—');
  if (a && b && a.length === 3 && b.length === 3 && a[0] === b[0]) return `${a[2]}/${a[1]} → ${full(b)}`;
  return `${full(a)} → ${full(b)}`;
}
