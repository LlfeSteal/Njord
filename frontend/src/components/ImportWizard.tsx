// Assistant d'import en 2 temps (preview → confirmation), commun plan / réalisé.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Étapes : dépôt .xlsx (Dropzone) + intitulé optionnel + importeur optionnel → versionsApi.preview
// → affichage du bilan (ImportReport : totaux ok/warn/drop, période, layout & % inactifs &
//   nouvelles personnes/squads pour le plan, montant total pour le réalisé, motifs, issues)
// → si report.active_version : case « Archiver la version active « X » ? » (cochée par défaut)
// → versionsApi.commit → notification, invalidation ['versions'] et ['analyse'], onImported.
// Les erreurs bloquantes (422 : onglet introuvable, en-tête non conforme) s'affichent dans l'assistant.
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Stack,
  Stepper,
  Text,
  TextInput,
} from '@mantine/core';
import { Dropzone, type FileRejection } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconFileSpreadsheet, IconUpload, IconX } from '@tabler/icons-react';
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

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

function rejectionMessage(rej: FileRejection[]): string {
  const codes = rej.flatMap((r) => r.errors.map((e) => e.code));
  if (codes.includes('file-too-large')) return 'Fichier trop volumineux (50 Mo maximum).';
  if (codes.includes('file-invalid-type')) return 'Format non accepté : déposez un fichier Excel .xlsx.';
  if (codes.includes('too-many-files')) return 'Un seul fichier à la fois.';
  return rej[0]?.errors[0]?.message ?? 'Fichier refusé.';
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
      notifications.show({
        color: 'green',
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

  const onDrop = (files: File[]) => {
    const f = files[0];
    if (!f) return;
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

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!commit.isPending) onClose();
      }}
      size="xl"
      title={<Text fw={600}>Importer un fichier — {KIND_LABEL[kind]}</Text>}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stepper
        active={step}
        onStepClick={(s) => {
          if (!busy && s < step) setStep(s);
        }}
        allowNextStepsSelect={false}
        size="sm"
        mb="md"
      >
        {/* ---------------------------------------------------------------- 1. Fichier */}
        <Stepper.Step label="Fichier" description="Dépôt et analyse">
          <Stack gap="sm" mt="md">
            {!file ? (
              <Dropzone
                onDrop={onDrop}
                onReject={(rej) => setRejectMsg(rejectionMessage(rej))}
                accept={{ [XLSX_MIME]: ['.xlsx'] }}
                maxSize={MAX_SIZE}
                maxFiles={1}
                multiple={false}
                aria-label="Déposer un fichier Excel .xlsx"
              >
                <Group justify="center" gap="md" mih={120} style={{ pointerEvents: 'none' }}>
                  <Dropzone.Accept>
                    <IconUpload size={40} stroke={1.5} aria-hidden />
                  </Dropzone.Accept>
                  <Dropzone.Reject>
                    <IconX size={40} stroke={1.5} aria-hidden />
                  </Dropzone.Reject>
                  <Dropzone.Idle>
                    <IconFileSpreadsheet size={40} stroke={1.5} aria-hidden />
                  </Dropzone.Idle>
                  <div>
                    <Text size="lg">Glissez un fichier .xlsx ici ou cliquez pour le sélectionner</Text>
                    <Text size="sm" c="dimmed">
                      Un seul fichier Excel, 50 Mo maximum.
                    </Text>
                  </div>
                </Group>
              </Dropzone>
            ) : (
              <Paper withBorder p="sm" radius="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <IconFileSpreadsheet size={28} stroke={1.5} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <Text fw={500} truncate>
                        {file.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {fmtSize(file.size)}
                      </Text>
                    </div>
                  </Group>
                  <Button variant="subtle" size="xs" onClick={changeFile} disabled={busy}>
                    Changer de fichier
                  </Button>
                </Group>
              </Paper>
            )}

            {rejectMsg && (
              <Alert color="red" variant="light" title="Fichier refusé">
                {rejectMsg}
              </Alert>
            )}

            {previewErr &&
              (blocking ? (
                <Alert
                  color="red"
                  variant="light"
                  title={`Import impossible — ${BLOCKING_TITLES[(previewErr as ApiError).code] ?? 'erreur bloquante'}`}
                >
                  <Text size="sm">{errMessage(previewErr)}</Text>
                  <Text size="sm" mt={6}>
                    Aucune donnée n'a été écrite. Vérifiez le fichier puis{' '}
                    <Text span inherit fw={600}>
                      changez de fichier
                    </Text>
                    .
                  </Text>
                </Alert>
              ) : (
                <ErrorAlert error={previewErr} title="Analyse impossible" />
              ))}

            <TextInput
              label="Intitulé de la version"
              description="Facultatif : par défaut, le nom du fichier sans extension."
              placeholder={file ? stripExt(file.name) : 'ex. Plan S40'}
              value={intitule}
              onChange={(e) => {
                setIntitule(e.currentTarget.value);
              }}
              disabled={busy}
            />
            <TextInput
              label="Importeur"
              description="Facultatif, mémorisé sur ce poste."
              placeholder="Votre nom"
              value={importeur}
              onChange={(e) => setImporteur(e.currentTarget.value)}
              onBlur={() => saveOperateur(importeur)}
              disabled={busy}
            />

            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={onClose} disabled={busy}>
                Annuler
              </Button>
              {report ? (
                <Button onClick={() => setStep(1)}>Voir le bilan</Button>
              ) : (
                <Button onClick={() => file && preview.mutate(file)} disabled={!file} loading={preview.isPending}>
                  Analyser
                </Button>
              )}
            </Group>
          </Stack>
        </Stepper.Step>

        {/* ---------------------------------------------------------------- 2. Bilan */}
        <Stepper.Step label="Bilan" description="Contrôle du parsing">
          {report && (
            <Stack gap="md" mt="md">
              <ImportReportView report={report} />

              {active ? (
                <Paper withBorder p="sm" radius="sm">
                  <Checkbox
                    checked={archiveActive}
                    onChange={(e) => setArchiveActive(e.currentTarget.checked)}
                    label={`Archiver la version active « ${active.intitule} » (importée le ${fmtDateTime(
                      active.importee_le,
                    )})`}
                  />
                  {!archiveActive && (
                    <Alert color="yellow" variant="light" mt="sm">
                      La version active est conservée : la nouvelle version sera créée en statut archivée.
                    </Alert>
                  )}
                </Paper>
              ) : (
                <Text size="sm" c="dimmed">
                  Aucune version active : la nouvelle version deviendra la version active.
                </Text>
              )}

              {report.ok + report.warn === 0 && (
                <Alert color="orange" variant="light">
                  Aucune ligne exploitable (toutes les lignes sont en drop).
                </Alert>
              )}

              <Group justify="space-between">
                <Button variant="default" onClick={() => setStep(0)}>
                  Retour
                </Button>
                <Button onClick={() => setStep(2)}>Continuer</Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>

        {/* ---------------------------------------------------------------- 3. Confirmation */}
        <Stepper.Step label="Import" description="Confirmation">
          {report && file && (
            <Stack gap="md" mt="md">
              <Paper withBorder p="sm" radius="sm">
                <Stack gap={4}>
                  <Text size="sm">
                    Fichier : <b>{file.name}</b>
                  </Text>
                  <Text size="sm">
                    Intitulé : <b>{intitule.trim() || stripExt(file.name)}</b>
                  </Text>
                  <Text size="sm">
                    Importeur : <b>{importeur.trim() || '—'}</b>
                  </Text>
                  <Text size="sm">
                    Lignes : <b>{fmtNumber(report.total)}</b> (ok {fmtNumber(report.ok)}, warn{' '}
                    {fmtNumber(report.warn)}, drop {fmtNumber(report.drop)})
                  </Text>
                  <Text size="sm">
                    Statut de la nouvelle version :{' '}
                    <b>{!active || archiveActive ? 'active' : 'archivée'}</b>
                    {active && archiveActive && <> — « {active.intitule} » sera archivée</>}
                  </Text>
                </Stack>
              </Paper>

              {commit.error && <ErrorAlert error={commit.error} title="Échec de l'import" />}

              <Group justify="space-between">
                <Button variant="default" onClick={() => setStep(1)} disabled={commit.isPending}>
                  Retour
                </Button>
                <Button onClick={() => commit.mutate(file)} loading={commit.isPending}>
                  Importer
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Step>
      </Stepper>
    </Modal>
  );
}
