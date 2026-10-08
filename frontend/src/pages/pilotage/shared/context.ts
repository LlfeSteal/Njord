// Contexte d'analyse partagé par les pages Pilotage (et le badge « Anomalies » de la barre latérale).
// CONTRAT FIGÉ — intégrateur. Sélection (versions × période × inactifs) mémorisée par poste
// (localStorage `njord.analyse.selection`) et partagée en direct entre composants ; les filtres
// propres à une page (ct, ressource, flag…) restent dans l'URL de la page.
import { useCallback, useSyncExternalStore } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { analyseApi } from '../../../api/client';
import type { AnalyseContext, AnalyseParams, AnalyseResult } from '../../../api/types';
import { qk } from '../../../lib/queryKeys';

export interface AnalyseSelection {
  /** Version de plan choisie ; absente = active (défaut du contexte). */
  plan?: string;
  realise?: string;
  /** Version de provisions (facultative, DECISIONS n° 16) ; absente = active (défaut du contexte, peut être nulle). */
  provision?: string;
  /** Semaines ISO "2026-W36" ; absentes = défauts du contexte. */
  from?: string;
  to?: string;
  inactifs: boolean;
}

const KEY = 'njord.analyse.selection';
const EMPTY: AnalyseSelection = { inactifs: false };

function read(): AnalyseSelection {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<AnalyseSelection>;
    return {
      plan: v.plan || undefined,
      realise: v.realise || undefined,
      provision: v.provision || undefined,
      from: v.from || undefined,
      to: v.to || undefined,
      inactifs: !!v.inactifs,
    };
  } catch {
    return EMPTY;
  }
}

let current: AnalyseSelection = read();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => current;

function write(next: AnalyseSelection) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : sélection gardée en mémoire */
  }
  listeners.forEach((l) => l());
}

/** Sélection courante + mise à jour partielle (`undefined` = revenir au défaut). */
export function useAnalyseSelection(): [AnalyseSelection, (patch: Partial<AnalyseSelection>) => void] {
  const sel = useSyncExternalStore(subscribe, snapshot, snapshot);
  const update = useCallback((patch: Partial<AnalyseSelection>) => write({ ...current, ...patch }), []);
  return [sel, update];
}

/** Paramètres effectifs envoyés à l'API (sélection sinon défauts du contexte). */
export function resolveParams(ctx: AnalyseContext | undefined, s: AnalyseSelection): AnalyseParams {
  let from = s.from ?? ctx?.default_week_from ?? undefined;
  let to = s.to ?? ctx?.default_week_to ?? undefined;
  if (from && to && from > to) [from, to] = [to, from];
  // Provisions choisies mais disparues (purgées) → retour au défaut plutôt qu'un 404.
  const provisions = ctx?.provision_versions ?? [];
  const provision = s.provision && provisions.some((v) => v.id === s.provision && v.statut !== 'purgee') ? s.provision : undefined;
  return {
    plan_version_id: s.plan ?? ctx?.default_plan_id ?? undefined,
    realise_version_id: s.realise ?? ctx?.default_realise_id ?? undefined,
    provision_version_id: provision ?? ctx?.default_provision_id ?? undefined,
    week_from: from || undefined,
    week_to: to || undefined,
    include_inactive: s.inactifs,
  };
}

export interface UseAnalyse {
  selection: AnalyseSelection;
  setSelection: (patch: Partial<AnalyseSelection>) => void;
  context: UseQueryResult<AnalyseContext>;
  /** Paramètres effectifs (null tant que le contexte n'est pas chargé). */
  params: AnalyseParams | null;
  /** true quand un plan et un réalisé sont disponibles (les provisions sont facultatives). */
  ready: boolean;
  result: UseQueryResult<AnalyseResult>;
}

/** Contexte + résultat d'analyse (requêtes partagées via TanStack Query : un seul calcul par sélection). */
export function useAnalyse(): UseAnalyse {
  const [selection, setSelection] = useAnalyseSelection();
  const context = useQuery({ queryKey: qk.analyseContext(), queryFn: analyseApi.context });
  const params = context.data ? resolveParams(context.data, selection) : null;
  const ready = !!params?.plan_version_id && !!params.realise_version_id;
  const result = useQuery({
    queryKey: qk.analyse(params),
    queryFn: () => analyseApi.run(params!),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  return { selection, setSelection, context, params, ready, result };
}
