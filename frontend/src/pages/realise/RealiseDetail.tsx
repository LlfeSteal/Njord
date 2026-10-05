// Détail d'un import du réalisé : écritures filtrables, tri, pagination, totaux, export CSV (SPEC_realise §6.3).
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  Pagination,
  Paper,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  IconArchive,
  IconArrowLeft,
  IconChevronDown,
  IconChevronUp,
  IconColumns,
  IconDownload,
  IconSelector,
  IconTrash,
} from '@tabler/icons-react';
import { realiseApi, versionsApi, type RealiseEntriesQuery } from '../../api/client';
import type { RealiseEntriesPage, Version } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { StatusBadge } from '../../components/badges';
import { fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { COLUMNS, DEFAULT_VISIBLE, type EntryColumn, type SortField } from './columns';
import EntriesFilters from './EntriesFilters';
import { EMPTY_FILTERS, type EntriesFilterState } from './filters';

const PAGE_SIZES = ['50', '100', '200'];

export default function RealiseDetail() {
  const { versionId = '' } = useParams();
  const versionQ = useQuery({
    queryKey: qk.version('realise', versionId),
    queryFn: () => versionsApi.get('realise', versionId),
    enabled: !!versionId,
  });
  const version = versionQ.data;
  const purged = version?.statut === 'purgee';

  const facetsQ = useQuery({
    queryKey: qk.facets('realise', versionId),
    queryFn: () => versionsApi.facets('realise', versionId),
    enabled: !!versionId && !!version && !purged,
    staleTime: 5 * 60_000,
  });

  // ------------------------------------------------------------ état des filtres
  const [filters, setFilters] = useState<EntriesFilterState>(EMPTY_FILTERS);
  const [q, setQ] = useState('');
  const [searchDescription, setSearchDescription] = useState(true);
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [sort, setSort] = useState<{ field: SortField; order: 'asc' | 'desc' }>({ field: 'row_num', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visible, setVisible] = useLocalStorage<string[]>({
    key: 'njord.realise.columns',
    defaultValue: DEFAULT_VISIBLE,
  });

  const [dq] = useDebouncedValue(q.trim(), 350);
  const [dMin] = useDebouncedValue(filters.montant_min, 400);
  const [dMax] = useDebouncedValue(filters.montant_max, 400);

  const patchFilters = (patch: Partial<EntriesFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const baseQuery = useMemo<RealiseEntriesQuery>(() => {
    const dateOk = !(filters.date_from && filters.date_to && filters.date_from > filters.date_to);
    return {
      entite: filters.entite ?? undefined,
      activite: filters.activite ?? undefined,
      trigramme: filters.trigramme ?? undefined,
      tg: filters.tg ?? undefined,
      wp: filters.wp ?? undefined,
      categorie: filters.categorie ?? undefined,
      type: filters.type ?? undefined,
      lot: filters.lot ?? undefined,
      statut: filters.statut ?? undefined,
      date_from: dateOk ? filters.date_from || undefined : undefined,
      date_to: dateOk ? filters.date_to || undefined : undefined,
      montant_min: typeof dMin === 'number' ? dMin : undefined,
      montant_max: typeof dMax === 'number' ? dMax : undefined,
      q: dq || undefined,
      search_description: searchDescription,
      mask_sensitive: maskSensitive,
      sort: sort.field,
      order: sort.order,
    };
  }, [filters, dMin, dMax, dq, searchDescription, maskSensitive, sort]);

  const query: RealiseEntriesQuery = { ...baseQuery, limit: pageSize, offset: (page - 1) * pageSize };

  const entriesQ = useQuery({
    queryKey: qk.realiseEntries(versionId, query),
    queryFn: () => realiseApi.entries(versionId, query),
    enabled: !!versionId && !!version && !purged,
    placeholderData: keepPreviousData,
  });
  const data = entriesQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const columns = COLUMNS.filter((c) => visible.includes(c.key) && !(maskSensitive && c.sensitive));

  const toggleSort = (field: SortField) => {
    setPage(1);
    setSort((s) => {
      if (s.field !== field) return { field, order: field === 'total_eur' ? 'desc' : 'asc' };
      const first = field === 'total_eur' ? 'desc' : 'asc';
      if (s.order === first) return { field, order: first === 'asc' ? 'desc' : 'asc' };
      return { field: 'row_num', order: 'asc' };
    });
  };

  // ------------------------------------------------------------ rendu
  if (versionQ.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  if (versionQ.error || !version) {
    return (
      <Stack>
        <BackButton />
        <ErrorAlert error={versionQ.error ?? new Error('Import introuvable')} title="Impossible de charger l'import" />
      </Stack>
    );
  }

  return (
    <Stack gap="md" pb={4}>
      <VersionHeader version={version} />

      {version.statut === 'archivee' && (
        <Alert color="yellow" variant="light" icon={<IconArchive size={18} />} title="Version archivée">
          Cet import est archivé depuis le {fmtDateTime(version.archivee_le)} : consultation en lecture seule, il n'est plus
          retenu par défaut par l'analyse.
        </Alert>
      )}
      {purged ? (
        <Alert color="red" variant="light" icon={<IconTrash size={18} />} title="Version purgée">
          Les écritures de cet import ont été définitivement supprimées le {fmtDateTime(version.purgee_le)}.
        </Alert>
      ) : (
        <>
          {facetsQ.error ? <ErrorAlert error={facetsQ.error} title="Filtres indisponibles" /> : null}
          <EntriesFilters
            facets={facetsQ.data}
            facetsLoading={facetsQ.isLoading}
            filters={filters}
            onChange={patchFilters}
            onReset={() => {
              setFilters(EMPTY_FILTERS);
              setQ('');
              setPage(1);
            }}
            q={q}
            onQChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            searchDescription={searchDescription}
            onSearchDescriptionChange={(v) => {
              setSearchDescription(v);
              setPage(1);
            }}
            maskSensitive={maskSensitive}
            onMaskSensitiveChange={setMaskSensitive}
          />

          <Group justify="space-between" wrap="wrap" gap="sm">
            <Group gap="xs">
              <Text size="sm" fw={500}>
                {data ? `${fmtNumber(data.total)} écriture${data.total > 1 ? 's' : ''}` : '…'}
              </Text>
              {entriesQ.isFetching && <Loader size="xs" />}
            </Group>
            <Group gap="xs" wrap="wrap">
              <ColumnPicker visible={visible} onChange={setVisible} maskSensitive={maskSensitive} />
              <Select
                aria-label="Lignes par page"
                data={PAGE_SIZES.map((v) => ({ value: v, label: `${v} / page` }))}
                value={String(pageSize)}
                onChange={(v) => {
                  if (!v) return;
                  setPageSize(Number(v));
                  setPage(1);
                }}
                allowDeselect={false}
                w={120}
                size="sm"
              />
              <Button
                component="a"
                href={realiseApi.entriesCsvUrl(versionId, baseQuery)}
                download
                variant="light"
                size="sm"
                leftSection={<IconDownload size={16} />}
              >
                Export CSV
              </Button>
            </Group>
          </Group>

          {entriesQ.error ? <ErrorAlert error={entriesQ.error} title="Impossible de charger les écritures" /> : null}

          <EntriesTable
            columns={columns}
            data={data}
            loading={entriesQ.isLoading}
            stale={entriesQ.isPlaceholderData}
            sort={sort}
            onSort={toggleSort}
          />

          {data && totalPages > 1 && (
            <Group justify="center">
              <Pagination total={totalPages} value={page} onChange={setPage} size="sm" siblings={1} boundaries={1} />
            </Group>
          )}

          {data && <TotalsFooter data={data} />}
        </>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ sous-composants

function BackButton() {
  return (
    <Button component={Link} to="/realise" variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={16} />} w="fit-content">
      Retour aux imports
    </Button>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" fw={500} component="div">
        {children}
      </Text>
    </div>
  );
}

function VersionHeader({ version: v }: { version: Version }) {
  return (
    <Stack gap="xs">
      <BackButton />
      <Group gap="sm" wrap="wrap">
        <Title order={3}>{v.intitule}</Title>
        <StatusBadge statut={v.statut} />
        {v.source_format && (
          <Badge variant="outline" color="gray" size="sm">
            format {v.source_format}
          </Badge>
        )}
      </Group>
      <Paper withBorder p="sm" radius="sm">
        <Group gap="xl" wrap="wrap">
          <Stat label="Période couverte">{fmtPeriod(v.periode_debut, v.periode_fin)}</Stat>
          <Stat label="Montant total">
            <Text span inherit c={(v.montant_total_eur ?? 0) < 0 ? 'red' : undefined}>
              {fmtEur(v.montant_total_eur)}
            </Text>
          </Stat>
          <Stat label="Lignes">{fmtNumber(v.nb_lignes)}</Stat>
          <Stat label="Avertissements">
            <Text span inherit c={v.nb_warn ? 'yellow.8' : undefined}>
              {fmtNumber(v.nb_warn)}
            </Text>
          </Stat>
          <Stat label="Rejets">
            <Text span inherit c={v.nb_drop ? 'red' : undefined}>
              {fmtNumber(v.nb_drop)}
            </Text>
          </Stat>
          <Stat label="Importé le">
            {fmtDateTime(v.importee_le)}
            {v.importeur ? ` par ${v.importeur}` : ''}
          </Stat>
          {v.filename && (
            <Stat label="Fichier">
              <Text span inherit truncate="end" maw={260} display="inline-block" title={v.filename}>
                {v.filename}
              </Text>
            </Stat>
          )}
        </Group>
      </Paper>
    </Stack>
  );
}

function ColumnPicker({
  visible,
  onChange,
  maskSensitive,
}: {
  visible: string[];
  onChange: (v: string[]) => void;
  maskSensitive: boolean;
}) {
  const shown = COLUMNS.filter((c) => visible.includes(c.key) && !(maskSensitive && c.sensitive)).length;
  return (
    <Popover position="bottom-end" shadow="md" withArrow trapFocus>
      <Popover.Target>
        <Button variant="default" size="sm" leftSection={<IconColumns size={16} />}>
          Colonnes ({shown}/{COLUMNS.length})
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
          <Checkbox.Group value={visible} onChange={onChange} label="Colonnes affichées">
            <Stack gap={6} mt="xs">
              {COLUMNS.map((c) => (
                <Checkbox
                  key={c.key}
                  value={c.key}
                  size="xs"
                  label={c.sensitive ? `${c.label} (sensible)` : c.label}
                  disabled={maskSensitive && c.sensitive}
                />
              ))}
            </Stack>
          </Checkbox.Group>
        </ScrollArea.Autosize>
        <Group mt="sm" gap="xs">
          <Button size="compact-xs" variant="subtle" onClick={() => onChange(DEFAULT_VISIBLE)}>
            Par défaut
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={() => onChange(COLUMNS.map((c) => c.key))}>
            Toutes
          </Button>
        </Group>
        {maskSensitive && (
          <Text size="xs" c="dimmed" mt={6} maw={240}>
            Désactivez « Masquer les colonnes sensibles » pour afficher les colonnes sensibles.
          </Text>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

function SortHeader({
  col,
  sort,
  onSort,
}: {
  col: EntryColumn & { sort: SortField };
  sort: { field: SortField; order: 'asc' | 'desc' };
  onSort: (f: SortField) => void;
}) {
  const active = sort.field === col.sort;
  const Icon = !active ? IconSelector : sort.order === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <UnstyledButton
      onClick={() => onSort(col.sort)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, whiteSpace: 'nowrap' }}
      aria-label={`Trier par ${col.label}`}
    >
      {col.label}
      <Icon size={14} stroke={1.5} opacity={active ? 1 : 0.5} />
    </UnstyledButton>
  );
}

function EntriesTable({
  columns,
  data,
  loading,
  stale,
  sort,
  onSort,
}: {
  columns: EntryColumn[];
  data: RealiseEntriesPage | undefined;
  loading: boolean;
  stale: boolean;
  sort: { field: SortField; order: 'asc' | 'desc' };
  onSort: (f: SortField) => void;
}) {
  return (
    <Table.ScrollContainer minWidth={Math.max(720, columns.length * 110)}>
      <Table striped highlightOnHover verticalSpacing={6} fz="sm" style={{ opacity: stale ? 0.6 : 1, transition: 'opacity 120ms' }}>
        <Table.Thead>
          <Table.Tr>
            {columns.map((c) => (
              <Table.Th
                key={c.key}
                ta={c.align}
                aria-sort={c.sort && sort.field === c.sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}
                style={{ whiteSpace: 'nowrap' }}
              >
                {c.sort ? <SortHeader col={c as EntryColumn & { sort: SortField }} sort={sort} onSort={onSort} /> : c.label}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading ? (
            <Table.Tr>
              <Table.Td colSpan={columns.length}>
                <Group justify="center" p="md">
                  <Loader size="sm" />
                </Group>
              </Table.Td>
            </Table.Tr>
          ) : !data || data.items.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={columns.length}>
                <Text c="dimmed" ta="center" p="md" size="sm">
                  Aucune écriture ne correspond aux filtres.
                </Text>
              </Table.Td>
            </Table.Tr>
          ) : (
            data.items.map((e) => (
              <Table.Tr key={e.id} style={e.statut_parsing === 'drop' ? { opacity: 0.6 } : undefined}>
                {columns.map((c) => (
                  <Table.Td key={c.key} ta={c.align}>
                    {c.render(e)}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function TotalsFooter({ data }: { data: RealiseEntriesPage }) {
  const cats = Object.entries(data.totals?.par_categorie ?? {}).sort((a, b) => b[1] - a[1]);
  const totalEur = data.totals?.total_eur ?? 0;
  return (
    <Paper
      withBorder
      shadow="sm"
      p="sm"
      radius="sm"
      role="region"
      aria-label="Totaux du filtre courant"
      style={{ position: 'sticky', bottom: 0, zIndex: 5 }}
    >
      <Group gap="xl" wrap="wrap" align="center">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Σ Quantité
          </Text>
          <Text fw={600}>{fmtNumber(data.totals?.quantite)}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Σ Total €
          </Text>
          <Text fw={600} c={totalEur < 0 ? 'red' : undefined}>
            {fmtEur(totalEur, true)}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Écritures
          </Text>
          <Text fw={600}>{fmtNumber(data.total)}</Text>
        </Box>
        <Box style={{ flex: '1 1 300px' }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
            Lignes par catégorie
          </Text>
          <Group gap={6} wrap="wrap">
            {cats.length === 0 ? (
              <Text size="sm" c="dimmed">
                —
              </Text>
            ) : (
              cats.map(([cat, n]) => (
                <Badge key={cat || '_'} variant="light" color="indigo" tt="none">
                  {cat || '(vide)'} : {fmtNumber(n)}
                </Badge>
              ))
            )}
          </Group>
        </Box>
      </Group>
    </Paper>
  );
}

