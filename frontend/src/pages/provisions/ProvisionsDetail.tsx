// Détail d'une version de provisions (DECISIONS n° 16) : barre d'outils (historique, statut, compteurs,
// filtres), lignes paginées avec total en pied, inspecteur (ligne sélectionnée ou infos de la version).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Link,
  LoadingBlock,
  Page,
  PageToolbar,
  Pagination,
  Select,
  SkeletonRows,
  Stack,
  type MenuEntry,
} from '../../ui';
import { IconDownload, IconImport, IconInfo } from '../../ui/Icons';
import { provisionApi, versionsApi } from '../../api/client';
import type { ProvisionLine } from '../../api/types';
import { StatusBadge } from '../../components/badges';
import ErrorAlert from '../../components/ErrorAlert';
import ImportWizard from '../../components/ImportWizard';
import VersionInfoInspector from '../../components/lifecycle/VersionInfoInspector';
import VersionSwitcher from '../../components/lifecycle/VersionSwitcher';
import { useVersionLifecycle } from '../../components/lifecycle/useVersionLifecycle';
import { plural } from '../../components/lifecycle/lifecycleUtils';
import { fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { download } from '../plan/download';
import ProvisionLineInspector from './ProvisionLineInspector';
import ProvisionLinesFilters from './ProvisionLinesFilters';
import ProvisionLinesTable from './ProvisionLinesTable';
import { PAGE_SIZES, useProvisionFilters, type SortKey } from './useProvisionFilters';
import './provisions.css';

const BACK = { to: '/provisions', label: 'Provisions' };

type Panel = { type: 'info' } | { type: 'line'; line: ProvisionLine } | null;

/** `versionId` imposé = version courante affichée sur /provisions ; sinon l'id de l'URL (/provisions/:id). */
export default function ProvisionsDetail({ versionId: forced }: { versionId?: string } = {}) {
  const params = useParams();
  const versionId = forced ?? params.versionId ?? '';
  const [wizard, setWizard] = useState(false);
  const { filters, sort, order, limit, page, update, query } = useProvisionFilters();
  const lc = useVersionLifecycle('provision');
  const [panel, setPanel] = useState<Panel>(null);

  const version = useQuery({
    queryKey: qk.version('provision', versionId),
    queryFn: () => versionsApi.get('provision', versionId),
    enabled: !!versionId,
  });
  const v = version.data;
  const purged = v?.statut === 'purgee';

  const facets = useQuery({
    queryKey: qk.facets('provision', versionId),
    queryFn: () => versionsApi.facets('provision', versionId),
    enabled: !!v && !purged,
    staleTime: 5 * 60_000,
  });

  const pageQuery = { ...query, limit, offset: (page - 1) * limit };
  const lines = useQuery({
    queryKey: qk.provisionLines(versionId, pageQuery),
    queryFn: () => provisionApi.lines(versionId, pageQuery),
    placeholderData: keepPreviousData,
    enabled: !!v && !purged,
  });

  const total = lines.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  // Page hors bornes (URL partagée, filtre plus restrictif) → dernière page.
  useEffect(() => {
    if (lines.data && !lines.isPlaceholderData && page > totalPages) update({ page: String(totalPages) });
  }, [lines.data, lines.isPlaceholderData, page, totalPages, update]);

  const onSort = (k: SortKey) => {
    if (k === sort) update({ order: order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: k, order: k === 'montant' ? 'desc' : 'asc' });
  };

  if (version.isLoading) return <LoadingBlock />;
  if (version.error || !v) {
    return (
      <Page toolbar={<PageToolbar back={BACK} title="Version introuvable" />}>
        <ErrorAlert error={version.error ?? 'Version introuvable'} title="Version introuvable" />
      </Page>
    );
  }

  const summary = [
    plural(v.nb_lignes, 'ligne'),
    v.nb_warn ? `${fmtNumber(v.nb_warn)} à vérifier` : '',
    v.nb_drop ? `${fmtNumber(v.nb_drop)} rejetée${v.nb_drop > 1 ? 's' : ''}` : '',
    fmtPeriod(v.periode_debut, v.periode_fin),
    v.montant_total_eur != null ? fmtEur(v.montant_total_eur) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const subtitle =
    v.statut === 'active' ? (
      summary
    ) : (
      <>
        {summary} · <Link to="/provisions">Revenir à la version active</Link>
      </>
    );

  const lifecycleEntries = lc.menuEntries(v);
  const menu: MenuEntry[] = [
    ...(!purged
      ? [
          {
            label: 'Exporter les lignes filtrées (CSV)',
            icon: <IconDownload size={15} />,
            onSelect: () => download(provisionApi.linesCsvUrl(versionId, query)),
          },
        ]
      : []),
    ...(lifecycleEntries.length && !purged ? [{ type: 'separator' as const }] : []),
    ...lifecycleEntries,
  ];

  const infoOpen = panel?.type === 'info';
  const selected = panel?.type === 'line' ? panel.line : null;

  const inspector = infoOpen ? (
    <VersionInfoInspector version={v} opened onClose={() => setPanel(null)} lifecycle={lc} />
  ) : (
    <ProvisionLineInspector line={selected} onClose={() => setPanel(null)} />
  );

  return (
    <Page
      wide
      inspector={inspector}
      toolbar={
        <PageToolbar
          title={
            <VersionSwitcher kind="provision" current={v} basePath="/provisions" onImport={() => setWizard(true)} />
          }
          accessory={<StatusBadge statut={v.statut} />}
          subtitle={subtitle}
          actions={
            <>
              <Button icon={<IconImport size={15} />} onClick={() => setWizard(true)}>
                Importer
              </Button>
              <IconButton
                label="Infos"
                aria-pressed={infoOpen}
                onClick={() => setPanel(infoOpen ? null : { type: 'info' })}
              >
                <IconInfo size={16} />
              </IconButton>
            </>
          }
          menu={menu.length ? menu : undefined}
          bottom={
            purged ? undefined : (
              <ProvisionLinesFilters filters={filters} update={update} facets={facets.data} nbWarn={v.nb_warn} />
            )
          }
        />
      }
    >
      {purged ? (
        <Card>
          <EmptyState title="Version purgée">
            Ses lignes ont été définitivement supprimées{v.purgee_le ? ` le ${fmtDateTime(v.purgee_le)}` : ''}.
          </EmptyState>
        </Card>
      ) : (
        <Stack gap={12}>
          <ErrorAlert error={facets.error} title="Filtres indisponibles" />
          <ErrorAlert error={lines.error} title="Chargement des lignes impossible" />

          {lines.isLoading ? (
            <SkeletonRows rows={10} />
          ) : (
            lines.data && (
              <ProvisionLinesTable
                items={lines.data.items}
                total={total}
                totals={lines.data.totals}
                sort={sort}
                order={order}
                onSort={onSort}
                onSelect={(line) => setPanel({ type: 'line', line })}
                selectedId={selected?.id ?? null}
                dimmed={lines.isPlaceholderData}
              />
            )
          )}

          {lines.data && total > 0 && (
            <div className="provisions-foot">
              <Pagination
                page={Math.min(page, totalPages)}
                total={totalPages}
                onChange={(p) => update({ page: String(p) })}
                summary={`${fmtNumber((page - 1) * limit + 1)}–${fmtNumber(Math.min(page * limit, total))} sur ${plural(total, 'ligne')}`}
              />
              <Select
                aria-label="Lignes par page"
                data={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }))}
                value={String(limit)}
                onChange={(val) => val && update({ limit: val })}
              />
            </div>
          )}
        </Stack>
      )}

      <ImportWizard kind="provision" opened={wizard} onClose={() => setWizard(false)} />
      {lc.modals}
    </Page>
  );
}
