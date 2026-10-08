// Modale de purge : rappelle les conditions (archivée depuis ≥ N jours, cf. settings.purge_delai_jours),
// exige la saisie exacte de l'intitulé, appelle versionsApi.purge et affiche le refus 409 éventuel.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Code, Modal, Stack, Text, TextInput, toast } from '../ui';
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

const LINES_LABEL: Record<Kind, string> = {
  plan: 'lignes du plan de charge',
  realise: 'écritures du réalisé',
  provision: 'lignes de provisions',
};

export default function PurgeModal({ kind, version, onClose, onPurged }: PurgeModalProps) {
  const qc = useQueryClient();
  const opened = version != null;
  const formId = useId();
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
      toast({
        tone: 'success',
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
      title="Purger définitivement une version"
      size="lg"
      dismissable={!purge.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={purge.isPending}>
            Annuler
          </Button>
          {/* Bouton hors du <form> (pied de la modale) : rattaché via l'attribut form. */}
          <Button type="submit" form={formId} variant="primary" destructive disabled={!matches} loading={purge.isPending}>
            Purger définitivement
          </Button>
        </>
      }
    >
      {v && (
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !purge.isPending) purge.mutate(v);
          }}
        >
          <Stack gap={12}>
            <Text>
              Version : <b>{v.intitule}</b> — archivée le {fmtDateTime(v.archivee_le)}
            </Text>

            <Banner tone="error" title="Conditions et effets de la purge">
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                <li>
                  La version doit être archivée depuis plus de{' '}
                  <b>{delai != null ? `${delai} jour${delai > 1 ? 's' : ''}` : 'N jours (paramètre « délai de purge »)'}</b>.
                </li>
                <li>
                  Les {LINES_LABEL[kind]} de cette version sont <b>supprimées définitivement</b> (irréversible).
                </li>
                <li>Les référentiels personnes et squads sont conservés.</li>
                <li>L'action est journalisée (opérateur, horodatage).</li>
              </ul>
            </Banner>

            {v.statut !== 'archivee' && (
              <Banner tone="warning" compact>
                Seule une version archivée peut être purgée.
              </Banner>
            )}
            {v.statut === 'archivee' && tooEarly && availableFrom && (
              <Banner tone="warning" compact>
                Purge possible à partir du {fmtDay(availableFrom)}. Le serveur refusera la demande d'ici là.
              </Banner>
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
              onChange={setConfirm}
              error={confirm !== '' && !matches ? "L'intitulé ne correspond pas (casse et espaces comprises)." : undefined}
              autoFocus
              disabled={purge.isPending}
            />
            <TextInput
              label="Opérateur"
              description="Facultatif, enregistré dans le journal."
              placeholder="Votre nom"
              value={operateur}
              onChange={setOperateur}
              disabled={purge.isPending}
            />

            {err && (
              <ErrorAlert
                error={err}
                title={err instanceof ApiError && err.status === 409 ? 'Purge refusée' : 'Échec de la purge'}
              />
            )}
          </Stack>
        </form>
      )}
    </Modal>
  );
}
