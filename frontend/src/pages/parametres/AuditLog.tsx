// Journal d'audit (GET /audit?objet_type=&limit=), récents d'abord.
import { useState } from 'react';
import { Badge, Code, Group, Loader, Paper, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queryKeys';

const OBJET_TYPES: { value: string; label: string }[] = [
  { value: 'plan_version', label: 'Version de plan' },
  { value: 'realise_version', label: 'Version de réalisé' },
  { value: 'personne', label: 'Personne' },
  { value: 'squad', label: 'Squad' },
  { value: 'settings', label: 'Paramètres' },
];
const OBJET_LABEL = Object.fromEntries(OBJET_TYPES.map((o) => [o.value, o.label]));

const ACTION_COLOR: Record<string, string> = {
  import: 'blue',
  archive: 'gray',
  reactivate: 'green',
  purge: 'red',
  update: 'indigo',
  merge: 'grape',
};

const LIMITS = ['100', '200', '500', '1000'];

export default function AuditLog() {
  const [objetType, setObjetType] = useState<string | null>(null);
  const [limit, setLimit] = useState(200);
  const auditQ = useQuery({
    queryKey: [...qk.audit(objetType ?? undefined), limit],
    queryFn: () => settingsApi.audit(objetType ?? undefined, limit),
  });
  const rows = auditQ.data ?? [];

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          label="Type d'objet"
          placeholder="Tous"
          data={OBJET_TYPES}
          value={objetType}
          onChange={setObjetType}
          clearable
          w={220}
        />
        <Select
          label="Nombre d'entrées"
          data={LIMITS}
          value={String(limit)}
          onChange={(v) => v && setLimit(Number(v))}
          allowDeselect={false}
          w={140}
        />
        {auditQ.isFetching && <Loader size="xs" mb={10} />}
        {auditQ.data && (
          <Text size="sm" c="dimmed" mb={8} ml="auto">
            {rows.length} entrée{rows.length > 1 ? 's' : ''}
            {rows.length >= limit ? ' (limite atteinte)' : ''}
          </Text>
        )}
      </Group>

      <ErrorAlert error={auditQ.error} title="Impossible de charger le journal" />

      <Paper withBorder radius="sm">
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Opérateur</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Objet</Table.Th>
                <Table.Th>Identifiant</Table.Th>
                <Table.Th>Détails</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditQ.isLoading ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Group justify="center" p="md">
                      <Loader size="sm" />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ) : rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" p="md" size="sm">
                      Aucune entrée dans le journal.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</Table.Td>
                    <Table.Td>{r.operateur || '—'}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={ACTION_COLOR[r.action] ?? 'gray'} tt="none">
                        {r.action}
                      </Badge>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{OBJET_LABEL[r.objet_type] ?? r.objet_type}</Table.Td>
                    <Table.Td>
                      {r.objet_id ? (
                        <Tooltip label={r.objet_id} withArrow disabled={r.objet_id.length <= 10}>
                          <Code>{r.objet_id.length > 10 ? `${r.objet_id.slice(0, 8)}…` : r.objet_id}</Code>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td style={{ maxWidth: 420, wordBreak: 'break-word' }}>{r.details || '—'}</Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
