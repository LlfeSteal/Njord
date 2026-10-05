// Onglet Squads : table hiérarchique (parent → enfants indentés), création / édition / alias.
import { useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  Group,
  IconButton,
  Pill,
  SearchField,
  SkeletonRows,
  Stack,
  Table,
  Text,
  Tooltip,
  VisuallyHidden,
} from '../../ui';
import { IconCornerDownRight, IconPencil, IconPlus, IconUsers } from '../../ui/Icons';
import ErrorAlert from '../../components/ErrorAlert';
import { fold, useSquadIndex } from './hooks';
import SquadModal from './SquadModal';

const MAX_ALIAS = 4;

export default function SquadsTab() {
  const { query, nodes } = useSquadIndex();
  const [filter, setFilter] = useState('');
  /** null = fermé, 'new' = création, sinon id du squad édité. */
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => {
    const f = fold(filter.trim());
    if (!f) return nodes;
    return nodes.filter(
      (n) =>
        fold(n.path).includes(f) ||
        fold(n.squad.entite_rattachee ?? '').includes(f) ||
        (n.squad.alias ?? []).some((a) => fold(a).includes(f)),
    );
  }, [nodes, filter]);

  return (
    <Stack gap={8}>
      <Group justify="between" gap={8}>
        <SearchField
          aria-label="Filtrer les squads"
          placeholder="Nom, alias, entité…"
          value={filter}
          onChange={setFilter}
          width={320}
        />
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setEditing('new')}>
          Nouvelle squad
        </Button>
      </Group>

      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconUsers size={40} />} title={nodes.length ? 'Aucun résultat' : 'Aucune squad'}>
          {nodes.length ? 'Aucune squad ne correspond au filtre.' : 'Aucune squad pour le moment.'}
        </EmptyState>
      ) : (
        <>
          <Text size="sm" tone="secondary" tabular>
            {rows.length} squad{rows.length > 1 ? 's' : ''}
          </Text>
          <Table striped hover minWidth={720}>
            <thead>
              <tr>
                <th>Squad</th>
                <th>Alias</th>
                <th>Entité rattachée</th>
                <th data-align="right">Sous-squads</th>
                <th style={{ width: 50 }}>
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ squad: s, depth, path, childCount }) => {
                const alias = s.alias ?? [];
                return (
                  <tr key={s.id}>
                    <td>
                      <Group gap={4} wrap={false} style={{ paddingLeft: depth * 20 }} title={path}>
                        {depth > 0 && (
                          <Text as="span" tone="tertiary">
                            <IconCornerDownRight size={14} />
                          </Text>
                        )}
                        <Text as="span" weight={depth === 0 ? 600 : 400}>
                          {s.nom_canonique}
                        </Text>
                      </Group>
                    </td>
                    <td>
                      {alias.length === 0 ? (
                        <Text as="span" tone="secondary">
                          —
                        </Text>
                      ) : (
                        <Group gap={4}>
                          {alias.slice(0, MAX_ALIAS).map((a) => (
                            <Pill key={a}>{a}</Pill>
                          ))}
                          {alias.length > MAX_ALIAS && (
                            <Tooltip label={alias.slice(MAX_ALIAS).join(', ')}>
                              <Pill>+{alias.length - MAX_ALIAS}</Pill>
                            </Tooltip>
                          )}
                        </Group>
                      )}
                    </td>
                    <td>
                      {s.entite_rattachee || (
                        <Text as="span" tone="secondary">
                          —
                        </Text>
                      )}
                    </td>
                    <td data-align="right">{childCount || ''}</td>
                    <td data-actions>
                      <IconButton label={`Modifier la squad ${s.nom_canonique}`} onClick={() => setEditing(s.id)}>
                        <IconPencil size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      <SquadModal
        editing={editing}
        squads={query.data ?? []}
        onClose={() => setEditing(null)}
        onCreated={(s) => setEditing(s.id)}
      />
    </Stack>
  );
}
