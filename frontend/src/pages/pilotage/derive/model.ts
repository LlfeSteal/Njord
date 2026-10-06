// Dérive du plan (/derive, DECISIONS n° 12) : état d'URL, lignes du tableau (par CT ou par personne),
// statuts et formats signés. Le calcul est côté serveur (GET /plan/compare) ; ici, mise en forme seulement.
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GlyphKind, StatusTone } from '../../../ui';
import type { DeriveStatut, PlanCompare, Version } from '../../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtHoursSigned } from '../../../lib/format';
import { cmp, fmtEurSigned } from '../shared/pilotage';

// ------------------------------------------------------------------ URL
export type DeriveVue = 'ct' | 'personne';

export interface DeriveUrl {
  from?: string;
  to?: string;
  vue: DeriveVue;
  /** Afficher les lignes inchangées. */
  tous: boolean;
}
export type DerivePatch = Partial<{ from: string | null; to: string | null; vue: DeriveVue; tous: boolean }>;

export function useDeriveUrl() {
  const [sp, setSp] = useSearchParams();
  const state = useMemo<DeriveUrl>(
    () => ({
      from: sp.get('from') || undefined,
      to: sp.get('to') || undefined,
      vue: sp.get('vue') === 'personne' ? 'personne' : 'ct',
      tous: sp.get('tous') === '1' || sp.get('tous') === 'true',
    }),
    [sp],
  );
  const update = useCallback(
    (patch: DerivePatch) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            // Valeurs par défaut absentes de l'URL : vue=ct, tous=false.
            if (v == null || v === '' || v === false || (k === 'vue' && v === 'ct')) n.delete(k);
            else n.set(k, v === true ? '1' : String(v));
          }
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );
  return { state, update };
}

// ------------------------------------------------------------------ Statuts
export const STATUT_META: Record<DeriveStatut, { label: string; glyph: GlyphKind; tone: StatusTone }> = {
  ajoute: { label: 'Ajouté', glyph: 'dot', tone: 'success' },
  retire: { label: 'Retiré', glyph: 'none', tone: 'neutral' },
  modifie: { label: 'Modifié', glyph: 'ring', tone: 'warning' },
  inchange: { label: 'Inchangé', glyph: 'success', tone: 'neutral' },
};

/** Libellé accordé : « Ajouté » (CT), « Ajoutée » (personne). */
export const statutLabel = (s: DeriveStatut, vue: DeriveVue) => `${STATUT_META[s].label}${vue === 'personne' ? 'e' : ''}`;

/** « 3 ajoutés » / « 1 retirée » : accord en genre (vue) et en nombre. */
export const countLabel = (n: number, s: DeriveStatut, vue: DeriveVue) =>
  `${n} ${statutLabel(s, vue).toLowerCase()}${n > 1 ? 's' : ''}`;

export type StatutCounts = Record<DeriveStatut, number>;

export function countStatuts(list: { statut: DeriveStatut }[]): StatutCounts {
  const c: StatutCounts = { ajoute: 0, retire: 0, modifie: 0, inchange: 0 };
  for (const r of list) c[r.statut] += 1;
  return c;
}

// ------------------------------------------------------------------ Lignes
/** « (non nominatif) » regroupe les lignes sans NOM Prénom : pas de lien vers le plan. */
export const NON_NOMINATIF = '(non nominatif)';

/** Ligne affichée : valeur principale (PPS par CT, charge par personne) et secondaire (l'autre). */
export interface DeriveRow {
  key: string;
  /** CT ou « NOM Prénom ». */
  name: string;
  /** Groupe Excel du CT (vue CT). */
  groupe?: string;
  from: number;
  to: number;
  delta: number;
  secFrom: number;
  secTo: number;
  secDelta: number;
  statut: DeriveStatut;
}

export function toRows(data: PlanCompare, vue: DeriveVue): DeriveRow[] {
  if (vue === 'ct')
    return data.par_ct.map((c) => ({
      key: c.ct,
      name: c.ct,
      groupe: c.groupe,
      from: c.pps_from,
      to: c.pps_to,
      delta: c.pps_to - c.pps_from,
      secFrom: c.charge_from,
      secTo: c.charge_to,
      secDelta: c.charge_to - c.charge_from,
      statut: c.statut,
    }));
  return data.par_personne.map((p) => ({
    key: p.nom_prenom,
    name: p.nom_prenom,
    from: p.charge_from,
    to: p.charge_to,
    delta: p.charge_to - p.charge_from,
    secFrom: p.pps_from,
    secTo: p.pps_to,
    secDelta: p.pps_to - p.pps_from,
    statut: p.statut,
  }));
}

// ------------------------------------------------------------------ Tri
export type SortKey = 'delta' | 'name';
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}
/** Défaut = ordre de l'API (|Δ| décroissant). */
export const DEFAULT_SORT: Sort = { key: 'delta', dir: 'desc' };

/** Même colonne : inverse ; nouvelle colonne : |Δ| décroissant, nom croissant. */
export const nextSort = (s: Sort, key: SortKey): Sort =>
  s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' };

/** Tri stable : |Δ| puis nom (Δ), ou nom seul. */
export function sortRows(rows: DeriveRow[], sort: Sort): DeriveRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) =>
    sort.key === 'name'
      ? sign * cmp(a.name, b.name)
      : sign * (Math.abs(a.delta) - Math.abs(b.delta)) || cmp(a.name, b.name),
  );
}

// ------------------------------------------------------------------ Formats
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** Variation relative signée « +4,2 % » ; null si la référence est nulle. */
export function fmtPctSigned(delta: number, base: number): string | null {
  if (!base) return null;
  const p = (delta / base) * 100;
  const s = p > 0.05 ? '+' : p < -0.05 ? '−' : '';
  return `${s}${nf1.format(Math.abs(p))} %`;
}

/** Formats de la valeur principale et secondaire selon la vue. */
export function formatsOf(vue: DeriveVue) {
  return vue === 'ct'
    ? { main: fmtEur, mainSigned: fmtEurSigned, sec: fmtHours, secSigned: fmtHoursSigned }
    : { main: fmtHours, mainSigned: fmtHoursSigned, sec: fmtEur, secSigned: fmtEurSigned };
}

// ------------------------------------------------------------------ Versions
/** Libellé d'une version dans les sélecteurs : « Plan démo · 01/09/2026 · active ». */
export function versionLabel(v: Version): string {
  return `${v.intitule} · ${fmtDate(v.importee_le)}${v.statut === 'active' ? ' · active' : ''}`;
}

/** Page du plan à ouvrir pour une ligne : version active → /plan, sinon /plan/:id (filtre dans l'URL). */
export function planLink(row: DeriveRow, vue: DeriveVue, data: PlanCompare): string | null {
  if (vue === 'personne' && row.name === NON_NOMINATIF) return null;
  // Un élément retiré n'existe que dans la référence.
  const v = row.statut === 'retire' ? data.from : data.to;
  const base = v.statut === 'active' ? '/plan' : `/plan/${v.id}`;
  const q = new URLSearchParams({ [vue === 'ct' ? 'ct' : 'nom_prenom']: row.name });
  return `${base}?${q.toString()}`;
}
