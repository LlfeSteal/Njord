// Modale de purge : rappelle les conditions (archivée depuis ≥ N jours, cf. settings.purge_delai_jours),
// exige la saisie exacte de l'intitulé, appelle versionsApi.purge et affiche le refus 409 éventuel.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
import { useEffect, useState } from 'react';
import { Alert, Button, Code, Group, List, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ApiError, settingsApi, versionsApi } from '../api/client';
import type { Kind, Version } from '../api/types';
import { fmtDateTime } from '../lib/format';
import { qk } from '../lib/queryKeys';
import ErrorAlert from './ErrorAlert';
import {
  canPurgeNow,
  fmtDay,
  invalidateLifecycle,
  loadOperateur,
  purgeAvailableFrom,
  saveOperateur,
} from './lifecycle/lifecycleUtils';

export interface PurgeModalProps {
  kind: Kind;
  version: Version | null; // null = fermée
  onClose: () => void;
  onPurged?: (v: Version) => void;
}

const LINES_LABEL: Record<Kind, string> = { plan: 'lignes du plan de charge', realise: 'écritures du réalisé' };

export default function PurgeModal({ kind, version, onClose, onPurged }: PurgeModalProps) {
  const qc = useQueryClient();
  const opened = version != null;
  const [confirm, setConfirm] = useState('');
  const [operateur, setOperateur] = useState('');
  // Conserve la dernière version affichée pendant l'animation de fermeture.
  const [shown, setShown] = useState<Version | null>(version);

  const settings = useQuery({ queryKey: qk.settings(), queryFn: settingsApi.get, enabled: opened });
  const delai = settings.data?.purge_delai_jours;

  const purge = useMutation({
    mutationFn: (v: Version) => versionsApi.purge(kind, v.id, confirm, operateur.trim() || undefined),
    onSuccess: (res) => {
      saveOperateur(operateur);
      invalidateLifecycle(qc);
      notifications.show({
        color: 'green',
        title: 'Version purgée',
        message: `La version « ${res.intitule} » a été définitivement supprimée.`,
      });
      onPurged?.(res);
      onClose();
    },
  });

  useEffect(() => {
    if (version) {
      setShown(version);
      setConfirm('');
      setOperateur(loadOperateur());
      purge.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.id]);

  const v = version ?? shown;
  const matches = v != null && confirm === v.intitule;
  const tooEarly = v != null && delai != null && !canPurgeNow(v, delai);
  const availableFrom = v && delai != null ? purgeAvailableFrom(v, delai) : null;
  const err = purge.error;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!purge.isPending) onClose();
      }}
      title={
        <Group gap="xs">
          <IconAlertTriangle size={20} color="var(--mantine-color-red-6)" aria-hidden />
          <Text fw={600}>Purger définitivement une version</Text>
        </Group>
      }
      size="lg"
      closeOnClickOutside={!purge.isPending}
    >
      {v && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !purge.isPending) purge.mutate(v);
          }}
        >
          <Stack gap="md">
            <Text size="sm">
              Version : <b>{v.intitule}</b> — archivée le {fmtDateTime(v.archivee_le)}
            </Text>

            <Alert color="red" variant="light" title="Conditions et effets de la purge">
              <List size="sm" spacing={4}>
                <List.Item>
                  La version doit être archivée depuis plus de{' '}
                  <b>{delai != null ? `${delai} jour${delai > 1 ? 's' : ''}` : 'N jours (paramètre « délai de purge »)'}</b>.
                </List.Item>
                <List.Item>
                  Les {LINES_LABEL[kind]} de cette version sont <b>supprimées définitivement</b> (irréversible).
                </List.Item>
                <List.Item>Les référentiels personnes et squads sont conservés.</List.Item>
                <List.Item>L'action est journalisée (opérateur, horodatage).</List.Item>
              </List>
            </Alert>

            {v.statut !== 'archivee' && (
              <Alert color="orange" variant="light">
                Seule une version archivée peut être purgée.
              </Alert>
            )}
            {v.statut === 'archivee' && tooEarly && availableFrom && (
              <Alert color="orange" variant="light">
                Purge possible à partir du {fmtDay(availableFrom)}. Le serveur refusera la demande d'ici là.
              </Alert>
            )}
            {settings.error && <ErrorAlert error={settings.error} title="Paramètres indisponibles" />}

            <TextInput
              label="Saisissez l'intitulé exact pour confirmer"
              description={
                <>
                  Intitulé attendu : <Code>{v.intitule}</Code>
                </>
              }
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              error={confirm !== '' && !matches ? "L'intitulé ne correspond pas (casse et espaces comprises)." : undefined}
              autoComplete="off"
              data-autofocus
              disabled={purge.isPending}
            />
            <TextInput
              label="Opérateur"
              description="Facultatif, enregistré dans le journal."
              placeholder="Votre nom"
              value={operateur}
              onChange={(e) => setOperateur(e.currentTarget.value)}
              disabled={purge.isPending}
            />

            {err && (
              <ErrorAlert
                error={err}
                title={err instanceof ApiError && err.status === 409 ? 'Purge refusée' : 'Échec de la purge'}
              />
            )}

            <Group justify="flex-end">
              <Button variant="default" onClick={onClose} disabled={purge.isPending}>
                Annuler
              </Button>
              <Button type="submit" color="red" disabled={!matches} loading={purge.isPending}>
                Purger définitivement
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
