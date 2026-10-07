// Page Écarts : état d'URL (mêmes clés que l'ancienne page Analyse), tri, regroupement par ressource × CT.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FLAG_SEVERITY, type Confidence, type EcartRow, type Flag } from '../../../api/types';
import type { TextTone } from '../../../ui';

// ------------------------------------------------------------------ URL
export type EcartsVue = 'liste' | 'ressource';
const FLAGS: Flag[] = ['absence', 'hors_plan', 'erreur_ct', 'sur_imputation', 'sous_imputation', 'conforme'];

export interface EcartsUrl {
  vue: EcartsVue;
  q: string;
  ct?: string;
  ressource?: string;
  flags: Flag[];
  squad?: string;
}
export type EcartsPatch = Partial<Record<'vue' | 'q' | 'ct' | 'ressource' | 'squad', string | null>> & { flags?: Flag[] };

export function useEcartsUrl() {
  const [sp, setSp] = useSearchParams();
  const state = useMemo<EcartsUrl>(
    () => ({
      vue: sp.get('vue') === 'ressource' ? 'ressource' : 'liste',
      q: sp.get('q') ?? '',
      ct: sp.get('ct') || undefined,
      ressource: sp.get('ressource') || undefined,
      flags: (sp.get('flag') ?? '').split(',').filter((f): f is Flag => (FLAGS as string[]).includes(f)),
      squad: sp.get('squad') || undefined,
    }),
    [sp],
  );
  const update = useCallback(
    (patch: EcartsPatch) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (k === 'flags') {
              const list = v as Flag[];
              if (list.length) n.set('flag', list.join(','));
              else n.delete('flag');
            } else if (v == null || v === '' || (k === 'vue' && v === 'liste')) n.delete(k);
            else n.set(k, String(v));
          }
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );
  return { state, update };
}

// ------------------------------------------------------------------ Tons
/**
 * Ton de ligne (§8 « Anomaly rows ») : danger pour sur-imputation et absence, warning pour hors plan,
 * erreur de CT et sous-imputation.
 */
export function rowTone(flag: Flag): 'danger' | 'warning' | undefined {
  if (flag === 'sur_imputation' || flag === 'absence') return 'danger';
  if (flag === 'hors_plan' || flag === 'erreur_ct' || flag === 'sous_imputation') return 'warning';
  return undefined;
}

/** Ton de l'écart signé : celui du flag ; les conformes ne sont pas teintés. */
export const ecartTone = (flag: Flag): TextTone | undefined => (flag === 'conforme' ? undefined : flag);

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  nom: 'NOM + Prénom',
  none: 'Hors plan',
  plan: 'Plan seul',
};

// ------------------------------------------------------------------ Tri
export type SortDir = 'asc' | 'desc';
export interface Sort<K extends string> {
  key: K | 'gravite';
  dir: SortDir;
}
export const DEFAULT_SORT = { key: 'gravite', dir: 'desc' } as const;

/** Clic sur un en-tête : 1er sens, sens inverse, puis retour au tri par gravité. */
export function nextSort<K extends string>(s: Sort<K>, key: K, firstDir: SortDir): Sort<K> {
  if (s.key !== key) return { key, dir: firstDir };
  if (s.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return { ...DEFAULT_SORT };
}

export function cmp(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

export const bySeverity = (a: { flag: Flag; ecart: number }, b: { flag: Flag; ecart: number }) =>
  FLAG_SEVERITY[b.flag] - FLAG_SEVERITY[a.flag] || Math.abs(b.ecart) - Math.abs(a.ecart);

export type ListKey = 'ressource' | 'ct' | 'semaine' | 'prevu' | 'reel' | 'ecart';

export function sortRows(rows: EcartRow[], s: Sort<ListKey>): EcartRow[] {
  const out = [...rows];
  if (s.key === 'gravite') return out.sort(bySeverity);
  const k = s.key;
  const get = (e: EcartRow): string | number => (k === 'ressource' ? e.ressource_label || e.ressource : e[k]);
  const sign = s.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => sign * cmp(get(a), get(b)) || bySeverity(a, b));
}

// ------------------------------------------------------------------ Par ressource × CT
export interface RessourceRow {
  id: string;
  head: EcartRow;
  ct: string;
  ct_libelle: string;
  rows: EcartRow[];
  prevu: number;
  reel: number;
  ecart: number;
  /** Flag le plus grave de la période. */
  flag: Flag;
  /** Semaines non conformes. */
  nbEcarts: number;
}

const groupId = (e: EcartRow) => `${e.personne_id ?? ''}|${e.ressource}|${e.ct}`;
export const rowId = (e: EcartRow) => `${groupId(e)}|${e.semaine}`;

const round1 = (v: number) => Math.round(v * 10) / 10;

export function groupByRessource(rows: EcartRow[]): RessourceRow[] {
  const m = new Map<string, RessourceRow>();
  for (const e of rows) {
    const id = groupId(e);
    let r = m.get(id);
    if (!r) {
      r = { id, head: e, ct: e.ct, ct_libelle: e.ct_libelle, rows: [], prevu: 0, reel: 0, ecart: 0, flag: e.flag, nbEcarts: 0 };
      m.set(id, r);
    }
    r.rows.push(e);
    r.prevu += e.prevu;
    r.reel += e.reel;
    r.ecart += e.ecart;
    if (FLAG_SEVERITY[e.flag] > FLAG_SEVERITY[r.flag]) r.flag = e.flag;
    if (e.flag !== 'conforme') r.nbEcarts += 1;
  }
  return [...m.values()].map((r) => ({
    ...r,
    prevu: round1(r.prevu),
    reel: round1(r.reel),
    ecart: round1(r.ecart),
    rows: r.rows.sort((a, b) => cmp(a.semaine, b.semaine)),
  }));
}

export type GroupKey = 'ressource' | 'ct' | 'nbEcarts' | 'prevu' | 'reel' | 'ecart';

export function sortGroups(rows: RessourceRow[], s: Sort<GroupKey>): RessourceRow[] {
  const out = [...rows];
  if (s.key === 'gravite') return out.sort((a, b) => bySeverity(a, b) || b.nbEcarts - a.nbEcarts);
  const k = s.key;
  const get = (r: RessourceRow): string | number => (k === 'ressource' ? r.head.ressource_label || r.head.ressource : r[k]);
  const sign = s.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => sign * cmp(get(a), get(b)) || bySeverity(a, b));
}

export const paginate = <T>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size);

// ------------------------------------------------------------------ Synthèse des imputations
/** Flags du camembert, dans l'ordre de gravité (l'absence est comptée à part, en personnes). */
export const SYNTHESE_FLAGS = ['hors_plan', 'erreur_ct', 'sur_imputation', 'sous_imputation', 'conforme'] as const;
export type SyntheseFlag = (typeof SYNTHESE_FLAGS)[number];

export interface Synthese {
  /** Heures propres à chaque flag (cf. `synthese`). */
  parts: { flag: SyntheseFlag; heures: number }[];
  total: number;
  /** Personnes planifiées sans aucune heure sur la période (⚫ Absence). */
  jamaisImputes: number;
  /** Personnes ayant des heures prévues sur la période. */
  planifiees: number;
}

/**
 * Répartition des heures : excédent (réel − prévu) des sur-imputations, manque (prévu − réel)
 * des sous-imputations, réel hors plan, réel conforme. Erreur de CT : le réel du CT imputé à tort
 * (prévu = 0) forme sa part ; le CT planifié en face (prévu > 0) ne manque pas vraiment d'heures,
 * son réel compte en conforme. Les personnes = ressources ayant une fiche (`personne_id`) : une
 * ligne non nominative n'en est pas une.
 */
export function synthese(rows: EcartRow[]): Synthese {
  const h: Record<SyntheseFlag, number> = { hors_plan: 0, erreur_ct: 0, sur_imputation: 0, sous_imputation: 0, conforme: 0 };
  const planifiees = new Set<string>();
  const absentes = new Set<string>();
  for (const e of rows) {
    if (e.flag === 'sur_imputation') h.sur_imputation += e.ecart;
    else if (e.flag === 'sous_imputation') h.sous_imputation -= e.ecart;
    else if (e.flag === 'hors_plan') h.hors_plan += e.reel;
    else if (e.flag === 'erreur_ct') {
      if (e.prevu === 0) h.erreur_ct += e.reel;
      else h.conforme += e.reel;
    } else if (e.flag === 'conforme') h.conforme += e.reel;
    if (e.personne_id && e.prevu > 0) planifiees.add(e.ressource);
    if (e.personne_id && e.flag === 'absence') absentes.add(e.ressource);
  }
  const parts = SYNTHESE_FLAGS.map((flag) => ({ flag, heures: round1(Math.max(0, h[flag])) }));
  return {
    parts,
    total: round1(parts.reduce((s, p) => s + p.heures, 0)),
    jamaisImputes: absentes.size,
    planifiees: planifiees.size,
  };
}
