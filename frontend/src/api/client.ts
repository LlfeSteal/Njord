// Client HTTP typé de l'API Njord (contrat : docs/API.md).
import type {
  AnalyseContext,
  AnalyseParams,
  AnalyseResult,
  AnomalieSuivi,
  AnomalieSuiviInput,
  AuditEntry,
  Facets,
  ImportReport,
  ImportResult,
  Kind,
  PlanCompare,
  Personne,
  PlanLinesPage,
  PlanTimeline,
  ProvisionLinesPage,
  RealiseEntriesPage,
  Settings,
  Squad,
  Version,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE = '/api';

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    let code = 'http_' + res.status;
    let message = res.statusText || 'Erreur';
    try {
      const j = await res.json();
      if (j?.error) {
        code = j.error.code;
        message = j.error.message;
      }
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string, q?: Query) => request<T>('GET', path + qs(q));
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
export const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body);
export const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
export const del = <T>(path: string) => request<T>('DELETE', path);

/** URL absolue d'un export CSV (à utiliser dans un <a href download>). */
export const csvUrl = (path: string, q?: Query) => BASE + path + qs(q);

// ------------------------------------------------------------------ Versions (plan & réalisé, symétriques)
export const versionsApi = {
  list: (kind: Kind, includePurged = false) =>
    get<Version[]>(`/${kind}/versions`, { include_purged: includePurged }),
  get: (kind: Kind, id: string) => get<Version>(`/${kind}/versions/${id}`),
  archive: (kind: Kind, id: string, operateur?: string) =>
    post<Version>(`/${kind}/versions/${id}/archive`, { operateur }),
  reactivate: (kind: Kind, id: string, operateur?: string) =>
    post<Version>(`/${kind}/versions/${id}/reactivate`, { operateur }),
  purge: (kind: Kind, id: string, confirm_intitule: string, operateur?: string) =>
    post<Version>(`/${kind}/versions/${id}/purge`, { confirm_intitule, operateur }),
  facets: (kind: Kind, id: string) => get<Facets>(`/${kind}/versions/${id}/facets`),
  preview: (kind: Kind, file: File, intitule?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (intitule) fd.append('intitule', intitule);
    return post<ImportReport>(`/${kind}/imports/preview`, fd);
  },
  commit: (
    kind: Kind,
    file: File,
    opts: { intitule?: string; importeur?: string; archive_active: boolean; date_effet?: string },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.intitule) fd.append('intitule', opts.intitule);
    if (opts.importeur) fd.append('importeur', opts.importeur);
    if (opts.date_effet) fd.append('date_effet', opts.date_effet);
    fd.append('archive_active', String(opts.archive_active));
    return post<ImportResult>(`/${kind}/imports`, fd);
  },
};

// ------------------------------------------------------------------ Plan
export interface PlanLinesQuery extends Query {
  ct?: string;
  nom_prenom?: string;
  ligne_cout?: string;
  statut?: string; // ok | warn | drop
  inactive?: boolean;
  squad_id?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  sort?: string; // row_num | ct | nom_prenom | charge_totale | pps | date_debut
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export const planApi = {
  lines: (id: string, q: PlanLinesQuery) => get<PlanLinesPage>(`/plan/versions/${id}/lines`, q),
  linesCsvUrl: (id: string, q: PlanLinesQuery) => csvUrl(`/plan/versions/${id}/lines.csv`, q),
  /** Dérive : `from` = référence (défaut : plus ancienne version non purgée), `to` = défaut : version active. */
  compare: (from?: string, to?: string) => get<PlanCompare>('/plan/compare', { from, to }),
  /** Change la date d'effet d'une version (timeline, DECISIONS n° 13). */
  setDateEffet: (id: string, date_effet: string, operateur?: string) =>
    patch<Version>(`/plan/versions/${id}`, { date_effet, operateur }),
};

// ------------------------------------------------------------------ Réalisé
export interface RealiseEntriesQuery extends Query {
  entite?: string;
  activite?: string;
  trigramme?: string;
  tg?: string;
  wp?: string;
  categorie?: string;
  type?: string;
  lot?: string;
  statut?: string;
  date_from?: string;
  date_to?: string;
  montant_min?: number;
  montant_max?: number;
  q?: string;
  search_description?: boolean; // inclure DESCRIPTION dans la recherche plein-texte
  mask_sensitive?: boolean; // masque nom, matricule, facture, commande, description
  sort?: 'date_depense' | 'total_eur' | 'tg' | 'row_num';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export const realiseApi = {
  entries: (id: string, q: RealiseEntriesQuery) => get<RealiseEntriesPage>(`/realise/versions/${id}/entries`, q),
  entriesCsvUrl: (id: string, q: RealiseEntriesQuery) => csvUrl(`/realise/versions/${id}/entries.csv`, q),
};

// ------------------------------------------------------------------ Provisions (DECISIONS n° 16)
export interface ProvisionLinesQuery extends Query {
  ct?: string;
  ligne_cout?: string;
  groupe?: string;
  statut?: string;
  q?: string; // CT, libellé, groupe (insensible aux accents)
  sort?: 'ct' | 'montant' | 'date_debut' | 'row_num';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
export const provisionApi = {
  lines: (id: string, q: ProvisionLinesQuery) => get<ProvisionLinesPage>(`/provision/versions/${id}/lines`, q),
  linesCsvUrl: (id: string, q: ProvisionLinesQuery) => csvUrl(`/provision/versions/${id}/lines.csv`, q),
};

// ------------------------------------------------------------------ Référentiels
export const referentielApi = {
  personnes: (q?: string) => get<Personne[]>('/personnes', { q }),
  personne: (id: string) => get<Personne>(`/personnes/${id}`),
  updatePersonne: (id: string, body: Partial<Pick<Personne, 'statut' | 'squad_id'>>) =>
    patch<Personne>(`/personnes/${id}`, body),
  squads: () => get<Squad[]>('/squads'),
  createSquad: (body: { nom_canonique: string; entite_rattachee?: string; parent_id?: string | null }) =>
    post<Squad>('/squads', body),
  updateSquad: (id: string, body: Partial<Pick<Squad, 'nom_canonique' | 'entite_rattachee' | 'parent_id'>>) =>
    patch<Squad>(`/squads/${id}`, body),
  addSquadAlias: (id: string, alias: string) => post<Squad>(`/squads/${id}/alias`, { alias }),
};

// ------------------------------------------------------------------ Paramètres & journal
export const settingsApi = {
  get: () => get<Settings>('/settings'),
  put: (s: Settings) => put<Settings>('/settings', s),
  audit: (objet_type?: string, limit = 200) => get<AuditEntry[]>('/audit', { objet_type, limit }),
};

// ------------------------------------------------------------------ Analyse
export interface EcartsCsvQuery extends AnalyseParams, Query {
  ct?: string;
  ressource?: string;
  flag?: string;
  squad_id?: string;
}
export const analyseApi = {
  context: () => get<AnalyseContext>('/analyse/context'),
  run: (p: AnalyseParams) => get<AnalyseResult>('/analyse', p as Query),
  ecartsCsvUrl: (q: EcartsCsvQuery) => csvUrl('/analyse/ecarts.csv', q),
  realiseEnrichiCsvUrl: (p: AnalyseParams & { mask_sensitive?: boolean }) =>
    csvUrl('/analyse/realise-enrichi.csv', p as Query),
  /** Timeline du plan connue à la date de `plan_version_id` (défaut : dernière version). */
  planTimeline: (plan_version_id?: string) => get<PlanTimeline>('/analyse/plan-timeline', { plan_version_id }),
  planTimelineCsvUrl: (plan_version_id?: string) => csvUrl('/analyse/plan-timeline.csv', { plan_version_id }),
  /** Marque une anomalie traitée / ignorée (upsert). */
  putSuivi: (body: AnomalieSuiviInput) => put<AnomalieSuivi>('/analyse/anomalies/suivi', body),
  /** Rouvre une anomalie (supprime son suivi). */
  deleteSuivi: (key: string) => del<void>('/analyse/anomalies/suivi' + qs({ key })),
};
