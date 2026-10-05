// État de l'onglet Analyse reflété dans l'URL (partage / drill-down).
// Paramètres d'analyse : plan, realise, from, to, inactifs. Filtres du tableau d'écarts : ct, ressource, flag (liste), squad.
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { AnalyseContext, AnalyseParams, Flag } from '../../api/types';
import type { EcartsCsvQuery } from '../../api/client';

export interface AnalyseUrlState {
  plan?: string;
  realise?: string;
  from?: string;
  to?: string;
  inactifs: boolean;
  ct?: string;
  ressource?: string;
  flags: Flag[];
  squad?: string;
}

export type UrlPatch = Partial<Record<'plan' | 'realise' | 'from' | 'to' | 'ct' | 'ressource' | 'squad', string | null>> & {
  inactifs?: boolean;
  flags?: Flag[];
};

const FLAGS: Flag[] = ['absence', 'hors_plan', 'sur_imputation', 'sous_imputation', 'conforme'];

export function readState(sp: URLSearchParams): AnalyseUrlState {
  const g = (k: string) => sp.get(k) || undefined;
  return {
    plan: g('plan'),
    realise: g('realise'),
    from: g('from'),
    to: g('to'),
    inactifs: sp.get('inactifs') === '1',
    ct: g('ct'),
    ressource: g('ressource'),
    flags: (sp.get('flag') ?? '').split(',').filter((f): f is Flag => (FLAGS as string[]).includes(f)),
    squad: g('squad'),
  };
}

export function applyPatch(sp: URLSearchParams, patch: UrlPatch): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const [k, val] of Object.entries(patch)) {
    if (k === 'inactifs') {
      if (val) next.set('inactifs', '1');
      else next.delete('inactifs');
    } else if (k === 'flags') {
      const list = val as Flag[];
      if (list.length) next.set('flag', list.join(','));
      else next.delete('flag');
    } else if (val == null || val === '') next.delete(k);
    else next.set(k, String(val));
  }
  return next;
}

export function useAnalyseUrl() {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => readState(sp), [sp]);
  const update = useCallback(
    (patch: UrlPatch) => setSp((prev) => applyPatch(prev, patch), { replace: true }),
    [setSp],
  );
  return { state, update, search: sp };
}

/** Paramètres effectifs envoyés à l'API (URL sinon défauts du contexte). */
export function resolveParams(ctx: AnalyseContext | undefined, s: AnalyseUrlState): AnalyseParams {
  let from = s.from ?? ctx?.default_week_from ?? undefined;
  let to = s.to ?? ctx?.default_week_to ?? undefined;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    plan_version_id: s.plan ?? ctx?.default_plan_id ?? undefined,
    realise_version_id: s.realise ?? ctx?.default_realise_id ?? undefined,
    week_from: from || undefined,
    week_to: to || undefined,
    include_inactive: s.inactifs,
  };
}

/** Requête de l'export CSV conformité = paramètres d'analyse + filtres du tableau. */
export function ecartsCsvQuery(params: AnalyseParams, s: AnalyseUrlState): EcartsCsvQuery {
  return {
    ...params,
    include_inactive: params.include_inactive || undefined,
    ct: s.ct,
    ressource: s.ressource,
    flag: s.flags.length ? s.flags.join(',') : undefined,
    squad_id: s.squad,
  };
}

/** Drill-down : bascule sur l'onglet Écarts avec filtres pré-remplis (les paramètres d'analyse sont conservés). */
export function useDrillDown() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (f: { ct?: string; ressource?: string; flags?: Flag[] }) => {
      const sp = applyPatch(new URLSearchParams(location.search), {
        ct: f.ct ?? null,
        ressource: f.ressource ?? null,
        squad: null,
        flags: f.flags ?? [],
      });
      const q = sp.toString();
      navigate({ pathname: '/analyse/ecarts', search: q ? `?${q}` : '' });
    },
    [navigate, location.search],
  );
}

/** Navigation vers un sous-onglet en conservant la query string (chemin + recherche, en chaîne). */
export function useTabLink() {
  const location = useLocation();
  return useCallback(
    (tab: string) => `${tab ? `/analyse/${tab}` : '/analyse'}${location.search}`,
    [location.search],
  );
}
