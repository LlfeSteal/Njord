// Inspecteur « Infos » d'une version (plan ou réalisé) : fichier, contenu, cycle de vie et actions.
import type { ReactNode } from 'react';
import { Button, Inspector, InspectorSection, KeyValue, Tooltip, type KeyValueItem } from '../../ui';
import { IconArchive, IconRestore, IconTrash } from '../../ui/Icons';
import type { Version } from '../../api/types';
import { fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { StatusBadge } from '../badges';
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
      {children}
      <InspectorSection title="Cycle de vie">
        <KeyValue items={cycle} />
      </InspectorSection>
    </Inspector>
  );
}
