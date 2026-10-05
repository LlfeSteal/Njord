// Liste des versions d'un kind (plan | realise) avec cycle de vie complet.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Auto-suffisant : charge versionsApi.list, bouton « Importer » (ouvre ImportWizard),
// toggle « afficher purgées », tri actives en tête / archivées grisées,
// actions en ligne : consulter (onOpen), archiver / réactiver, purger (PurgeModal).
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  Group,
  IconButton,
  Modal,
  SkeletonRows,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
  VisuallyHidden,
  toast,
} from '../ui';
import { IconArchive, IconEye, IconImport, IconRestore, IconTrash } from '../ui/Icons';
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

  const onError = (title: string) => (e: unknown) => toast({ tone: 'error', title, message: errMessage(e) });

  const archive = useMutation({
    mutationFn: (v: Version) => versionsApi.archive(kind, v.id, loadOperateur() || undefined),
    onSuccess: (v) => {
      invalidateLifecycle(qc);
      toast({ tone: 'success', title: 'Version archivée', message: `« ${v.intitule} » est archivée.` });
    },
    onError: onError("Échec de l'archivage"),
  });

  const reactivate = useMutation({
    mutationFn: (v: Version) => versionsApi.reactivate(kind, v.id, loadOperateur() || undefined),
    onSuccess: (v) => {
      invalidateLifecycle(qc);
      setToReactivate(null);
      toast({
        tone: 'success',
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
      <>
        <IconButton label="Consulter" aria-label={`Consulter « ${v.intitule} »`} onClick={() => onOpen(v)}>
          <IconEye size={15} />
        </IconButton>
        {v.statut === 'active' && (
          <IconButton
            label="Archiver"
            aria-label={`Archiver « ${v.intitule} »`}
            loading={busy}
            disabled={pendingId != null && !busy}
            onClick={() => archive.mutate(v)}
          >
            <IconArchive size={15} />
          </IconButton>
        )}
        {v.statut === 'archivee' && (
          <>
            <IconButton
              label="Réactiver"
              aria-label={`Réactiver « ${v.intitule} »`}
              loading={busy}
              disabled={pendingId != null && !busy}
              onClick={() => setToReactivate(v)}
            >
              <IconRestore size={15} />
            </IconButton>
            {purgeable ? (
              <IconButton label="Purger" aria-label={`Purger « ${v.intitule} »`} destructive onClick={() => setToPurge(v)}>
                <IconTrash size={15} />
              </IconButton>
            ) : (
              // Bouton désactivé : la bulle explique quand la purge deviendra possible.
              <Tooltip label={purgeTooltip(v)} maxWidth={280}>
                <IconButton label={purgeTooltip(v)} destructive disabled>
                  <IconTrash size={15} />
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </>
    );
  };

  let body: ReactNode;
  if (versions.isLoading) {
    body = <SkeletonRows rows={3} />;
  } else if (versions.error) {
    body = <ErrorAlert error={versions.error} title="Impossible de charger les versions" />;
  } else if (list.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={<IconImport size={40} />}
          title="Aucune version importée"
          action={
            <Button variant="primary" icon={<IconImport size={15} />} onClick={() => setWizardOpen(true)}>
              Importer un fichier
            </Button>
          }
        >
          Importez un fichier Excel (.xlsx) pour créer la première version.
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Table hover minWidth={1000 + extraColumns.length * 120}>
        <thead>
          <tr>
            <th>Intitulé</th>
            <th>Importée le</th>
            <th>Importeur</th>
            <th>Statut</th>
            <th data-align="right">Lignes</th>
            <th data-align="right">Warn</th>
            <th data-align="right">Drop</th>
            <th>Période</th>
            {extraColumns.map((c) => (
              <th key={c.header}>{c.header}</th>
            ))}
            <th>
              <VisuallyHidden>Actions</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((v) => {
            const purged = v.statut === 'purgee';
            return (
              <tr
                key={v.id}
                onClick={purged ? undefined : () => onOpen(v)}
                data-clickable={purged ? undefined : true}
                data-emphasis={v.statut === 'active' || undefined}
                data-muted={v.statut === 'archivee' || undefined}
                data-strike={purged || undefined}
              >
                <td>{v.intitule}</td>
                <td data-nowrap>{fmtDateTime(v.importee_le)}</td>
                <td>{v.importeur || '—'}</td>
                <td>
                  <StatusBadge statut={v.statut} />
                </td>
                <td data-align="right">{fmtNumber(v.nb_lignes)}</td>
                <td data-align="right">
                  {v.nb_warn ? (
                    <Text as="span" tone="warning">
                      {fmtNumber(v.nb_warn)}
                    </Text>
                  ) : (
                    fmtNumber(v.nb_warn)
                  )}
                </td>
                <td data-align="right">
                  {v.nb_drop ? (
                    <Text as="span" tone="danger">
                      {fmtNumber(v.nb_drop)}
                    </Text>
                  ) : (
                    fmtNumber(v.nb_drop)
                  )}
                </td>
                <td data-nowrap>{fmtPeriod(v.periode_debut, v.periode_fin)}</td>
                {extraColumns.map((c) => (
                  <td key={c.header}>{c.render(v)}</td>
                ))}
                <td data-actions onClick={stop}>
                  {renderActions(v)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }

  return (
    <Stack gap={12}>
      <Group justify="between" gap={8}>
        <Title order={3}>{title}</Title>
        <Group gap={12}>
          <Switch label="Afficher les versions purgées" checked={includePurged} onChange={setIncludePurged} />
          <Button variant="primary" icon={<IconImport size={15} />} onClick={() => setWizardOpen(true)}>
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
        title="Réactiver la version"
        size="sm"
        dismissable={!reactivate.isPending}
        footer={
          <>
            <Button onClick={() => setToReactivate(null)} disabled={reactivate.isPending}>
              Annuler
            </Button>
            <Button
              variant="primary"
              loading={reactivate.isPending}
              onClick={() => toReactivate && reactivate.mutate(toReactivate)}
            >
              Réactiver
            </Button>
          </>
        }
      >
        {toReactivate && (
          <Stack gap={8}>
            <Text>
              La version « <b>{toReactivate.intitule}</b> » redeviendra la version active et sera utilisée par
              défaut par l'analyse.
            </Text>
            {currentActive && currentActive.id !== toReactivate.id ? (
              <Text>
                La version active « <b>{currentActive.intitule}</b> » sera archivée.
              </Text>
            ) : (
              <Text tone="secondary">Aucune autre version n'est actuellement active.</Text>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
