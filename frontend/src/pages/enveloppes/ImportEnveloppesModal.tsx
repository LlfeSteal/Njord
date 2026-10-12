// Import du fichier « CàT par CT » (DECISIONS n° 18) : dépôt .xlsx → aperçu (bilan) → « Remplacer les enveloppes ».
// Pas de versions : la confirmation remplace toutes les enveloppes ; un CT absent du fichier perd la sienne.
import { useEffect, useState, type ReactNode } from 'react';
import { Banner, Button, Card, FileDrop, Group, Modal, Stack, Steps, Text, TextInput, toast } from '../../ui';
import { IconFileSpreadsheet } from '../../ui/Icons';
import { ApiError } from '../../api/client';
import ErrorAlert from '../../components/ErrorAlert';
import ImportReportView from '../../components/lifecycle/ImportReportView';
import { errMessage, loadOperateur, saveOperateur } from '../../components/lifecycle/lifecycleUtils';
import { nEnveloppes, useCommitEnveloppes, usePreviewEnveloppes } from './hooks';

const MAX_SIZE = 50 * 1024 * 1024;

const STEPS = [
  { label: 'Fichier', description: 'Dépôt et analyse' },
  { label: 'Bilan', description: 'Contrôle et remplacement' },
];

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

function rejectionMessage(reason: string): string {
  if (/volumineux/i.test(reason)) return 'Fichier trop volumineux (50 Mo maximum).';
  if (/format/i.test(reason)) return 'Format non accepté : déposez le fichier Excel .xlsx « CàT par CT ».';
  if (/un seul/i.test(reason)) return 'Un seul fichier à la fois.';
  return reason || 'Fichier refusé.';
}

/** Erreur bloquante (422 : en-tête introuvable, fichier illisible, aucune enveloppe valide) : message du serveur. */
function BlockingError({ error, title }: { error: unknown; title: string }) {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 422)
    return (
      <Banner tone="error" title={title}>
        <Text as="span" style={{ display: 'block' }}>
          {errMessage(error)}
        </Text>
        <Text as="span" mt={6} style={{ display: 'block' }}>
          Aucune enveloppe n'a été modifiée.
        </Text>
      </Banner>
    );
  return <ErrorAlert error={error} title={title} />;
}

export default function ImportEnveloppesModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [importeur, setImporteur] = useState('');
  const preview = usePreviewEnveloppes();
  const commit = useCommitEnveloppes();
  const report = preview.data ?? null;

  // État propre à chaque ouverture.
  useEffect(() => {
    if (opened) {
      setImporteur(loadOperateur());
      return;
    }
    setStep(0);
    setFile(null);
    setRejectMsg(null);
    preview.reset();
    commit.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const resetFile = (f: File | null) => {
    setFile(f);
    setRejectMsg(null);
    preview.reset();
    commit.reset();
  };

  const analyse = () => {
    if (!file) return;
    preview.mutate(file, { onSuccess: () => setStep(1) });
  };

  const replace = () => {
    if (!file) return;
    const who = importeur.trim();
    commit.mutate(
      { file, importeur: who || undefined },
      {
        onSuccess: (r) => {
          saveOperateur(who);
          toast({
            tone: 'success',
            title: 'Enveloppes remplacées',
            message: `${nEnveloppes(r.ok + r.warn)} importées depuis « ${r.filename || file.name} ».`,
          });
          onClose();
        },
      },
    );
  };

  const busy = preview.isPending || commit.isPending;
  const nb = report ? report.ok + report.warn : 0;
  let content: ReactNode = null;
  let footer: ReactNode = null;

  if (step === 0 || !report) {
    content = (
      <Stack gap={8}>
        {!file ? (
          <FileDrop
            onFile={resetFile}
            onReject={(reason) => setRejectMsg(rejectionMessage(reason))}
            accept={['.xlsx']}
            maxSize={MAX_SIZE}
          >
            <Stack gap={4} align="center">
              <IconFileSpreadsheet size={40} />
              <Text weight={500}>Glissez le fichier « CàT par CT » (.xlsx) ici ou cliquez pour le sélectionner</Text>
              <Text size="sm" tone="secondary">
                Colonnes lues : Nom, Descriptif, dates de début et de fin, Coût prévisionnel. 50 Mo maximum.
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
              <Button variant="plain" size="sm" onClick={() => resetFile(null)} disabled={busy}>
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
        <BlockingError error={preview.error} title="Analyse impossible" />
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
          <Button variant="primary" onClick={analyse} disabled={!file} loading={preview.isPending}>
            Analyser
          </Button>
        )}
      </>
    );
  } else {
    content = (
      <Stack gap={12}>
        <ImportReportView report={report} />
        {nb === 0 ? (
          <Banner tone="warning" compact>
            Aucune enveloppe valide dans ce fichier : il ne peut pas être importé.
          </Banner>
        ) : (
          <Banner tone="warning" title="Toutes les enveloppes seront remplacées">
            Les {nEnveloppes(nb)} de ce fichier remplacent toutes les enveloppes actuelles ; les CT absents du fichier perdent la
            leur et n'ont plus de budget.
          </Banner>
        )}
        <BlockingError error={commit.error} title="Échec de l'import" />
      </Stack>
    );
    footer = (
      <>
        <Button onClick={() => setStep(0)} disabled={commit.isPending}>
          Retour
        </Button>
        <Button variant="primary" onClick={replace} loading={commit.isPending} disabled={nb === 0}>
          Remplacer les enveloppes
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
      title="Importer le fichier CàT"
      dismissable={!busy}
      footer={footer}
    >
      <Stack gap={16}>
        <Steps active={report ? step : 0} steps={STEPS} />
        {content}
      </Stack>
    </Modal>
  );
}
