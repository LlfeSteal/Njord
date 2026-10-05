// Version « courante » d'un kind : l'active, sinon la plus récente non purgée.
// Même requête (et même clé) que le cycle de vie et le sélecteur de version.
import { useQuery } from '@tanstack/react-query';
import { versionsApi } from '../../api/client';
import type { Kind, Version } from '../../api/types';
import { qk } from '../../lib/queryKeys';

/** Liste des versions non purgées : l'active d'abord, puis par date d'import décroissante. */
export function useVersionHistory(kind: Kind) {
  return useQuery({
    queryKey: [...qk.versions(kind), { includePurged: false }],
    queryFn: () => versionsApi.list(kind, false),
    select: (list: Version[]) =>
      [...list]
        .filter((v) => v.statut !== 'purgee')
        .sort((a, b) => Number(b.statut === 'active') - Number(a.statut === 'active') || b.importee_le.localeCompare(a.importee_le)),
  });
}

export function useCurrentVersion(kind: Kind) {
  const history = useVersionHistory(kind);
  return { version: history.data?.[0] ?? null, isLoading: history.isLoading, error: history.error };
}
