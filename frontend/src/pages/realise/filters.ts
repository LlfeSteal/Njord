// État des filtres des écritures du réalisé.

export type FacetKey = 'entite' | 'activite' | 'trigramme' | 'tg' | 'wp' | 'categorie' | 'type' | 'lot' | 'statut';

export interface EntriesFilterState {
  entite: string | null;
  activite: string | null;
  trigramme: string | null;
  tg: string | null;
  wp: string | null;
  categorie: string | null;
  type: string | null;
  lot: string | null;
  statut: string | null;
  date_from: string;
  date_to: string;
  montant_min: number | string;
  montant_max: number | string;
}

export const EMPTY_FILTERS: EntriesFilterState = {
  entite: null,
  activite: null,
  trigramme: null,
  tg: null,
  wp: null,
  categorie: null,
  type: null,
  lot: null,
  statut: null,
  date_from: '',
  date_to: '',
  montant_min: '',
  montant_max: '',
};

export function countActiveFilters(f: EntriesFilterState): number {
  return (Object.keys(f) as (keyof EntriesFilterState)[]).filter((k) => f[k] !== null && f[k] !== '').length;
}
