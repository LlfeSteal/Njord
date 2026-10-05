// Détail d'une version de plan de charge (§7.3) : en-tête, filtres, table paginée, totaux, export, alias.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Banner,
  Card,
  Group,
  Link,
  LoadingBlock,
  Pagination,
  Select,
  SkeletonRows,
  Spinner,
  Stack,
  Tag,
  Text,
  Title,
} from '../../ui';
import { IconArrowLeft } from '../../ui/Icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { planApi, versionsApi } from '../../api/client';
import type { PlanLine } from '../../api/types';
import { StatusBadge } from '../../components/badges';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime, fmtEur, fmtHours, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { useSquadIndex } from '../referentiels/hooks';
import AliasPersonneModal from './AliasPersonneModal';
import PlanLinesFilters from './PlanLinesFilters';
import PlanLinesTable from './PlanLinesTable';
import { PAGE_SIZES, useLineFilters, type SortKey } from './useLineFilters';

const NUMERIC_SORTS: SortKey[] = ['charge_totale', 'pps'];

export default function PlanVersionDetail() {
  const { versionId = '' } = useParams();
  const { filters, sort, order, limit, page, update, reset, query, activeCount } = useLineFilters();
  const squads = useSquadIndex();
  const [aliasLine, setAliasLine] = useState<PlanLine | null>(null);

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

  const back = (
    <Link to="/plan">
      <Group gap={4} wrap={false}>
        <IconArrowLeft size={14} /> Plans de charge
      </Group>
    </Link>
  );

  if (version.isLoading) return <LoadingBlock />;
  if (version.error || !v) {
    return (
      <Stack gap={12} align="start">
        {back}
        <ErrorAlert error={version.error ?? 'Version introuvable'} title="Version introuvable" />
      </Stack>
    );
  }

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        {back}
        <Group gap={8} mt={4}>
          <Title order={2}>{v.intitule}</Title>
          <StatusBadge statut={v.statut} />
        </Group>
        <Text size="sm" tone="secondary">
          Période : {fmtPeriod(v.periode_debut, v.periode_fin)} · Importée le {fmtDateTime(v.importee_le)}
          {v.importeur ? ` par ${v.importeur}` : ''}
          {v.filename ? ` · ${v.filename}` : ''}
          {v.layout ? ` · Layout ${v.layout}` : ''}
        </Text>
        <Group gap={16} mt={4}>
          <Text as="span" tabular>
            {fmtNumber(v.nb_lignes)} lignes
          </Text>
          <Tag tone="warning" glyph="warning">
            {fmtNumber(v.nb_warn)} warn
          </Tag>
          <Tag tone="danger" glyph="danger">
            {fmtNumber(v.nb_drop)} drop
          </Tag>
        </Group>
      </Stack>

      {v.statut === 'archivee' && (
        <Banner tone="info">
          Version archivée{v.archivee_le ? ` le ${fmtDateTime(v.archivee_le)}` : ''} — consultable et exportable. Elle
          n'est plus utilisée par défaut par l'onglet Analyse.
        </Banner>
      )}
      {purged && (
        <Banner tone="warning">
          Version purgée{v.purgee_le ? ` le ${fmtDateTime(v.purgee_le)}` : ''} : ses lignes ont été définitivement
          supprimées.
        </Banner>
      )}

      {!purged && (
        <>
          <PlanLinesFilters
            filters={filters}
            update={update}
            reset={reset}
            activeCount={activeCount}
            facets={facets.data}
            facetsLoading={facets.isLoading}
            squadLabel={squads.label}
            csvHref={planApi.linesCsvUrl(versionId, query)}
          />
          <ErrorAlert error={facets.error} title="Filtres indisponibles" />
          <ErrorAlert error={lines.error} title="Chargement des lignes impossible" />

          {lines.isLoading ? (
            <SkeletonRows rows={10} />
          ) : (
            lines.data && (
              <PlanLinesTable
                items={lines.data.items}
                sort={sort}
                order={order}
                onSort={onSort}
                squadName={squads.name}
                onAlias={setAliasLine}
                dimmed={lines.isPlaceholderData}
              />
            )
          )}

          {lines.data && (
            <Card
              padding={12}
              style={{ position: 'sticky', bottom: 0, zIndex: 5 }}
              aria-label="Totaux sur le filtre courant"
            >
              <Group justify="between" gap={8}>
                <Group gap={16}>
                  <Text as="span" tabular>
                    <strong>{fmtNumber(total)}</strong> ligne{total > 1 ? 's' : ''}
                  </Text>
                  <Text as="span" tabular>
                    Σ charge totale : <strong>{fmtHours(lines.data.totals.charge_totale)}</strong>
                  </Text>
                  <Text as="span" tabular>
                    Σ PPS : <strong>{fmtEur(lines.data.totals.pps)}</strong>
                  </Text>
                  {lines.isFetching && <Spinner />}
                  <Text as="span" size="sm" tone="secondary">
                    {activeCount > 0 ? 'sur toutes les lignes filtrées' : 'sur toute la version'}
                  </Text>
                </Group>
                <Group gap={8}>
                  <Select
                    aria-label="Lignes par page"
                    data={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }))}
                    value={String(limit)}
                    onChange={(val) => val && update({ limit: val })}
                  />
                  {totalPages > 1 && (
                    <Pagination
                      page={Math.min(page, totalPages)}
                      total={totalPages}
                      onChange={(p) => update({ page: String(p) })}
                    />
                  )}
                </Group>
              </Group>
            </Card>
          )}
        </>
      )}

      <AliasPersonneModal line={aliasLine} onClose={() => setAliasLine(null)} />
    </Stack>
  );
}
