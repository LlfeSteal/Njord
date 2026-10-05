// Hooks et utilitaires des référentiels (personnes, squads), réutilisés par l'onglet Plan de charge.
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import type { Personne, Squad } from '../../api/types';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../ui';

/** Clé d'une fiche personne (sous ['personnes'] pour être invalidée avec la liste). */
export const personneKey = (id: string) => ['personnes', 'id', id] as const;

export function notifyError(e: unknown, title = 'Erreur') {
  toast({ tone: 'error', title, message: e instanceof Error ? e.message : String(e) });
}

export function notifySuccess(message: string) {
  toast({ tone: 'success', title: message });
}

/** Après toute mutation de référentiel : la liste des personnes et l'analyse (correspondances) sont obsolètes. */
export function invalidateReferentiels(qc: QueryClient, opts: { planLines?: boolean; squads?: boolean } = {}) {
  void qc.invalidateQueries({ queryKey: ['personnes'] });
  void qc.invalidateQueries({ queryKey: ['analyse'] });
  if (opts.squads) void qc.invalidateQueries({ queryKey: qk.squads() });
  if (opts.planLines) void qc.invalidateQueries({ queryKey: ['plan-lines'] });
}

/** Mutation sur une fiche personne : met le cache de la fiche à jour, invalide, notifie. */
export function usePersonneMutation<V>(
  mutationFn: (v: V) => Promise<Personne>,
  successMessage?: (p: Personne, v: V) => string | undefined,
  onDone?: (p: Personne, v: V) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (p, v) => {
      qc.setQueryData(personneKey(p.id), p);
      invalidateReferentiels(qc);
      const msg = successMessage?.(p, v);
      if (msg) notifySuccess(msg);
      onDone?.(p, v);
    },
    onError: (e) => notifyError(e),
  });
}

/** Approximation front de la normalisation backend (majuscules, sans accents ni ponctuation, tokens triés). Indicatif. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Recherche insensible à la casse et aux accents. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ------------------------------------------------------------------ Squads

export interface SquadNode {
  squad: Squad;
  depth: number;
  /** Chemin « Parent > Enfant ». */
  path: string;
  childCount: number;
}

function childrenMap(squads: Squad[]): Map<string | null, Squad[]> {
  const ids = new Set(squads.map((s) => s.id));
  const children = new Map<string | null, Squad[]>();
  for (const s of squads) {
    const parent = s.parent_id && s.parent_id !== s.id && ids.has(s.parent_id) ? s.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(s);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.nom_canonique.localeCompare(b.nom_canonique, 'fr'));
  return children;
}

/** Aplatis la hiérarchie (parent puis enfants, triés par nom), robuste aux cycles. */
export function flattenSquads(squads: Squad[]): SquadNode[] {
  const children = childrenMap(squads);
  const out: SquadNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const s of children.get(parent) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const path = prefix ? `${prefix} > ${s.nom_canonique}` : s.nom_canonique;
      out.push({ squad: s, depth, path, childCount: children.get(s.id)?.length ?? 0 });
      walk(s.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  // Squads pris dans un cycle de parenté : affichés en racine.
  for (const s of squads) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ squad: s, depth: 0, path: s.nom_canonique, childCount: children.get(s.id)?.length ?? 0 });
    walk(s.id, 1, s.nom_canonique);
  }
  return out;
}

/** Identifiants des descendants d'un squad (pour interdire un parent qui créerait un cycle). */
export function descendantIds(squads: Squad[], id: string): Set<string> {
  const children = childrenMap(squads);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of children.get(cur) ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function useSquads() {
  return useQuery({ queryKey: qk.squads(), queryFn: referentielApi.squads, staleTime: 60_000 });
}

/** Squads + index : nœuds aplatis, accès par id, options de Select (libellé = chemin). */
export function useSquadIndex() {
  const query = useSquads();
  const index = useMemo(() => {
    const nodes = flattenSquads(query.data ?? []);
    const byId = new Map(nodes.map((n) => [n.squad.id, n]));
    const options = nodes.map((n) => ({ value: n.squad.id, label: n.path }));
    const label = (id: string | null | undefined) => (id ? (byId.get(id)?.path ?? id) : '');
    const name = (id: string | null | undefined) => (id ? (byId.get(id)?.squad.nom_canonique ?? id) : '');
    return { nodes, byId, options, label, name };
  }, [query.data]);
  return { query, ...index };
}
