// Version « courante » d'un kind. Réalisé, provisions : l'active, sinon la plus récente non purgée.
// Plan : la dernière version de la timeline (date d'effet la plus récente, puis dernier import,
// DECISIONS n° 13) — un plan rétroactif importé en dernier n'est pas le plan courant.
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

/** Date d'effet d'une version de plan (periode_debut à défaut). */
export const dateEffet = (v: Version) => v.date_effet || v.periode_debut;

/** Ordre de la timeline du plan : date d'effet, puis date d'import, puis id. */
export function timelineCompare(a: Version, b: Version): number {
  return dateEffet(a).localeCompare(dateEffet(b)) || a.importee_le.localeCompare(b.importee_le) || a.id.localeCompare(b.id);
}

export function useCurrentVersion(kind: Kind) {
  const history = useVersionHistory(kind);
  const list = history.data ?? [];
  const version =
    kind === 'plan'
      ? list.reduce<Version | null>((last, v) => (!last || timelineCompare(v, last) > 0 ? v : last), null)
      : (list[0] ?? null);
  return { version, isLoading: history.isLoading, error: history.error };
}
