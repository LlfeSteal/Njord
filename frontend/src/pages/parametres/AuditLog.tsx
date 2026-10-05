// Journal d'audit (GET /audit?objet_type=&limit=), récents d'abord ; détail d'une entrée dans l'inspecteur.
import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import type { AuditEntry } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import {
  EmptyState,
  Group,
  Inspector,
  InspectorSection,
  KeyValue,
  Page,
  Select,
  SkeletonRows,
  Spinner,
  Table,
  Text,
} from '../../ui';
import { IconHistory } from '../../ui/Icons';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import ReglagesToolbar from './ReglagesToolbar';
import './reglages.css';

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
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const auditQ = useQuery({
    queryKey: [...qk.audit(objetType ?? undefined), limit],
    queryFn: () => settingsApi.audit(objetType ?? undefined, limit),
  });
  const rows = auditQ.data ?? [];

  const subtitle = auditQ.data
    ? `${rows.length} entrée${rows.length > 1 ? 's' : ''}${rows.length >= limit ? ' (limite atteinte)' : ''}`
    : undefined;

  const onRowKey = (e: KeyboardEvent, r: AuditEntry) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(r);
    }
  };

  return (
    <Page
      toolbar={<ReglagesToolbar subtitle={subtitle} />}
      inspector={<AuditInspector entry={selected} onClose={() => setSelected(null)} />}
    >
      {/* Filtres sur une ligne. */}
      <Group gap={8} wrap={false}>
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
      </Group>

      <ErrorAlert error={auditQ.error} title="Impossible de charger le journal" />

      {auditQ.isLoading ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<IconHistory size={40} />} title="Aucune entrée dans le journal." />
      ) : (
        <Table hover minWidth={720}>
          <thead>
            <tr>
              <th style={{ width: 150 }}>Date</th>
              <th style={{ width: '15%' }}>Opérateur</th>
              <th style={{ width: '18%' }}>Action</th>
              <th style={{ width: 150 }}>Objet</th>
              <th>Détails</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                data-clickable
                data-selected={selected?.id === r.id || undefined}
                tabIndex={0}
                onClick={() => setSelected(r)}
                onKeyDown={(e) => onRowKey(e, r)}
              >
                <td data-nowrap className="reglages-date">
                  {fmtDateTime(r.at)}
                </td>
                <td className="reglages-ellipsis">{r.operateur || '—'}</td>
                <td className="reglages-ellipsis reglages-strong">{r.action}</td>
                <td data-nowrap>{OBJET_LABEL[r.objet_type] ?? r.objet_type}</td>
                <td className="reglages-ellipsis reglages-muted" title={r.details || undefined}>
                  {r.details || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}

function AuditInspector({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  return (
    <Inspector
      opened={!!entry}
      onClose={onClose}
      title={entry?.action ?? ''}
      subtitle={entry ? fmtDateTime(entry.at) : undefined}
    >
      {entry && (
        <>
          <InspectorSection>
            <KeyValue
              items={[
                { label: 'Date', value: fmtDateTime(entry.at) },
                { label: 'Opérateur', value: entry.operateur || '—' },
                { label: 'Action', value: entry.action },
                { label: 'Objet', value: OBJET_LABEL[entry.objet_type] ?? entry.objet_type },
                { label: 'Identifiant', value: entry.objet_id || '—', mono: !!entry.objet_id },
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Détails">
            {entry.details ? (
              <Text className="reglages-details">{entry.details}</Text>
            ) : (
              <Text tone="secondary">Aucun détail.</Text>
            )}
          </InspectorSection>
        </>
      )}
    </Inspector>
  );
}
