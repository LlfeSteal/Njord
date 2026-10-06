// État des filtres / tri / pagination du détail d'une version, porté par l'URL (partageable, survit au retour).
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PlanLinesQuery } from '../../api/client';

export const FILTER_KEYS = [
  'ct',
  'nom_prenom',
  'ligne_cout',
  'statut',
  'inactive',
  'squad_id',
  'date_from',
  'date_to',
  'q',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Record<FilterKey, string>;

export type SortKey = 'row_num' | 'ct' | 'nom_prenom' | 'charge_totale' | 'pps' | 'date_debut';
const SORT_KEYS: readonly SortKey[] = ['row_num', 'ct', 'nom_prenom', 'charge_totale', 'pps', 'date_debut'];
export type SortOrder = 'asc' | 'desc';

export const PAGE_SIZES = [50, 100, 200] as const;

type ParamKey = FilterKey | 'sort' | 'order' | 'limit' | 'page';
export type FiltersPatch = Partial<Record<ParamKey, string | null>>;

export function useLineFilters() {
  const [sp, setSp] = useSearchParams();

  const filters = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Filters,
    [sp],
  );
  const sortRaw = sp.get('sort') as SortKey | null;
  const sort: SortKey = sortRaw && SORT_KEYS.includes(sortRaw) ? sortRaw : 'row_num';
  const order: SortOrder = sp.get('order') === 'desc' ? 'desc' : 'asc';
  const limitN = Number(sp.get('limit'));
  const limit = (PAGE_SIZES as readonly number[]).includes(limitN) ? limitN : PAGE_SIZES[0];
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1));

  /** Met à jour l'URL ; toute modification hors `page` revient à la page 1. */
  const update = useCallback(
    (patch: FiltersPatch) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') n.delete(k);
            else n.set(k, v);
          }
          if (!('page' in patch)) n.delete('page');
          return n;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  /** Vide les filtres en conservant tri et taille de page. */
  const reset = useCallback(() => {
    setSp(
      (prev) => {
        const n = new URLSearchParams();
        for (const k of ['sort', 'order', 'limit']) {
          const v = prev.get(k);
          if (v) n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );
  }, [setSp]);

  /** Filtres + tri envoyés à l'API (sans pagination : sert aussi à l'export CSV). */
  const query: PlanLinesQuery = useMemo(
    () => ({
      ct: filters.ct || undefined,
      nom_prenom: filters.nom_prenom || undefined,
      ligne_cout: filters.ligne_cout || undefined,
      statut: filters.statut || undefined,
      inactive: filters.inactive === 'true' ? true : filters.inactive === 'false' ? false : undefined,
      squad_id: filters.squad_id || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      q: filters.q || undefined,
      sort,
      order,
    }),
    [filters, sort, order],
  );

  const activeCount = FILTER_KEYS.filter((k) => filters[k] !== '').length;

  return { filters, sort, order, limit, page, update, reset, query, activeCount };
}
