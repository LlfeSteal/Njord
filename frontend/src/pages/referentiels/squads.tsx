// Page « Squads » (/squads) : arborescence repliable ; détail dans l'inspecteur (?squad=<id>).
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  Inspector,
  InspectorSection,
  KeyValue,
  Link,
  Page,
  PageToolbar,
  Pill,
  SearchField,
  SkeletonRows,
  Table,
  Text,
} from '../../ui';
import { IconChevronRight, IconPencil, IconPlus, IconUsers } from '../../ui/Icons';
import { referentielApi } from '../../api/client';
import type { Personne } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { fold, useSquadIndex, type SquadNode } from './hooks';
import SquadModal from './SquadModal';
import './referentiels.css';

export default function SquadsPage() {
  const { query, nodes, byId, name } = useSquadIndex();
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('squad');
  const [filter, setFilter] = useState('');
  /** Squads repliées (leurs descendants sont masqués). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  /** null = fermé, 'new' = création, sinon id du squad édité. */
  const [editing, setEditing] = useState<string | null>(null);

  // Personnes, pour le décompte par squad et la liste de l'inspecteur.
  const personnesQ = useQuery({ queryKey: qk.personnes(''), queryFn: () => referentielApi.personnes() });
  const bySquad = useMemo(() => {
    const m = new Map<string, Personne[]>();
    for (const p of personnesQ.data ?? []) {
      if (!p.squad_id) continue;
      m.set(p.squad_id, [...(m.get(p.squad_id) ?? []), p]);
    }
    return m;
  }, [personnesQ.data]);

  const f = fold(filter.trim());
  const rows = useMemo(() => {
    if (f)
      return nodes.filter(
        (n) =>
          fold(n.path).includes(f) ||
          fold(n.squad.entite_rattachee ?? '').includes(f) ||
          (n.squad.alias ?? []).some((a) => fold(a).includes(f)),
      );
    // Sans recherche : on masque les descendants des squads repliées (parcours en préordre).
    const out: SquadNode[] = [];
    let hideBelow: number | null = null;
    for (const n of nodes) {
      if (hideBelow !== null && n.depth > hideBelow) continue;
      hideBelow = null;
      out.push(n);
      if (n.childCount > 0 && collapsed.has(n.squad.id)) hideBelow = n.depth;
    }
    return out;
  }, [nodes, f, collapsed]);

  const setOpen = (id: string | null) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set('squad', id);
      else n.delete('squad');
      return n;
    });

  const toggle = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onRowKey = (e: KeyboardEvent, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(id);
    }
  };

  const total = query.data?.length;
  const opened = openId ? byId.get(openId) : undefined;

  const toolbar = (
    <PageToolbar
      title="Squads"
      subtitle={total == null ? undefined : `${total} squad${total > 1 ? 's' : ''}`}
      actions={
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditing('new')}>
          Nouvelle squad
        </Button>
      }
      bottom={
        <SearchField aria-label="Filtrer les squads" placeholder="Nom, alias, entité…" value={filter} onChange={setFilter} width={280} />
      }
    />
  );

  return (
    <Page
      toolbar={toolbar}
      inspector={
        <SquadInspector
          node={opened}
          parentName={name(opened?.squad.parent_id)}
          personnes={opened ? (bySquad.get(opened.squad.id) ?? []) : []}
          personnesLoading={personnesQ.isLoading}
          onClose={() => setOpen(null)}
          onEdit={(id) => setEditing(id)}
        />
      }
    >
      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconUsers size={40} />} title={nodes.length ? 'Aucun résultat' : 'Aucune squad'}>
          {nodes.length ? 'Aucune squad ne correspond au filtre.' : 'Aucune squad pour le moment.'}
        </EmptyState>
      ) : (
        <Table hover minWidth={560}>
          <thead>
            <tr>
              <th style={{ width: '45%' }}>Nom</th>
              <th style={{ width: '35%' }}>Parent</th>
              <th data-align="right" style={{ width: 96 }}>
                Personnes
              </th>
              <th data-align="right" style={{ width: 72 }}>
                Alias
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ squad: s, depth, path, childCount }) => {
              const parent = name(s.parent_id);
              const expanded = !collapsed.has(s.id);
              return (
                <tr
                  key={s.id}
                  data-clickable
                  data-selected={s.id === openId || undefined}
                  tabIndex={0}
                  onClick={() => setOpen(s.id)}
                  onKeyDown={(e) => onRowKey(e, s.id)}
                >
                  <td className="ref-ellipsis" title={path}>
                    {/* Indentation 16 px par niveau (arborescence masquée pendant une recherche). */}
                    <div className="ref-tree" style={{ paddingLeft: f ? 0 : depth * 16 }}>
                      {!f && childCount > 0 ? (
                        <button
                          type="button"
                          className="ref-tree__toggle"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Replier' : 'Déplier'} ${s.nom_canonique}`}
                          onClick={(e) => toggle(e, s.id)}
                        >
                          <IconChevronRight size={12} stroke={2.2} />
                        </button>
                      ) : (
                        !f && <span className="ref-tree__spacer" />
                      )}
                      <span className={depth === 0 ? 'ref-tree__label ref-name' : 'ref-tree__label'}>{s.nom_canonique}</span>
                    </div>
                  </td>
                  <td className={parent ? 'ref-ellipsis' : 'ref-ellipsis ref-muted'}>{parent || '—'}</td>
                  <td data-align="right">{bySquad.get(s.id)?.length ?? 0}</td>
                  <td data-align="right">{s.alias?.length ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <SquadModal
        editing={editing}
        squads={query.data ?? []}
        onClose={() => setEditing(null)}
        onCreated={(s) => setEditing(s.id)}
      />
    </Page>
  );
}

// ------------------------------------------------------------------ Inspecteur

function SquadInspector({
  node,
  parentName,
  personnes,
  personnesLoading,
  onClose,
  onEdit,
}: {
  node: SquadNode | undefined;
  parentName: string;
  personnes: Personne[];
  personnesLoading: boolean;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const s = node?.squad;
  const alias = s?.alias ?? [];
  const sorted = useMemo(() => [...personnes].sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr')), [personnes]);
  return (
    <Inspector
      opened={!!s}
      onClose={onClose}
      title={s?.nom_canonique ?? ''}
      subtitle={node && node.depth > 0 ? node.path : undefined}
      footer={
        s && (
          <Button icon={<IconPencil size={15} />} onClick={() => onEdit(s.id)}>
            Modifier
          </Button>
        )
      }
    >
      {s && node && (
        <>
          <InspectorSection>
            <KeyValue
              items={[
                { label: 'Entité rattachée', value: s.entite_rattachee || '—' },
                { label: 'Parent', value: parentName || '—' },
                { label: 'Sous-squads', value: node.childCount, numeric: true },
                { label: 'Créée le', value: fmtDateTime(s.created_at) },
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Alias">
            {alias.length ? (
              <div className="ref-pills">
                {alias.map((a) => (
                  <Pill key={a}>{a}</Pill>
                ))}
              </div>
            ) : (
              <Text tone="secondary">Aucun alias.</Text>
            )}
          </InspectorSection>
          <InspectorSection title={`Personnes rattachées (${sorted.length})`}>
            {personnesLoading ? (
              <SkeletonRows rows={3} />
            ) : sorted.length ? (
              <ul className="ref-list">
                {sorted.map((p) => (
                  <li key={p.id}>
                    <Link to={`/personnes?personne=${encodeURIComponent(p.id)}`}>{p.display_name}</Link>
                    {p.statut === 'brouillon' && <span className="ref-list__aside">brouillon</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <Text tone="secondary">Aucune personne.</Text>
            )}
          </InspectorSection>
        </>
      )}
    </Inspector>
  );
}
