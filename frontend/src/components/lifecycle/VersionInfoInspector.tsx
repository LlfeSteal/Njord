// Inspecteur « Infos » d'une version (plan ou réalisé) : fichier, contenu, cycle de vie et actions.
// Plan : section « Timeline » (fenêtre en vigueur, date d'effet modifiable — DECISIONS n° 13).
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DateInput,
  Group,
  Inspector,
  InspectorSection,
  KeyValue,
  Stack,
  toast,
  Tooltip,
  type KeyValueItem,
} from '../../ui';
import { IconArchive, IconRestore, IconTrash } from '../../ui/Icons';
import { planApi } from '../../api/client';
import type { Version } from '../../api/types';
import { fmtDate, fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { StatusBadge } from '../badges';
import ErrorAlert from '../ErrorAlert';
import { loadOperateur } from './lifecycleUtils';
import { fmtWindow, usePlanTimeline, windowOf } from './usePlanTimeline';
import type { VersionLifecycle } from './useVersionLifecycle';

const LAYOUT_LABEL: Record<string, string> = { A: 'A', B: 'B', mixte: 'mixte (A et B)' };

interface Props {
  version: Version;
  opened: boolean;
  onClose: () => void;
  lifecycle: VersionLifecycle;
  /** Sections supplémentaires (ex. lignes par catégorie du réalisé). */
  children?: ReactNode;
}

export default function VersionInfoInspector({ version: v, opened, onClose, lifecycle: lc, children }: Props) {
  const fichier: KeyValueItem[] = [
    { label: 'Fichier', value: v.filename || '—' },
    { label: 'Format', value: v.source_format || '—' },
    ...(v.kind === 'plan' ? [{ label: 'Layout', value: v.layout ? (LAYOUT_LABEL[v.layout] ?? v.layout) : '—' }] : []),
    { label: 'Importé le', value: fmtDateTime(v.importee_le), numeric: true },
    { label: 'Importé par', value: v.importeur || '—' },
  ];
  const contenu: KeyValueItem[] = [
    { label: 'Période', value: fmtPeriod(v.periode_debut, v.periode_fin), numeric: true },
    { label: 'Lignes', value: fmtNumber(v.nb_lignes), numeric: true },
    { label: 'À vérifier (warn)', value: fmtNumber(v.nb_warn), numeric: true },
    { label: 'Rejetées (drop)', value: fmtNumber(v.nb_drop), numeric: true },
    ...(v.kind === 'realise' ? [{ label: 'Montant total', value: fmtEur(v.montant_total_eur), numeric: true }] : []),
  ];
  const cycle: KeyValueItem[] = [
    { label: 'Statut', value: <StatusBadge statut={v.statut} /> },
    ...(v.archivee_le ? [{ label: 'Archivée le', value: fmtDateTime(v.archivee_le), numeric: true }] : []),
    ...(v.purgee_le ? [{ label: 'Purgée le', value: fmtDateTime(v.purgee_le), numeric: true }] : []),
  ];

  const busy = lc.pendingId === v.id;
  const footer =
    v.statut === 'active' ? (
      <Button icon={<IconArchive size={15} />} loading={busy} onClick={() => lc.archive(v)}>
        Archiver
      </Button>
    ) : v.statut === 'archivee' ? (
      <>
        {lc.canPurge(v) ? (
          <Button destructive icon={<IconTrash size={15} />} onClick={() => lc.purge(v)}>
            Purger…
          </Button>
        ) : (
          <Tooltip label={lc.purgeHint(v)} maxWidth={280}>
            <Button destructive icon={<IconTrash size={15} />} disabled>
              Purger…
            </Button>
          </Tooltip>
        )}
        <Button icon={<IconRestore size={15} />} loading={busy} onClick={() => lc.reactivate(v)}>
          Réactiver…
        </Button>
      </>
    ) : undefined;

  return (
    <Inspector opened={opened} onClose={onClose} title="Informations" subtitle={v.intitule} footer={footer}>
      <InspectorSection title="Fichier">
        <KeyValue items={fichier} />
      </InspectorSection>
      <InspectorSection title="Contenu">
        <KeyValue items={contenu} />
      </InspectorSection>
      {v.kind === 'plan' && opened && <PlanTimelineSection version={v} />}
      {children}
      <InspectorSection title="Cycle de vie">
        <KeyValue items={cycle} />
      </InspectorSection>
    </Inspector>
  );
}

/** Plan : fenêtre où la version fait référence + date d'effet modifiable (audit côté serveur). */
function PlanTimelineSection({ version: v }: { version: Version }) {
  const qc = useQueryClient();
  const timeline = usePlanTimeline(undefined, v.statut !== 'purgee');
  const [date, setDate] = useState(v.date_effet ?? '');
  useEffect(() => setDate(v.date_effet ?? ''), [v.id, v.date_effet]);

  const save = useMutation({
    mutationFn: (d: string) => planApi.setDateEffet(v.id, d, loadOperateur() || undefined),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['versions'] });
      void qc.invalidateQueries({ queryKey: ['analyse'] });
      void qc.invalidateQueries({ queryKey: qk.planTimelineAll() });
      toast({
        tone: 'success',
        title: "Date d'effet modifiée",
        message: `« ${res.intitule} » remplace les plans précédents à partir du ${fmtDate(res.date_effet)}.`,
      });
    },
  });

  const purged = v.statut === 'purgee';
  const enVigueur = purged ? '—' : timeline.isLoading ? '…' : fmtWindow(windowOf(timeline.data, v.id)) || '—';
  const dirty = date !== (v.date_effet ?? '');

  return (
    <InspectorSection title="Timeline">
      <Stack gap={8}>
        <KeyValue items={[{ label: 'En vigueur', value: enVigueur, numeric: true }]} />
        {purged ? (
          <KeyValue items={[{ label: "Date d'effet", value: fmtDate(v.date_effet), numeric: true }]} />
        ) : (
          <>
            <DateInput
              label="Date d'effet"
              description="Remplace les plans précédents à partir de cette date."
              value={date}
              onChange={(d) => {
                setDate(d);
                save.reset();
              }}
              disabled={save.isPending}
            />
            {dirty && (
              <Group gap={8} justify="end">
                <Button size="sm" onClick={() => setDate(v.date_effet ?? '')} disabled={save.isPending}>
                  Annuler
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!date}
                  loading={save.isPending}
                  onClick={() => save.mutate(date)}
                >
                  Enregistrer
                </Button>
              </Group>
            )}
            <ErrorAlert error={save.error} title="Modification impossible" />
          </>
        )}
      </Stack>
    </InspectorSection>
  );
}
