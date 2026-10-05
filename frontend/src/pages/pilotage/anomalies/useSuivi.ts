// Traitement d'une anomalie : traitée, ignorée, rouverte, ou alias confirmé puis traitée.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../../ui';
import { analyseApi } from '../../../api/client';
import type { Anomalie, AnomalieStatut, AnomalieSuivi } from '../../../api/types';
import { loadOperateur } from '../../../components/lifecycle/lifecycleUtils';

export type SuiviAction = 'traitee' | 'ignoree' | 'rouvrir' | 'alias';

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
  alias: 'Alias confirmé, anomalie traitée',
};

export function useSuivi(onApplied: (vars: SuiviVars, override: SuiviOverride) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ a, action, commentaire }: SuiviVars): Promise<AnomalieSuivi | null> => {
      if (action === 'rouvrir') {
        await analyseApi.deleteSuivi(a.key);
        return null;
      }
      if (action === 'alias') {
        if (!a.personne_id || !a.nom_realise) throw new Error('Personne ou nom réalisé manquant.');
        await analyseApi.confirmAlias(a.personne_id, a.nom_realise);
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
      if (vars.action === 'alias') qc.invalidateQueries({ queryKey: ['personnes'] });
    },
    onError: (err, vars) =>
      toast({
        tone: 'error',
        title: vars.action === 'alias' ? "Confirmation de l'alias impossible" : 'Action impossible',
        message: err instanceof Error ? err.message : String(err),
      }),
  });
}
