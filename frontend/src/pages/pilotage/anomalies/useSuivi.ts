// Traitement d'une anomalie : traitée, ignorée ou rouverte.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../../ui';
import { analyseApi } from '../../../api/client';
import type { Anomalie, AnomalieStatut, AnomalieSuivi } from '../../../api/types';
import { loadOperateur } from '../../../components/lifecycle/lifecycleUtils';

export type SuiviAction = 'traitee' | 'ignoree' | 'rouvrir';

export interface SuiviVars {
  a: Anomalie;
  action: SuiviAction;
  commentaire: string;
  /** Anomalie à ouvrir ensuite (null : aucune ; absent : garder la sélection). */
  next?: string | null;
}

/** Statut appliqué localement en attendant le recalcul de l'analyse. */
export interface SuiviOverride {
  statut: AnomalieStatut;
  suivi?: AnomalieSuivi;
  /** Horodatage : ignoré dès qu'un résultat plus récent arrive. */
  at: number;
}

const TOAST: Record<SuiviAction, string> = {
  traitee: 'Anomalie traitée',
  ignoree: 'Anomalie ignorée',
  rouvrir: 'Anomalie rouverte',
};

export function useSuivi(onApplied: (vars: SuiviVars, override: SuiviOverride) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ a, action, commentaire }: SuiviVars): Promise<AnomalieSuivi | null> => {
      if (action === 'rouvrir') {
        await analyseApi.deleteSuivi(a.key);
        return null;
      }
      return analyseApi.putSuivi({
        key: a.key,
        fingerprint: a.fingerprint,
        statut: action === 'ignoree' ? 'ignoree' : 'traitee',
        commentaire: commentaire.trim(),
        operateur: loadOperateur() || undefined,
      });
    },
    onSuccess: (suivi, vars) => {
      toast({ tone: 'success', title: TOAST[vars.action], message: vars.a.titre });
      onApplied(vars, { statut: suivi ? suivi.statut : 'a_traiter', suivi: suivi ?? undefined, at: Date.now() });
      qc.invalidateQueries({ queryKey: ['analyse'] });
    },
    onError: (err) =>
      toast({
        tone: 'error',
        title: 'Action impossible',
        message: err instanceof Error ? err.message : String(err),
      }),
  });
}
