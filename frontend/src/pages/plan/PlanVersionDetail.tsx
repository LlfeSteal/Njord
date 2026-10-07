// Détail d'une version de plan de charge : barre d'outils (retour, statut, compteurs, filtres),
// table paginée avec totaux en pied, inspecteur (ligne sélectionnée ou infos de la version).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card,
  EmptyState,
  Button,
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
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { planApi, versionsApi } from '../../api/client';
import type { PlanLine } from '../../api/types';
import { StatusBadge } from '../../components/badges';
import ErrorAlert from '../../components/ErrorAlert';
import ImportWizard from '../../components/ImportWizard';
import VersionInfoInspector from '../../components/lifecycle/VersionInfoInspector';
import VersionSwitcher from '../../components/lifecycle/VersionSwitcher';
import { useCurrentVersion } from '../../components/lifecycle/useCurrentVersion';
import { useVersionLifecycle } from '../../components/lifecycle/useVersionLifecycle';
import { plural } from '../../components/lifecycle/lifecycleUtils';
import { fmtDateTime, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { useSquadIndex } from '../referentiels/hooks';
import PlanLineInspector from './PlanLineInspector';
import PlanLinesFilters from './PlanLinesFilters';
import PlanLinesTable from './PlanLinesTable';
import { download } from './download';
import { PAGE_SIZES, useLineFilters, type SortKey } from './useLineFilters';
import './plan.css';

const NUMERIC_SORTS: SortKey[] = ['charge_totale', 'pps'];
const BACK = { to: '/plan', label: 'Plan de charge' };

type Panel = { type: 'info' } | { type: 'line'; line: PlanLine } | null;

/** `versionId` imposé = version courante affichée sur /plan ; sinon l'id de l'URL (/plan/:id). */
export default function PlanVersionDetail({ versionId: forced }: { versionId?: string } = {}) {
  const params = useParams();
  const versionId = forced ?? params.versionId ?? '';
  const [wizard, setWizard] = useState(false);
  const { filters, sort, order, limit, page, update, query } = useLineFilters();
  const { version: current } = useCurrentVersion('plan');
  const squads = useSquadIndex();
  const lc = useVersionLifecycle('plan');
  const [panel, setPanel] = useState<Panel>(null);

  const version = useQuery({
    queryKey: qk.version('plan', versionId),
    queryFn: () => versionsApi.get('plan', versionId),
  });
  const v = version.data;
  const purged = v?.statut === 'purgee';

  const facets = useQuery({
    queryKey: qk.facets('plan', versionId),
    queryFn: () => versionsApi.facets('plan', versionId),
    enabled: !purged,
  });

  const pageQuery = { ...query, limit, offset: (page - 1) * limit };
  const lines = useQuery({
    queryKey: qk.planLines(versionId, pageQuery),
    queryFn: () => planApi.lines(versionId, pageQuery),
    placeholderData: keepPreviousData,
    enabled: !purged,
  });

  const total = lines.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  // Page hors bornes (URL partagée, filtre plus restrictif) → dernière page.
  useEffect(() => {
    if (lines.data && !lines.isPlaceholderData && page > totalPages) update({ page: String(totalPages) });
  }, [lines.data, lines.isPlaceholderData, page, totalPages, update]);

  const onSort = (k: SortKey) => {
    if (k === sort) update({ order: order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: k, order: NUMERIC_SORTS.includes(k) ? 'desc' : 'asc' });
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
  ]
    .filter(Boolean)
    .join(' · ');
  // « Plan courant » = dernière version de la timeline (DECISIONS n° 13), pas forcément l'active.
  const subtitle =
    !current || current.id === v.id ? (
      summary
    ) : (
      <>
        {summary} · <Link to="/plan">Revenir au plan courant</Link>
      </>
    );

  const lifecycleEntries = lc.menuEntries(v);
  const menu: MenuEntry[] = [
    ...(!purged
      ? [
          {
            label: 'Exporter les lignes filtrées (CSV)',
            icon: <IconDownload size={15} />,
            onSelect: () => download(planApi.linesCsvUrl(versionId, query)),
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
    <PlanLineInspector
      line={selected}
      onClose={() => setPanel(null)}
      squadName={squads.name}
      squadPath={squads.label}
    />
  );

  return (
    <Page
      wide
      inspector={inspector}
      toolbar={
        <PageToolbar
          title={<VersionSwitcher kind="plan" current={v} basePath="/plan" onImport={() => setWizard(true)} />}
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
              <PlanLinesFilters
                filters={filters}
                update={update}
                facets={facets.data}
                squadLabel={squads.label}
                nbWarn={v.nb_warn}
              />
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
              <PlanLinesTable
                items={lines.data.items}
                total={total}
                totals={lines.data.totals}
                sort={sort}
                order={order}
                onSort={onSort}
                squadName={squads.name}
                squadPath={squads.label}
                          onSelect={(line) => setPanel({ type: 'line', line })}
                selectedId={selected?.id ?? null}
                dimmed={lines.isPlaceholderData}
              />
            )
          )}

          {lines.data && total > 0 && (
            <div className="plan-foot">
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

      <ImportWizard kind="plan" opened={wizard} onClose={() => setWizard(false)} />
      {lc.modals}
    </Page>
  );
}
