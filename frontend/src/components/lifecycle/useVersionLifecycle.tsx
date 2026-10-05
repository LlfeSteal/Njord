// Cycle de vie d'une version (archiver, réactiver, purger) partagé par la liste et les pages de détail :
// mutations, éligibilité à la purge, entrées de menu et modales de confirmation.
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Stack, Text, toast, type MenuEntry } from '../../ui';
import { IconArchive, IconRestore, IconTrash } from '../../ui/Icons';
import { settingsApi, versionsApi } from '../../api/client';
import type { Kind, Version } from '../../api/types';
import { qk } from '../../lib/queryKeys';
import PurgeModal from '../PurgeModal';
import { canPurgeNow, errMessage, fmtDay, invalidateLifecycle, loadOperateur, purgeAvailableFrom } from './lifecycleUtils';

export interface VersionLifecycle {
  /** Archive immédiatement une version active. */
  archive: (v: Version) => void;
  /** Ouvre la confirmation de réactivation. */
  reactivate: (v: Version) => void;
  /** Ouvre la modale de purge. */
  purge: (v: Version) => void;
  /** Version dont une mutation est en cours (archivage ou réactivation). */
  pendingId: string | null;
  /** Purge autorisée maintenant. */
  canPurge: (v: Version) => boolean;
  /** Bulle expliquant quand la purge deviendra possible (« Purger » sinon). */
  purgeHint: (v: Version) => string;
  /** Entrées de menu ⋯ adaptées au statut (vide pour une version purgée). */
  menuEntries: (v: Version) => MenuEntry[];
  /** Modales (purge, réactivation) à rendre une fois dans la page. */
  modals: ReactNode;
}

export function useVersionLifecycle(kind: Kind): VersionLifecycle {
  const qc = useQueryClient();
  const [toPurge, setToPurge] = useState<Version | null>(null);
  const [toReactivate, setToReactivate] = useState<Version | null>(null);

  const settings = useQuery({ queryKey: qk.settings(), queryFn: settingsApi.get });
  const delai = settings.data?.purge_delai_jours;
  // Version active courante, pour le texte de confirmation (même clé que la liste par défaut).
  const versions = useQuery({
    queryKey: [...qk.versions(kind), { includePurged: false }],
    queryFn: () => versionsApi.list(kind, false),
    enabled: toReactivate != null,
  });
  const currentActive = versions.data?.find((v) => v.statut === 'active') ?? null;

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

  const canPurge = (v: Version) => canPurgeNow(v, delai);

  const purgeHint = (v: Version): string => {
    if (delai == null || canPurgeNow(v, delai)) return 'Purger';
    const from = purgeAvailableFrom(v, delai);
    return `Purge possible à partir du ${from ? fmtDay(from) : '—'} (archivée depuis moins de ${delai} jour${
      delai > 1 ? 's' : ''
    })`;
  };

  const menuEntries = (v: Version): MenuEntry[] => {
    const busy = pendingId != null;
    if (v.statut === 'active')
      return [
        {
          label: 'Archiver',
          icon: <IconArchive size={15} />,
          disabled: busy,
          onSelect: () => archive.mutate(v),
        },
      ];
    if (v.statut === 'archivee') {
      const from = delai != null ? purgeAvailableFrom(v, delai) : null;
      return [
        { label: 'Réactiver…', icon: <IconRestore size={15} />, disabled: busy, onSelect: () => setToReactivate(v) },
        {
          label: 'Purger…',
          icon: <IconTrash size={15} />,
          destructive: true,
          disabled: !canPurge(v),
          hint: !canPurge(v) && from ? `dès le ${fmtDay(from)}` : undefined,
          onSelect: () => setToPurge(v),
        },
      ];
    }
    return [];
  };

  const modals = (
    <>
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
              « <b>{toReactivate.intitule}</b> » redeviendra la version active, utilisée par défaut par le pilotage.
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
    </>
  );

  return {
    archive: (v) => archive.mutate(v),
    reactivate: setToReactivate,
    purge: setToPurge,
    pendingId,
    canPurge,
    purgeHint,
    menuEntries,
    modals,
  };
}
