// Clés TanStack Query partagées : invalider ['versions'] + ['analyse'] après import/archivage/purge.
import type { Kind } from '../api/types';

export const qk = {
  versions: (kind: Kind) => ['versions', kind] as const,
  version: (kind: Kind, id: string) => ['versions', kind, id] as const,
  facets: (kind: Kind, id: string) => ['facets', kind, id] as const,
  planLines: (id: string, q: unknown) => ['plan-lines', id, q] as const,
  realiseEntries: (id: string, q: unknown) => ['realise-entries', id, q] as const,
  personnes: (q?: string) => ['personnes', q ?? ''] as const,
  squads: () => ['squads'] as const,
  settings: () => ['settings'] as const,
  audit: (objetType?: string) => ['audit', objetType ?? ''] as const,
  analyseContext: () => ['analyse', 'context'] as const,
  analyse: (p: unknown) => ['analyse', 'result', p] as const,
  /** Timeline du plan (sous ['analyse'] : invalidée avec l'analyse) ; '' = timeline la plus récente. */
  planTimeline: (planVersionId?: string) => ['analyse', 'plan-timeline', planVersionId ?? ''] as const,
  planTimelineAll: () => ['analyse', 'plan-timeline'] as const,
};
