// Journal d'audit (GET /audit?objet_type=&limit=), récents d'abord.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import ErrorAlert from '../../components/ErrorAlert';
import { Code, EmptyState, Group, Select, SkeletonRows, Spinner, Stack, Table, Text, Tooltip } from '../../ui';
import { IconHistory } from '../../ui/Icons';
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
    <Stack gap={8}>
      <Group gap={8}>
        <Select
          aria-label="Type d'objet"
          placeholder="Type d'objet"
          data={OBJET_TYPES}
          value={objetType}
          onChange={setObjetType}
          clearable
        />
        <Select
          aria-label="Nombre d'entrées"
          data={LIMITS.map((v) => ({ value: v, label: `${v} entrées` }))}
          value={String(limit)}
          onChange={(v) => v && setLimit(Number(v))}
        />
        {auditQ.isFetching && <Spinner size={12} />}
        {auditQ.data && (
          <Text size="sm" tone="secondary" tabular style={{ marginLeft: 'auto' }}>
            {rows.length} entrée{rows.length > 1 ? 's' : ''}
            {rows.length >= limit ? ' (limite atteinte)' : ''}
          </Text>
        )}
      </Group>

      <ErrorAlert error={auditQ.error} title="Impossible de charger le journal" />

      <Table striped hover minWidth={760}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Opérateur</th>
            <th>Action</th>
            <th>Objet</th>
            <th>Identifiant</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          {auditQ.isLoading ? (
            <tr>
              <td colSpan={6}>
                <SkeletonRows rows={5} />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState icon={<IconHistory size={40} />} title="Aucune entrée dans le journal." />
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td data-nowrap>{fmtDateTime(r.at)}</td>
                <td>{r.operateur || '—'}</td>
                <td data-nowrap>
                  <Text as="span" weight={500}>
                    {r.action}
                  </Text>
                </td>
                <td data-nowrap>{OBJET_LABEL[r.objet_type] ?? r.objet_type}</td>
                <td>
                  {r.objet_id ? (
                    <Tooltip label={r.objet_id} disabled={r.objet_id.length <= 10}>
                      <Code>{r.objet_id.length > 10 ? `${r.objet_id.slice(0, 8)}…` : r.objet_id}</Code>
                    </Tooltip>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ maxWidth: 420, wordBreak: 'break-word' }}>{r.details || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </Stack>
  );
}
