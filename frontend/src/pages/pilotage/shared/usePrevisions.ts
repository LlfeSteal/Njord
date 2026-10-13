// Prévisions des vues temporelles (Vue d'ensemble, Budget, Prévisions) selon le filtre d'année (DECISIONS n° 24).
// « Tout » = `AnalyseResult.previsions` ; une année N = `GET /analyse/previsions?annee=N` (mêmes paramètres que
// /analyse), mis en cache sous ['analyse', …] : invalidé avec l'analyse. Le choix est partagé par les trois pages
// (sélection d'analyse, mémorisée par poste).
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyseApi } from '../../../api/client';
import type { Previsions } from '../../../api/types';
import { useAnalyse } from './context';
import { forecastFrom } from './pilotage';

export interface UsePrevisions {
  /** Prévisions exploitables de l'année choisie (Tout : celles de l'analyse) ; null tant qu'elles manquent. */
  previsions: Previsions | null;
  /** Premier calcul de l'année choisie en cours (aucune donnée de cette année encore). */
  isLoading: boolean;
  /** Calcul en cours (premier ou recalcul). */
  isFetching: boolean;
  /** Les chiffres affichés sont ceux de la sélection précédente pendant le calcul (à estomper). */
  isPlaceholder: boolean;
  /** Échec du calcul de l'année choisie (null pour Tout : l'erreur est celle de l'analyse). */
  error: unknown;
  /** Année effective (0 = Tout) : une année mémorisée qui n'est plus proposée revient à Tout. */
  annee: number;
  /** Années proposées après « Tout » (`previsions.annees` du résultat Tout). */
  annees: number[];
  setAnnee: (annee: number) => void;
}

export function usePrevisions(): UsePrevisions {
  const { selection, setSelection, params, ready, result } = useAnalyse();
  const tout = result.data?.previsions;
  const annees = tout?.annees ?? [];
  const stored = selection.annee ?? 0;
  const annee = stored > 0 && annees.includes(stored) ? stored : 0;

  const year = useQuery({
    queryKey: ['analyse', 'previsions', params, annee] as const,
    queryFn: () => analyseApi.previsions(params!, annee),
    enabled: ready && !!params && annee > 0 && !!tout,
    // Garde l'année précédente pendant le calcul ; au premier passage depuis Tout, les prévisions Tout (estompées) :
    // leurs mots restent les leurs (les libellés lisent `previsions.annee`, pas le choix en cours).
    placeholderData: (prev) => prev ?? tout,
  });

  const setAnnee = useCallback((n: number) => setSelection({ annee: n > 0 ? n : undefined }), [setSelection]);

  if (annee === 0)
    return {
      previsions: forecastFrom(tout),
      isLoading: false,
      isFetching: false,
      isPlaceholder: false,
      error: null,
      annee,
      annees,
      setAnnee,
    };
  return {
    previsions: forecastFrom(year.data),
    isLoading: year.isLoading,
    isFetching: year.isFetching,
    isPlaceholder: year.isPlaceholderData,
    error: year.error,
    annee,
    annees,
    setAnnee,
  };
}
