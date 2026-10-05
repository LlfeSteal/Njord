// Assistant d'import en 2 temps (preview → confirmation), commun plan / réalisé.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Étapes : dépôt .xlsx (FileDrop) + intitulé optionnel + importeur optionnel → versionsApi.preview
// → affichage du bilan (ImportReport : totaux ok/warn/drop, période, layout & % inactifs &
//   nouvelles personnes/squads pour le plan, montant total pour le réalisé, motifs, issues)
// → si report.active_version : case « Archiver la version active « X » ? » (cochée par défaut)
// → versionsApi.commit → notification, invalidation ['versions'] et ['analyse'], onImported.
// Les erreurs bloquantes (422 : onglet introuvable, en-tête non conforme) s'affichent dans l'assistant.
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  FileDrop,
  Group,
  Modal,
  Stack,
  Steps,
  Text,
  TextInput,
  toast,
} from '../ui';
import { IconFileSpreadsheet } from '../ui/Icons';
import { ApiError, versionsApi } from '../api/client';
import type { ImportReport, ImportResult, Kind } from '../api/types';
import { fmtDateTime, fmtNumber } from '../lib/format';
import ErrorAlert from './ErrorAlert';
import ImportReportView from './lifecycle/ImportReportView';
import { errMessage, invalidateLifecycle, loadOperateur, saveOperateur } from './lifecycle/lifecycleUtils';

export interface ImportWizardProps {
  kind: Kind;
  opened: boolean;
  onClose: () => void;
  onImported?: (r: ImportResult) => void;
}

const MAX_SIZE = 50 * 1024 * 1024;
const KIND_LABEL: Record<Kind, string> = { plan: 'plan de charge', realise: 'réalisé' };

const BLOCKING_TITLES: Record<string, string> = {
  sheet_not_found: 'Onglet introuvable',
  header_invalid: 'En-tête non conforme',
  file_invalid: 'Fichier illisible',
};

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '');

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

const STEPS = [
  { label: 'Fichier', description: 'Dépôt et analyse' },
  { label: 'Bilan', description: 'Contrôle du parsing' },
  { label: 'Import', description: 'Confirmation' },
];

/** Reformule le motif de refus du FileDrop avec les messages métier de l'assistant. */
function rejectionMessage(reason: string): string {
  if (/volumineux/i.test(reason)) return 'Fichier trop volumineux (50 Mo maximum).';
  if (/format/i.test(reason)) return 'Format non accepté : déposez un fichier Excel .xlsx.';
  if (/un seul/i.test(reason)) return 'Un seul fichier à la fois.';
  return reason || 'Fichier refusé.';
}

export default function ImportWizard({ kind, opened, onClose, onImported }: ImportWizardProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [intitule, setIntitule] = useState('');
  const [importeur, setImporteur] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [archiveActive, setArchiveActive] = useState(true);

  const preview = useMutation({
    mutationFn: (f: File) => versionsApi.preview(kind, f, intitule.trim() || undefined),
    onSuccess: (r) => {
      setReport(r);
      setArchiveActive(true);
      setStep(1);
    },
  });

  const commit = useMutation({
    mutationFn: (f: File) =>
      versionsApi.commit(kind, f, {
        intitule: intitule.trim() || undefined,
        importeur: importeur.trim() || undefined,
        archive_active: archiveActive,
      }),
    onSuccess: (res) => {
      saveOperateur(importeur);
      invalidateLifecycle(qc, true);
      toast({
        tone: 'success',
        title: 'Import réussi',
        message: `Version « ${res.version.intitule} » créée (${fmtNumber(res.version.nb_lignes)} lignes, statut ${
          res.version.statut === 'active' ? 'active' : 'archivée'
        }).`,
      });
      onImported?.(res);
      onClose();
    },
  });

  // Réinitialisation complète à chaque fermeture (et état propre à l'ouverture).
  useEffect(() => {
    if (opened) {
      setImporteur(loadOperateur());
      return;
    }
    setStep(0);
    setFile(null);
    setRejectMsg(null);
    setIntitule('');
    setReport(null);
    setArchiveActive(true);
    preview.reset();
    commit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const invalidatePreview = () => {
    setReport(null);
    preview.reset();
    commit.reset();
  };

  const onDrop = (f: File) => {
    setFile(f);
    setRejectMsg(null);
    invalidatePreview();
  };

  const changeFile = () => {
    setFile(null);
    setRejectMsg(null);
    invalidatePreview();
  };

  const busy = preview.isPending || commit.isPending;
  const previewErr = preview.error;
  const blocking = previewErr instanceof ApiError && previewErr.status === 422;
  const active = report?.active_version ?? null;

  // Contenu et actions de pied propres à chaque étape.
  let content: ReactNode = null;
  let footer: ReactNode = null;

  if (step === 0) {
    // ---------------------------------------------------------------- 1. Fichier
    content = (
      <Stack gap={8}>
        {!file ? (
          <FileDrop
            onFile={onDrop}
            onReject={(reason) => setRejectMsg(rejectionMessage(reason))}
            accept={['.xlsx']}
            maxSize={MAX_SIZE}
          >
            <Stack gap={4} align="center">
              <IconFileSpreadsheet size={40} />
              <Text weight={500}>Glissez un fichier .xlsx ici ou cliquez pour le sélectionner</Text>
              <Text size="sm" tone="secondary">
                Un seul fichier Excel, 50 Mo maximum.
              </Text>
            </Stack>
          </FileDrop>
        ) : (
          <Card padding={12}>
            <Group justify="between" wrap={false}>
              <Group gap={8} wrap={false} style={{ minWidth: 0 }}>
                <IconFileSpreadsheet size={20} />
                <div style={{ minWidth: 0 }}>
                  <Text weight={500} truncate>
                    {file.name}
                  </Text>
                  <Text size="sm" tone="secondary" tabular>
                    {fmtSize(file.size)}
                  </Text>
                </div>
              </Group>
              <Button variant="plain" size="sm" onClick={changeFile} disabled={busy}>
                Changer de fichier
              </Button>
            </Group>
          </Card>
        )}

        {rejectMsg && (
          <Banner tone="error" title="Fichier refusé">
            {rejectMsg}
          </Banner>
        )}

        {previewErr &&
          (blocking ? (
            <Banner
              tone="error"
              title={`Import impossible — ${BLOCKING_TITLES[(previewErr as ApiError).code] ?? 'erreur bloquante'}`}
            >
              <Text as="span" style={{ display: 'block' }}>
                {errMessage(previewErr)}
              </Text>
              <Text as="span" mt={6} style={{ display: 'block' }}>
                Aucune donnée n'a été écrite. Vérifiez le fichier puis <b>changez de fichier</b>.
              </Text>
            </Banner>
          ) : (
            <ErrorAlert error={previewErr} title="Analyse impossible" />
          ))}

        <TextInput
          label="Intitulé de la version"
          description="Facultatif : par défaut, le nom du fichier sans extension."
          placeholder={file ? stripExt(file.name) : 'ex. Plan S40'}
          value={intitule}
          onChange={setIntitule}
          disabled={busy}
        />
        <TextInput
          label="Importeur"
          description="Facultatif, mémorisé sur ce poste."
          placeholder="Votre nom"
          value={importeur}
          onChange={setImporteur}
          onBlur={() => saveOperateur(importeur)}
          disabled={busy}
        />
      </Stack>
    );
    footer = (
      <>
        <Button onClick={onClose} disabled={busy}>
          Annuler
        </Button>
        {report ? (
          <Button variant="primary" onClick={() => setStep(1)}>
            Voir le bilan
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => file && preview.mutate(file)}
            disabled={!file}
            loading={preview.isPending}
          >
            Analyser
          </Button>
        )}
      </>
    );
  } else if (step === 1 && report) {
    // ---------------------------------------------------------------- 2. Bilan
    content = (
      <Stack gap={12}>
        <ImportReportView report={report} />

        {active ? (
          <Card padding={12}>
            <Checkbox
              checked={archiveActive}
              onChange={setArchiveActive}
              label={`Archiver la version active « ${active.intitule} » (importée le ${fmtDateTime(
                active.importee_le,
              )})`}
            />
            {!archiveActive && (
              <Banner tone="warning" compact mt={8}>
                La version active est conservée : la nouvelle version sera créée en statut archivée.
              </Banner>
            )}
          </Card>
        ) : (
          <Text tone="secondary">Aucune version active : la nouvelle version deviendra la version active.</Text>
        )}

        {report.ok + report.warn === 0 && (
          <Banner tone="warning" compact>
            Aucune ligne exploitable (toutes les lignes sont en drop).
          </Banner>
        )}
      </Stack>
    );
    footer = (
      <>
        <Button onClick={() => setStep(0)}>Retour</Button>
        <Button variant="primary" onClick={() => setStep(2)}>
          Continuer
        </Button>
      </>
    );
  } else if (step === 2 && report && file) {
    // ---------------------------------------------------------------- 3. Confirmation
    content = (
      <Stack gap={12}>
        <Card padding={12}>
          <Stack gap={4}>
            <Text>
              Fichier : <b>{file.name}</b>
            </Text>
            <Text>
              Intitulé : <b>{intitule.trim() || stripExt(file.name)}</b>
            </Text>
            <Text>
              Importeur : <b>{importeur.trim() || '—'}</b>
            </Text>
            <Text tabular>
              Lignes : <b>{fmtNumber(report.total)}</b> (ok {fmtNumber(report.ok)}, warn {fmtNumber(report.warn)},
              drop {fmtNumber(report.drop)})
            </Text>
            <Text>
              Statut de la nouvelle version : <b>{!active || archiveActive ? 'active' : 'archivée'}</b>
              {active && archiveActive && <> — « {active.intitule} » sera archivée</>}
            </Text>
          </Stack>
        </Card>

        {commit.error && <ErrorAlert error={commit.error} title="Échec de l'import" />}
      </Stack>
    );
    footer = (
      <>
        <Button onClick={() => setStep(1)} disabled={commit.isPending}>
          Retour
        </Button>
        <Button variant="primary" onClick={() => commit.mutate(file)} loading={commit.isPending}>
          Importer
        </Button>
      </>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!commit.isPending) onClose();
      }}
      size="lg"
      title={`Importer un fichier — ${KIND_LABEL[kind]}`}
      dismissable={!busy}
      footer={footer}
    >
      <Stack gap={16}>
        <Steps active={step} steps={STEPS} />
        {content}
      </Stack>
    </Modal>
  );
}
