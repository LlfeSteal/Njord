// États communs des pages Pilotage avant l'affichage du résultat (aussi utilisé par la page Écarts).
import { Button, EmptyState, Group, SkeletonRows } from '../../../ui';
import { ApiError } from '../../../api/client';
import ErrorAlert from '../../../components/ErrorAlert';
import type { UseAnalyse } from '../shared/context';

/**
 * Contexte en chargement, analyse impossible, erreur ou calcul en cours ;
 * rien quand le résultat est disponible (l'appelant affiche alors son contenu).
 */
export function AnalyseGate({ analyse }: { analyse: UseAnalyse }) {
  const { context, ready, result } = analyse;
  if (context.isLoading) return <SkeletonRows rows={8} />;
  if (context.error) return <ErrorAlert error={context.error} title="Impossible de charger le contexte d'analyse" />;
  if (!ready)
    return (
      <EmptyState
        title="Importez un plan de charge et un réalisé"
        action={
          <Group gap={8} justify="center">
            <Button to="/plan">Plan de charge</Button>
            <Button to="/realise">Réalisé</Button>
          </Group>
        }
      >
        {context.data?.message ||
          "L'analyse croise la timeline du plan de charge (toutes ses versions, chacune à partir de sa date d'effet) et une version de réalisé."}
      </EmptyState>
    );
  if (result.error) {
    if (result.error instanceof ApiError && result.error.status === 409)
      return <EmptyState title="Analyse impossible">{result.error.message}</EmptyState>;
    return <ErrorAlert error={result.error} title="Échec du calcul de l'analyse" />;
  }
  if (!result.data) return <SkeletonRows rows={8} />;
  return null;
}
