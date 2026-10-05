// Détail d'un import du réalisé : écritures filtrables, tri, pagination, totaux, export CSV (SPEC_realise §6.3).
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { realiseApi, versionsApi, type RealiseEntriesQuery } from '../../api/client';
import type { RealiseEntriesPage, Version } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { StatusBadge } from '../../components/badges';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Group,
  Link,
  LoadingBlock,
  Pagination,
  Pill,
  Popover,
  Select,
  SkeletonRows,
  SortHeader,
  Spinner,
  Stack,
  StatusGlyph,
  Table,
  Text,
  Title,
  useDebouncedValue,
  useLocalStorage,
} from '../../ui';
import { IconArrowLeft, IconColumns, IconDownload, IconSearch } from '../../ui/Icons';
import { fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { COLUMNS, DEFAULT_VISIBLE, type EntryColumn, type SortField } from './columns';
import EntriesFilters from './EntriesFilters';
import { EMPTY_FILTERS, type EntriesFilterState } from './filters';

const PAGE_SIZES = ['50', '100', '200'] as const;

/** Téléchargement d'un fichier servi par l'API (équivalent d'un <a href download>). */
function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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
  if (versionQ.isLoading) return <LoadingBlock />;
  if (versionQ.error || !version) {
    return (
      <Stack>
        <BackLink />
        <ErrorAlert error={versionQ.error ?? new Error('Import introuvable')} title="Impossible de charger l'import" />
      </Stack>
    );
  }

  return (
    <Stack gap={12}>
      <VersionHeader version={version} />

      {version.statut === 'archivee' && (
        <Banner tone="info" title="Version archivée">
          Cet import est archivé depuis le {fmtDateTime(version.archivee_le)} : consultation en lecture seule, il n'est plus
          retenu par défaut par l'analyse.
        </Banner>
      )}
      {purged ? (
        <Banner tone="warning" title="Version purgée">
          Les écritures de cet import ont été définitivement supprimées le {fmtDateTime(version.purgee_le)}.
        </Banner>
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

          <Group justify="between" gap={8}>
            <Group gap={8}>
              <Text weight={600} tabular>
                {data ? `${fmtNumber(data.total)} écriture${data.total > 1 ? 's' : ''}` : '…'}
              </Text>
              {entriesQ.isFetching && <Spinner size={12} />}
            </Group>
            <Group gap={8}>
              <ColumnPicker visible={visible} onChange={setVisible} maskSensitive={maskSensitive} />
              <Select
                aria-label="Lignes par page"
                data={PAGE_SIZES.map((v) => ({ value: v, label: `${v} / page` }))}
                value={String(pageSize) as (typeof PAGE_SIZES)[number]}
                onChange={(v) => {
                  if (!v) return;
                  setPageSize(Number(v));
                  setPage(1);
                }}
              />
              <Button icon={<IconDownload size={15} />} onClick={() => download(realiseApi.entriesCsvUrl(versionId, baseQuery))}>
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

          {data && totalPages > 1 && <Pagination page={page} total={totalPages} onChange={setPage} />}

          {data && <TotalsFooter data={data} />}
        </>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ sous-composants

function BackLink() {
  return (
    <Link to="/realise">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <IconArrowLeft size={15} />
        Retour aux imports
      </span>
    </Link>
  );
}

/** Statistique de l'en-tête : libellé secondaire, valeur ; glyphe optionnel avant le libellé. */
function Stat({ label, glyph, children }: { label: string; glyph?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <Group gap={4} wrap={false}>
        {glyph}
        <Text size="sm" tone="secondary">
          {label}
        </Text>
      </Group>
      <Text as="div" weight={500} tabular>
        {children}
      </Text>
    </div>
  );
}

function VersionHeader({ version: v }: { version: Version }) {
  return (
    <Stack gap={8}>
      <BackLink />
      <Group gap={12} align="baseline">
        <Title order={2}>{v.intitule}</Title>
        {v.source_format && <Text tone="secondary">format {v.source_format}</Text>}
        <StatusBadge statut={v.statut} />
      </Group>
      <Card>
        <Group gap={24} align="start">
          <Stat label="Période couverte">{fmtPeriod(v.periode_debut, v.periode_fin)}</Stat>
          <Stat label="Montant total">{fmtEur(v.montant_total_eur)}</Stat>
          <Stat label="Lignes">{fmtNumber(v.nb_lignes)}</Stat>
          <Stat label="Avertissements" glyph={v.nb_warn ? <StatusGlyph kind="warning" tone="warning" size={12} /> : undefined}>
            {fmtNumber(v.nb_warn)}
          </Stat>
          <Stat label="Rejets" glyph={v.nb_drop ? <StatusGlyph kind="danger" tone="danger" size={12} /> : undefined}>
            {fmtNumber(v.nb_drop)}
          </Stat>
          <Stat label="Importé le">
            {fmtDateTime(v.importee_le)}
            {v.importeur ? ` par ${v.importeur}` : ''}
          </Stat>
          {v.filename && (
            <Stat label="Fichier">
              <Text as="span" truncate title={v.filename} style={{ display: 'inline-block', maxWidth: 260, verticalAlign: 'bottom' }}>
                {v.filename}
              </Text>
            </Stat>
          )}
        </Group>
      </Card>
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
  const toggle = (key: string, on: boolean) => onChange(on ? [...visible, key] : visible.filter((k) => k !== key));
  return (
    <Popover
      placement="bottom-end"
      width={260}
      target={(p) => (
        <Button {...p} icon={<IconColumns size={15} />}>
          Colonnes ({shown}/{COLUMNS.length})
        </Button>
      )}
    >
      <Text size="sm" weight={600} tone="secondary">
        Colonnes affichées
      </Text>
      <div style={{ maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
        <Stack gap={6}>
          {COLUMNS.map((c) => (
            <Checkbox
              key={c.key}
              checked={visible.includes(c.key)}
              onChange={(on) => toggle(c.key, on)}
              label={c.sensitive ? `${c.label} (sensible)` : c.label}
              disabled={maskSensitive && c.sensitive}
            />
          ))}
        </Stack>
      </div>
      <Group mt={8} gap={4}>
        <Button size="sm" variant="plain" onClick={() => onChange(DEFAULT_VISIBLE)}>
          Par défaut
        </Button>
        <Button size="sm" variant="plain" onClick={() => onChange(COLUMNS.map((c) => c.key))}>
          Toutes
        </Button>
      </Group>
      {maskSensitive && (
        <Text size="sm" tone="secondary" mt={6}>
          Désactivez « Masquer les colonnes sensibles » pour afficher les colonnes sensibles.
        </Text>
      )}
    </Popover>
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
    // Données précédentes atténuées pendant le chargement de la page suivante.
    <div style={{ opacity: stale ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <Table striped hover minWidth={Math.max(720, columns.length * 110)}>
        <thead>
          <tr>
            {columns.map((c) =>
              c.sort ? (
                <SortHeader
                  key={c.key}
                  active={sort.field === c.sort}
                  dir={sort.order}
                  onSort={() => onSort(c.sort as SortField)}
                  align={c.align}
                >
                  {c.label}
                </SortHeader>
              ) : (
                <th key={c.key} data-align={c.align} data-nowrap>
                  {c.label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <SkeletonRows rows={5} />
              </td>
            </tr>
          ) : !data || data.items.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState icon={<IconSearch size={40} />} title="Aucune écriture ne correspond aux filtres." />
              </td>
            </tr>
          ) : (
            data.items.map((e) => (
              <tr key={e.id} data-muted={e.statut_parsing === 'drop' || undefined}>
                {columns.map((c) => (
                  <td key={c.key} data-align={c.align} data-nowrap={c.nowrap || undefined} data-mono={c.mono || undefined}>
                    {c.render(e)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}

function TotalsFooter({ data }: { data: RealiseEntriesPage }) {
  const cats = Object.entries(data.totals?.par_categorie ?? {}).sort((a, b) => b[1] - a[1]);
  const totalEur = data.totals?.total_eur ?? 0;
  return (
    <Card role="region" aria-label="Totaux du filtre courant" style={{ position: 'sticky', bottom: 0, zIndex: 5 }}>
      <Group gap={24} align="start">
        <div>
          <Text size="sm" tone="secondary">
            Σ Quantité
          </Text>
          <Text weight={600} tabular>
            {fmtNumber(data.totals?.quantite)}
          </Text>
        </div>
        <div>
          <Text size="sm" tone="secondary">
            Σ Total €
          </Text>
          <Text weight={600} tabular>
            {fmtEur(totalEur, true)}
          </Text>
        </div>
        <div>
          <Text size="sm" tone="secondary">
            Écritures
          </Text>
          <Text weight={600} tabular>
            {fmtNumber(data.total)}
          </Text>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <Text size="sm" tone="secondary" mb={4}>
            Lignes par catégorie
          </Text>
          <Group gap={6}>
            {cats.length === 0 ? (
              <Text tone="secondary">—</Text>
            ) : (
              cats.map(([cat, n]) => (
                <Pill key={cat || '_'}>
                  {cat || '(vide)'} : {fmtNumber(n)}
                </Pill>
              ))
            )}
          </Group>
        </div>
      </Group>
    </Card>
  );
}
