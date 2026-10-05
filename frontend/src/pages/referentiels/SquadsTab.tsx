// Onglet Squads : table hiérarchique (parent → enfants indentés), création / édition / alias.
import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Center, Group, Loader, Table, Text, TextInput, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconCornerDownRight, IconPencil, IconPlus, IconSearch } from '@tabler/icons-react';
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
    <>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <TextInput
          label="Filtrer"
          placeholder="Nom, alias, entité…"
          leftSection={<IconSearch size={16} />}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          w={{ base: '100%', sm: 320 }}
        />
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          Nouvelle squad
        </Button>
      </Group>

      <ErrorAlert error={query.error} />
      {query.isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb={4}>
            {rows.length} squad{rows.length > 1 ? 's' : ''}
          </Text>
          <Table.ScrollContainer minWidth={720}>
            <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Squad</Table.Th>
                  <Table.Th>Alias</Table.Th>
                  <Table.Th>Entité rattachée</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Sous-squads</Table.Th>
                  <Table.Th w={50}>
                    <VisuallyHidden>Actions</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text c="dimmed" ta="center" py="md">
                        {nodes.length ? 'Aucune squad ne correspond au filtre.' : 'Aucune squad pour le moment.'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {rows.map(({ squad: s, depth, path, childCount }) => {
                  const alias = s.alias ?? [];
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" style={{ paddingLeft: depth * 20 }} title={path}>
                          {depth > 0 && <IconCornerDownRight size={14} color="var(--mantine-color-dimmed)" />}
                          <Text size="sm" fw={depth === 0 ? 600 : 400}>
                            {s.nom_canonique}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {alias.length === 0 ? (
                          <Text span c="dimmed">
                            —
                          </Text>
                        ) : (
                          <Group gap={4}>
                            {alias.slice(0, MAX_ALIAS).map((a) => (
                              <Badge key={a} size="sm" variant="light" color="gray" style={{ textTransform: 'none' }}>
                                {a}
                              </Badge>
                            ))}
                            {alias.length > MAX_ALIAS && (
                              <Tooltip label={alias.slice(MAX_ALIAS).join(', ')} multiline maw={320}>
                                <Badge size="sm" variant="outline" color="gray">
                                  +{alias.length - MAX_ALIAS}
                                </Badge>
                              </Tooltip>
                            )}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>{s.entite_rattachee || <Text span c="dimmed">—</Text>}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{childCount || ''}</Table.Td>
                      <Table.Td>
                        <Tooltip label="Modifier / alias" withArrow>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Modifier la squad ${s.nom_canonique}`}
                            onClick={() => setEditing(s.id)}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </>
      )}

      <SquadModal
        editing={editing}
        squads={query.data ?? []}
        onClose={() => setEditing(null)}
        onCreated={(s) => setEditing(s.id)}
      />
    </>
  );
}
