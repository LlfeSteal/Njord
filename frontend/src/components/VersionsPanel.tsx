// Page « liste des versions » d'un kind (plan | realise | provision) avec cycle de vie complet.
// Auto-suffisante : charge versionsApi.list, action « Importer » (ImportWizard), menu ⋯ « afficher les
// versions purgées », tri actives en tête / archivées grisées, actions en survol : consulter (onOpen),
// archiver / réactiver, purger (PurgeModal). Clic sur une ligne = onOpen.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Page,
  PageToolbar,
  SkeletonRows,
  StatusGlyph,
  Table,
  Text,
  Tooltip,
  VisuallyHidden,
} from '../ui';
import { IconArchive, IconEye, IconImport, IconRestore, IconTrash } from '../ui/Icons';
import { versionsApi } from '../api/client';
import type { Kind, Version } from '../api/types';
import { fmtNumber, fmtPeriod } from '../lib/format';
import { qk } from '../lib/queryKeys';
import { StatusBadge } from './badges';
import ErrorAlert from './ErrorAlert';
import ImportWizard from './ImportWizard';
import { plural } from './lifecycle/lifecycleUtils';
import { useVersionLifecycle } from './lifecycle/useVersionLifecycle';
import './VersionsPanel.css';

export interface VersionColumn {
  header: string;
  render: (v: Version) => ReactNode;
  /** Colonne numérique (alignée à droite, tabulaire). */
  align?: 'right';
}

export interface VersionsPanelProps {
  kind: Kind;
  /** Titre de la page (« Plan de charge », « Réalisé »). */
  title: string;
  /** Clic sur « consulter » ou sur la ligne. */
  onOpen: (v: Version) => void;
  /** Colonnes ajoutées avant les actions (ex. montant total pour le réalisé). */
  extraColumns?: VersionColumn[];
  /** Aide affichée dans l'état vide. */
  emptyHelp?: ReactNode;
  /** Lien de retour vers la version courante (« Plan de charge » → /plan). */
  back?: { to: string; label: string };
}

const STATUT_ORDER: Record<Version['statut'], number> = { active: 0, archivee: 1, purgee: 2 };

function sortVersions(list: Version[]): Version[] {
  return [...list].sort(
    (a, b) => STATUT_ORDER[a.statut] - STATUT_ORDER[b.statut] || b.importee_le.localeCompare(a.importee_le),
  );
}

const stop = (e: MouseEvent) => e.stopPropagation();

/** Glyphe de tête : rejets (danger) prioritaires sur les avertissements (warning). */
function QualityGlyph({ v }: { v: Version }) {
  if (!v.nb_warn && !v.nb_drop) return null;
  const parts = [
    v.nb_warn ? `${plural(v.nb_warn, 'ligne')} à vérifier` : '',
    v.nb_drop ? `${plural(v.nb_drop, 'ligne')} rejetée${v.nb_drop > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  return v.nb_drop ? (
    <StatusGlyph kind="danger" tone="danger" label={parts.join(' · ')} />
  ) : (
    <StatusGlyph kind="warning" tone="warning" label={parts.join(' · ')} />
  );
}

export default function VersionsPanel({ kind, title, onOpen, extraColumns = [], emptyHelp, back }: VersionsPanelProps) {
  const [includePurged, setIncludePurged] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const lc = useVersionLifecycle(kind);

  const versions = useQuery({
    queryKey: [...qk.versions(kind), { includePurged }],
    queryFn: () => versionsApi.list(kind, includePurged),
  });

  const list = sortVersions(versions.data ?? []);
  const currentActive = list.find((v) => v.statut === 'active') ?? null;

  const subtitle = versions.data
    ? `${plural(list.length, 'version')} · ${currentActive ? `active : ${currentActive.intitule}` : 'aucune version active'}`
    : undefined;

  const renderActions = (v: Version) => {
    if (v.statut === 'purgee') return null;
    const busy = lc.pendingId === v.id;
    const locked = lc.pendingId != null && !busy;
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
            disabled={locked}
            onClick={() => lc.archive(v)}
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
              disabled={locked}
              onClick={() => lc.reactivate(v)}
            >
              <IconRestore size={15} />
            </IconButton>
            {lc.canPurge(v) ? (
              <IconButton label="Purger" aria-label={`Purger « ${v.intitule} »`} destructive onClick={() => lc.purge(v)}>
                <IconTrash size={15} />
              </IconButton>
            ) : (
              // Bouton désactivé : la bulle explique quand la purge deviendra possible.
              <Tooltip label={lc.purgeHint(v)} maxWidth={280}>
                <IconButton label={lc.purgeHint(v)} destructive disabled>
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
          {emptyHelp ?? 'Importez un fichier Excel (.xlsx) pour créer la première version.'}
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Table hover className="versions-table" minWidth={640 + extraColumns.length * 120}>
        <thead>
          <tr>
            <th data-glyph>
              <VisuallyHidden>Contrôle</VisuallyHidden>
            </th>
            <th>Intitulé</th>
            <th>Statut</th>
            <th>Période</th>
            <th data-align="right">Lignes</th>
            {extraColumns.map((c) => (
              <th key={c.header} data-align={c.align}>
                {c.header}
              </th>
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
                data-muted={v.statut === 'archivee' || undefined}
                data-strike={purged || undefined}
              >
                <td data-glyph>{!purged && <QualityGlyph v={v} />}</td>
                <td className="versions-table__title">
                  {v.statut === 'active' ? (
                    <Text as="span" weight={600}>
                      {v.intitule}
                    </Text>
                  ) : (
                    v.intitule
                  )}
                </td>
                <td data-nowrap>
                  <StatusBadge statut={v.statut} />
                </td>
                <td data-nowrap>{fmtPeriod(v.periode_debut, v.periode_fin)}</td>
                <td data-align="right">{fmtNumber(v.nb_lignes)}</td>
                {extraColumns.map((c) => (
                  <td key={c.header} data-align={c.align} data-nowrap>
                    {c.render(v)}
                  </td>
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
    <Page
      toolbar={
        <PageToolbar
          back={back}
          title={title}
          subtitle={subtitle}
          actions={
            <Button variant="primary" icon={<IconImport size={15} />} onClick={() => setWizardOpen(true)}>
              Importer
            </Button>
          }
          menu={[
            {
              label: 'Afficher les versions purgées',
              checked: includePurged,
              onSelect: () => setIncludePurged((x) => !x),
            },
          ]}
        />
      }
    >
      {body}

      <ImportWizard kind={kind} opened={wizardOpen} onClose={() => setWizardOpen(false)} />
      {lc.modals}
    </Page>
  );
}
