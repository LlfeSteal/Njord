// Liste des versions d'un kind (plan | realise) avec cycle de vie complet.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Auto-suffisant : charge versionsApi.list, bouton « Importer » (ouvre ImportWizard),
// toggle « afficher purgées », tri actives en tête / archivées grisées,
// actions en ligne : consulter (onOpen), archiver / réactiver, purger (PurgeModal).
import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconArchive, IconEye, IconFileImport, IconRestore, IconTrash } from '@tabler/icons-react';
import { settingsApi, versionsApi } from '../api/client';
import type { Kind, Version } from '../api/types';
import { fmtDateTime, fmtNumber, fmtPeriod } from '../lib/format';
import { qk } from '../lib/queryKeys';
import { StatusBadge } from './badges';
import ErrorAlert from './ErrorAlert';
import ImportWizard from './ImportWizard';
import PurgeModal from './PurgeModal';
import { canPurgeNow, errMessage, fmtDay, invalidateLifecycle, loadOperateur, purgeAvailableFrom } from './lifecycle/lifecycleUtils';

export interface VersionColumn {
  header: string;
  render: (v: Version) => ReactNode;
}

export interface VersionsPanelProps {
  kind: Kind;
  title: string;
  /** Clic sur « consulter » ou sur la ligne. */
  onOpen: (v: Version) => void;
  /** Colonnes ajoutées après les colonnes communes (ex. layout pour le plan, montant total pour le réalisé). */
  extraColumns?: VersionColumn[];
}

const STATUT_ORDER: Record<Version['statut'], number> = { active: 0, archivee: 1, purgee: 2 };

function sortVersions(list: Version[]): Version[] {
  return [...list].sort(
    (a, b) => STATUT_ORDER[a.statut] - STATUT_ORDER[b.statut] || b.importee_le.localeCompare(a.importee_le),
  );
}

const stop = (e: MouseEvent) => e.stopPropagation();

export default function VersionsPanel({ kind, title, onOpen, extraColumns = [] }: VersionsPanelProps) {
  const qc = useQueryClient();
  const [includePurged, setIncludePurged] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toPurge, setToPurge] = useState<Version | null>(null);
  const [toReactivate, setToReactivate] = useState<Version | null>(null);

  const versions = useQuery({
    queryKey: [...qk.versions(kind), { includePurged }],
    queryFn: () => versionsApi.list(kind, includePurged),
  });
  const settings = useQuery({ queryKey: qk.settings(), queryFn: settingsApi.get });
  const delai = settings.data?.purge_delai_jours;

  const list = sortVersions(versions.data ?? []);
  const currentActive = list.find((v) => v.statut === 'active') ?? null;

  const onError = (title: string) => (e: unknown) =>
    notifications.show({ color: 'red', title, message: errMessage(e) });

  const archive = useMutation({
    mutationFn: (v: Version) => versionsApi.archive(kind, v.id, loadOperateur() || undefined),
    onSuccess: (v) => {
      invalidateLifecycle(qc);
      notifications.show({ color: 'green', title: 'Version archivée', message: `« ${v.intitule} » est archivée.` });
    },
    onError: onError("Échec de l'archivage"),
  });

  const reactivate = useMutation({
    mutationFn: (v: Version) => versionsApi.reactivate(kind, v.id, loadOperateur() || undefined),
    onSuccess: (v) => {
      invalidateLifecycle(qc);
      setToReactivate(null);
      notifications.show({
        color: 'green',
        title: 'Version réactivée',
        message: `« ${v.intitule} » est désormais la version active.`,
      });
    },
    onError: onError('Échec de la réactivation'),
  });

  const pendingId =
    (archive.isPending && archive.variables?.id) || (reactivate.isPending && reactivate.variables?.id) || null;

  const purgeTooltip = (v: Version): string => {
    if (delai == null || canPurgeNow(v, delai)) return 'Purger';
    const from = purgeAvailableFrom(v, delai);
    return `Purge possible à partir du ${from ? fmtDay(from) : '—'} (archivée depuis moins de ${delai} jour${
      delai > 1 ? 's' : ''
    })`;
  };

  const renderActions = (v: Version) => {
    if (v.statut === 'purgee') return null;
    const busy = pendingId === v.id;
    const purgeable = canPurgeNow(v, delai);
    return (
      <Group gap={4} wrap="nowrap" onClick={stop}>
        <Tooltip label="Consulter" withArrow>
          <ActionIcon variant="subtle" aria-label={`Consulter « ${v.intitule} »`} onClick={() => onOpen(v)}>
            <IconEye size={18} />
          </ActionIcon>
        </Tooltip>
        {v.statut === 'active' && (
          <Tooltip label="Archiver" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`Archiver « ${v.intitule} »`}
              loading={busy}
              disabled={pendingId != null && !busy}
              onClick={() => archive.mutate(v)}
            >
              <IconArchive size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        {v.statut === 'archivee' && (
          <>
            <Tooltip label="Réactiver" withArrow>
              <ActionIcon
                variant="subtle"
                color="green"
                aria-label={`Réactiver « ${v.intitule} »`}
                loading={busy}
                disabled={pendingId != null && !busy}
                onClick={() => setToReactivate(v)}
              >
                <IconRestore size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={purgeTooltip(v)} withArrow multiline maw={280}>
              {/* span : un bouton désactivé ne déclenche pas le tooltip */}
              <span>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={purgeable ? `Purger « ${v.intitule} »` : purgeTooltip(v)}
                  disabled={!purgeable}
                  onClick={() => setToPurge(v)}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </span>
            </Tooltip>
          </>
        )}
      </Group>
    );
  };

  let body: ReactNode;
  if (versions.isLoading) {
    body = (
      <Stack gap="xs">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} h={32} />
        ))}
      </Stack>
    );
  } else if (versions.error) {
    body = <ErrorAlert error={versions.error} title="Impossible de charger les versions" />;
  } else if (list.length === 0) {
    body = (
      <Paper withBorder p="xl" radius="sm">
        <Stack align="center" gap="sm">
          <IconFileImport size={36} stroke={1.5} aria-hidden />
          <Text fw={500}>Aucune version importée</Text>
          <Text size="sm" c="dimmed" ta="center">
            Importez un fichier Excel (.xlsx) pour créer la première version.
          </Text>
          <Button leftSection={<IconFileImport size={16} />} onClick={() => setWizardOpen(true)}>
            Importer un fichier
          </Button>
        </Stack>
      </Paper>
    );
  } else {
    body = (
      <Table.ScrollContainer minWidth={1000 + extraColumns.length * 120}>
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Intitulé</Table.Th>
              <Table.Th>Importée le</Table.Th>
              <Table.Th>Importeur</Table.Th>
              <Table.Th>Statut</Table.Th>
              <Table.Th ta="right">Lignes</Table.Th>
              <Table.Th ta="right">Warn</Table.Th>
              <Table.Th ta="right">Drop</Table.Th>
              <Table.Th>Période</Table.Th>
              {extraColumns.map((c) => (
                <Table.Th key={c.header}>{c.header}</Table.Th>
              ))}
              <Table.Th>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((v) => {
              const purged = v.statut === 'purgee';
              return (
                <Table.Tr
                  key={v.id}
                  onClick={purged ? undefined : () => onOpen(v)}
                  style={{
                    cursor: purged ? 'default' : 'pointer',
                    opacity: v.statut === 'active' ? 1 : purged ? 0.5 : 0.65,
                    textDecoration: purged ? 'line-through' : undefined,
                  }}
                >
                  <Table.Td fw={v.statut === 'active' ? 600 : undefined}>{v.intitule}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(v.importee_le)}</Table.Td>
                  <Table.Td>{v.importeur || '—'}</Table.Td>
                  <Table.Td>
                    <StatusBadge statut={v.statut} />
                  </Table.Td>
                  <Table.Td ta="right">{fmtNumber(v.nb_lignes)}</Table.Td>
                  <Table.Td ta="right" c={v.nb_warn ? 'yellow.7' : undefined}>
                    {fmtNumber(v.nb_warn)}
                  </Table.Td>
                  <Table.Td ta="right" c={v.nb_drop ? 'red' : undefined}>
                    {fmtNumber(v.nb_drop)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtPeriod(v.periode_debut, v.periode_fin)}</Table.Td>
                  {extraColumns.map((c) => (
                    <Table.Td key={c.header}>{c.render(v)}</Table.Td>
                  ))}
                  <Table.Td>{renderActions(v)}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={3}>{title}</Title>
        <Group gap="md">
          <Switch
            label="Afficher les versions purgées"
            checked={includePurged}
            onChange={(e) => setIncludePurged(e.currentTarget.checked)}
          />
          <Button leftSection={<IconFileImport size={16} />} onClick={() => setWizardOpen(true)}>
            Importer un fichier
          </Button>
        </Group>
      </Group>

      {body}

      <ImportWizard kind={kind} opened={wizardOpen} onClose={() => setWizardOpen(false)} />
      <PurgeModal kind={kind} version={toPurge} onClose={() => setToPurge(null)} />

      <Modal
        opened={toReactivate != null}
        onClose={() => {
          if (!reactivate.isPending) setToReactivate(null);
        }}
        title={<Text fw={600}>Réactiver la version</Text>}
      >
        {toReactivate && (
          <Stack gap="md">
            <Text size="sm">
              La version « <b>{toReactivate.intitule}</b> » redeviendra la version active et sera utilisée par
              défaut par l'analyse.
            </Text>
            {currentActive && currentActive.id !== toReactivate.id ? (
              <Text size="sm">
                La version active « <b>{currentActive.intitule}</b> » sera archivée.
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                Aucune autre version n'est actuellement active.
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setToReactivate(null)} disabled={reactivate.isPending}>
                Annuler
              </Button>
              <Button color="green" loading={reactivate.isPending} onClick={() => reactivate.mutate(toReactivate)}>
                Réactiver
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
