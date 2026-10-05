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
