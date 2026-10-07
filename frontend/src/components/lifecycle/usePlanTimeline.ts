// Timeline du plan de charge (DECISIONS n° 13) : fenêtres « en vigueur » des versions de plan.
import { useQuery } from '@tanstack/react-query';
import { analyseApi } from '../../api/client';
import type { PlanTimeline, TimelineWindow } from '../../api/types';
import { qk } from '../../lib/queryKeys';
import { fmtRange } from './lifecycleUtils';

/** Timeline connue à la date de `planVersionId` (défaut : la plus récente). */
export function usePlanTimeline(planVersionId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.planTimeline(planVersionId),
    queryFn: () => analyseApi.planTimeline(planVersionId),
    enabled,
  });
}

export function windowOf(t: PlanTimeline | undefined, versionId: string): TimelineWindow | undefined {
  return t?.windows.find((w) => w.version_id === versionId);
}

/** Fenêtre vide ('' / '') : la version est entièrement remplacée par un import plus récent. */
export const isReplaced = (w: TimelineWindow) => !w.debut || !w.fin;

/** « 01/10 → 31/10/2026 », « Remplacée », ou '' si la version est absente de la timeline. */
export function fmtWindow(w: TimelineWindow | undefined): string {
  if (!w) return '';
  return isReplaced(w) ? 'Remplacée' : fmtRange(w.debut, w.fin);
}
