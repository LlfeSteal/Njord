// Détail d'une version de plan de charge (§7.3) : en-tête, filtres, table paginée, totaux, export, alias.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Pagination,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArchive, IconArrowLeft, IconTrash } from '@tabler/icons-react';
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
    <Button component={Link} to="/plan" variant="subtle" leftSection={<IconArrowLeft size={16} />} px={0}>
      Plans de charge
    </Button>
  );

  if (version.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (version.error || !v) {
    return (
      <Stack align="flex-start">
        {back}
        <ErrorAlert error={version.error ?? 'Version introuvable'} title="Version introuvable" />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <div>
        {back}
        <Group gap="sm" mt={4} wrap="wrap">
          <Title order={2}>{v.intitule}</Title>
          <StatusBadge statut={v.statut} />
          {v.layout && (
            <Badge variant="outline" color="gray">
              Layout {v.layout}
            </Badge>
          )}
        </Group>
        <Group gap="lg" mt={6} wrap="wrap">
          <Text size="sm">
            <Text span c="dimmed">
              Période :{' '}
            </Text>
            {fmtPeriod(v.periode_debut, v.periode_fin)}
          </Text>
          <Text size="sm">
            <Text span c="dimmed">
              Importée le{' '}
            </Text>
            {fmtDateTime(v.importee_le)}
            {v.importeur ? ` par ${v.importeur}` : ''}
          </Text>
          {v.filename && (
            <Text size="sm" c="dimmed">
              {v.filename}
            </Text>
          )}
        </Group>
        <Group gap="xs" mt={8}>
          <Badge variant="light" color="indigo">
            {fmtNumber(v.nb_lignes)} lignes
          </Badge>
          <Badge variant="light" color="yellow">
            {fmtNumber(v.nb_warn)} warn
          </Badge>
          <Badge variant="light" color="red">
            {fmtNumber(v.nb_drop)} drop
          </Badge>
        </Group>
      </div>

      {v.statut === 'archivee' && (
        <Alert color="gray" variant="light" icon={<IconArchive size={18} />}>
          Version archivée{v.archivee_le ? ` le ${fmtDateTime(v.archivee_le)}` : ''} — consultable et exportable. Elle
          n'est plus utilisée par défaut par l'onglet Analyse.
        </Alert>
      )}
      {purged && (
        <Alert color="red" variant="light" icon={<IconTrash size={18} />}>
          Version purgée{v.purgee_le ? ` le ${fmtDateTime(v.purgee_le)}` : ''} : ses lignes ont été définitivement
          supprimées.
        </Alert>
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
            <Center py="xl">
              <Loader />
            </Center>
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
            <Paper
              withBorder
              shadow="sm"
              p="sm"
              style={{ position: 'sticky', bottom: 0, zIndex: 5 }}
              aria-label="Totaux sur le filtre courant"
            >
              <Group justify="space-between" gap="sm" wrap="wrap">
                <Group gap="lg" wrap="wrap">
                  <Text size="sm">
                    <b>{fmtNumber(total)}</b> ligne{total > 1 ? 's' : ''}
                  </Text>
                  <Text size="sm">
                    Σ charge totale : <b>{fmtHours(lines.data.totals.charge_totale)}</b>
                  </Text>
                  <Text size="sm">
                    Σ PPS : <b>{fmtEur(lines.data.totals.pps)}</b>
                  </Text>
                  {lines.isFetching && <Loader size="xs" />}
                  <Text size="xs" c="dimmed">
                    {activeCount > 0 ? 'sur toutes les lignes filtrées' : 'sur toute la version'}
                  </Text>
                </Group>
                <Group gap="sm" wrap="wrap">
                  <Select
                    aria-label="Lignes par page"
                    size="xs"
                    w={110}
                    allowDeselect={false}
                    data={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} / page` }))}
                    value={String(limit)}
                    onChange={(val) => val && update({ limit: val })}
                  />
                  {totalPages > 1 && (
                    <Pagination
                      size="sm"
                      total={totalPages}
                      value={Math.min(page, totalPages)}
                      onChange={(p) => update({ page: String(p) })}
                      getControlProps={(control) => ({
                        'aria-label':
                          control === 'next' ? 'Page suivante' : control === 'previous' ? 'Page précédente' : control,
                      })}
                    />
                  )}
                </Group>
              </Group>
            </Paper>
          )}
        </>
      )}

      <AliasPersonneModal line={aliasLine} onClose={() => setAliasLine(null)} />
    </Stack>
  );
}
