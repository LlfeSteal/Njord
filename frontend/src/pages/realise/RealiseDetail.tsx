// Détail d'un import du réalisé : barre d'outils (retour, statut, compteurs, filtres), écritures
// paginées avec totaux en pied, inspecteur (écriture sélectionnée ou infos de l'import).
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { realiseApi, versionsApi, type RealiseEntriesQuery } from '../../api/client';
import type { RealiseEntriesPage, RealiseEntry } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { StatusBadge } from '../../components/badges';
import ImportWizard from '../../components/ImportWizard';
import VersionInfoInspector from '../../components/lifecycle/VersionInfoInspector';
import VersionSwitcher from '../../components/lifecycle/VersionSwitcher';
import { useVersionLifecycle } from '../../components/lifecycle/useVersionLifecycle';
import { plural } from '../../components/lifecycle/lifecycleUtils';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  InspectorSection,
  Link,
  KeyValue,
  LoadingBlock,
  Modal,
  Page,
  PageToolbar,
  Pagination,
  Select,
  SkeletonRows,
  SortHeader,
  Stack,
  Table,
  VisuallyHidden,
  useDebouncedValue,
  useLocalStorage,
  type MenuEntry,
} from '../../ui';
import { IconColumns, IconDownload, IconImport, IconInfo, IconSearch } from '../../ui/Icons';
import { fmtDateTime, fmtEur, fmtNumber, fmtPeriod } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { COLUMNS, DEFAULT_VISIBLE, type EntryColumn, type SortField } from './columns';
import EntriesFilters from './EntriesFilters';
import EntryInspector, { EntryGlyph } from './EntryInspector';
import { filtersFromParams, URL_FILTERS, type EntriesFilterState } from './filters';
import './realise.css';

const PAGE_SIZES = ['50', '100', '200'] as const;
const BACK = { to: '/realise', label: 'Réalisé' };

type Panel = { type: 'info' } | { type: 'entry'; entry: RealiseEntry } | null;

/** Téléchargement d'un fichier servi par l'API (équivalent d'un <a href download>). */
function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** `versionId` imposé = import courant affiché sur /realise ; sinon l'id de l'URL (/realise/:id). */
export default function RealiseDetail({ versionId: forced }: { versionId?: string } = {}) {
  const params = useParams();
  const versionId = forced ?? params.versionId ?? '';
  const [wizard, setWizard] = useState(false);
  const [sp, setSp] = useSearchParams();
  const lc = useVersionLifecycle('realise');
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
  const [filters, setFilters] = useState<EntriesFilterState>(() => filtersFromParams(sp));
  const [q, setQ] = useState('');
  const [searchDescription, setSearchDescription] = useState(true);
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [sort, setSort] = useState<{ field: SortField; order: 'asc' | 'desc' }>({ field: 'row_num', order: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visible, setVisible] = useLocalStorage<string[]>({
    key: 'njord.realise.columns.v3',
    defaultValue: DEFAULT_VISIBLE,
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  // Liens entrants (`?tg=…`, `?statut=warn`) : l'URL fait foi pour ces deux critères.
  const urlTg = sp.get('tg');
  const urlStatut = sp.get('statut');
  useEffect(() => {
    setFilters((f) => (f.tg === urlTg && f.statut === urlStatut ? f : { ...f, tg: urlTg, statut: urlStatut }));
    setPage(1);
  }, [urlTg, urlStatut]);

  const [dq] = useDebouncedValue(q.trim(), 350);
  const [dMin] = useDebouncedValue(filters.montant_min, 400);
  const [dMax] = useDebouncedValue(filters.montant_max, 400);

  const patchFilters = (patch: Partial<EntriesFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    if (URL_FILTERS.some((k) => k in patch)) {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const k of URL_FILTERS) {
            if (!(k in patch)) continue;
            const v = patch[k];
            if (v) n.set(k, v);
            else n.delete(k);
          }
          return n;
        },
        { replace: true },
      );
    }
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
      <Page toolbar={<PageToolbar back={BACK} title="Import introuvable" />}>
        <ErrorAlert error={versionQ.error ?? new Error('Import introuvable')} title="Impossible de charger l'import" />
      </Page>
    );
  }

  const v = version;
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
        {summary} · <Link to="/realise">Revenir à l'import actif</Link>
      </>
    );

  const lifecycleEntries = lc.menuEntries(v);
  const menu: MenuEntry[] = [
    ...(!purged
      ? [
          {
            label: 'Exporter les écritures filtrées (CSV)',
            icon: <IconDownload size={15} />,
            onSelect: () => download(realiseApi.entriesCsvUrl(versionId, baseQuery)),
          },
          { type: 'separator' as const },
          {
            label: 'Masquer les colonnes sensibles',
            checked: maskSensitive,
            onSelect: () => setMaskSensitive((m) => !m),
          },
          { label: 'Colonnes…', icon: <IconColumns size={15} />, onSelect: () => setColumnsOpen(true) },
        ]
      : []),
    ...(lifecycleEntries.length && !purged ? [{ type: 'separator' as const }] : []),
    ...lifecycleEntries,
  ];

  const infoOpen = panel?.type === 'info';
  const selected = panel?.type === 'entry' ? panel.entry : null;
  const cats = Object.entries(data?.totals?.par_categorie ?? {}).sort((a, b) => b[1] - a[1]);

  const inspector = infoOpen ? (
    <VersionInfoInspector version={v} opened onClose={() => setPanel(null)} lifecycle={lc}>
      {cats.length > 0 && (
        <InspectorSection title="Lignes par catégorie (filtre courant)">
          <KeyValue
            items={cats.map(([cat, n]) => ({ label: cat || '(vide)', value: fmtNumber(n), numeric: true }))}
          />
        </InspectorSection>
      )}
    </VersionInfoInspector>
  ) : (
    <EntryInspector entry={selected} onClose={() => setPanel(null)} maskSensitive={maskSensitive} />
  );

  return (
    <Page
      wide
      inspector={inspector}
      toolbar={
        <PageToolbar
          title={<VersionSwitcher kind="realise" current={v} basePath="/realise" onImport={() => setWizard(true)} />}
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
              <EntriesFilters
                facets={facetsQ.data}
                filters={filters}
                onChange={patchFilters}
                q={q}
                onQChange={(val) => {
                  setQ(val);
                  setPage(1);
                }}
                searchDescription={searchDescription}
                onSearchDescriptionChange={(val) => {
                  setSearchDescription(val);
                  setPage(1);
                }}
                nbWarn={v.nb_warn}
              />
            )
          }
        />
      }
    >
      {purged ? (
        <Card>
          <EmptyState title="Import purgé">
            Ses écritures ont été définitivement supprimées{v.purgee_le ? ` le ${fmtDateTime(v.purgee_le)}` : ''}.
          </EmptyState>
        </Card>
      ) : (
        <Stack gap={12}>
          {facetsQ.error ? <ErrorAlert error={facetsQ.error} title="Filtres indisponibles" /> : null}
          {entriesQ.error ? <ErrorAlert error={entriesQ.error} title="Impossible de charger les écritures" /> : null}

          <EntriesTable
            columns={columns}
            data={data}
            loading={entriesQ.isLoading}
            stale={entriesQ.isPlaceholderData}
            sort={sort}
            onSort={toggleSort}
            selectedId={selected?.id ?? null}
            onSelect={(entry) => setPanel({ type: 'entry', entry })}
          />

          {data && data.total > 0 && (
            <div className="realise-foot">
              <Pagination
                page={Math.min(page, totalPages)}
                total={totalPages}
                onChange={setPage}
                summary={`${fmtNumber((page - 1) * pageSize + 1)}–${fmtNumber(Math.min(page * pageSize, data.total))} sur ${plural(data.total, 'écriture')}`}
              />
              <Select
                aria-label="Lignes par page"
                data={PAGE_SIZES.map((s) => ({ value: s, label: `${s} / page` }))}
                value={String(pageSize) as (typeof PAGE_SIZES)[number]}
                onChange={(s) => {
                  if (!s) return;
                  setPageSize(Number(s));
                  setPage(1);
                }}
              />
            </div>
          )}
        </Stack>
      )}

      <ColumnsModal
        opened={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        visible={visible}
        onChange={setVisible}
        maskSensitive={maskSensitive}
      />
      <ImportWizard kind="realise" opened={wizard} onClose={() => setWizard(false)} />
      {lc.modals}
    </Page>
  );
}

// ------------------------------------------------------------------ sous-composants

function ColumnsModal({
  opened,
  onClose,
  visible,
  onChange,
  maskSensitive,
}: {
  opened: boolean;
  onClose: () => void;
  visible: string[];
  onChange: (v: string[]) => void;
  maskSensitive: boolean;
}) {
  const toggle = (key: string, on: boolean) => onChange(on ? [...visible, key] : visible.filter((k) => k !== key));
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Colonnes affichées"
      subtitle={maskSensitive ? 'Colonnes sensibles masquées (menu ⋯).' : undefined}
      size="sm"
      footer={
        <>
          <Button variant="plain" onClick={() => onChange(DEFAULT_VISIBLE)}>
            Par défaut
          </Button>
          <Button variant="plain" onClick={() => onChange(COLUMNS.map((c) => c.key))}>
            Toutes
          </Button>
          <Button variant="primary" onClick={onClose}>
            OK
          </Button>
        </>
      }
    >
      <div className="realise-columns">
        {COLUMNS.map((c) => (
          <Checkbox
            key={c.key}
            checked={visible.includes(c.key)}
            onChange={(on) => toggle(c.key, on)}
            label={c.sensitive ? `${c.label} (sensible)` : c.label}
            disabled={maskSensitive && c.sensitive}
          />
        ))}
      </div>
    </Modal>
  );
}

const TOTAL_KEYS = ['quantite', 'total_eur'];

function EntriesTable({
  columns,
  data,
  loading,
  stale,
  sort,
  onSort,
  selectedId,
  onSelect,
}: {
  columns: EntryColumn[];
  data: RealiseEntriesPage | undefined;
  loading: boolean;
  stale: boolean;
  sort: { field: SortField; order: 'asc' | 'desc' };
  onSort: (f: SortField) => void;
  selectedId: number | null;
  onSelect: (e: RealiseEntry) => void;
}) {
  const span = columns.length + 1;
  // Pied : libellé sur la cellule glyphe + les colonnes précédant la première colonne totalisée.
  const firstTotal = columns.findIndex((c) => TOTAL_KEYS.includes(c.key));
  const labelSpan = firstTotal < 0 ? span : firstTotal + 1;
  const totalCell = (c: EntryColumn) => {
    if (!data) return null;
    if (c.key === 'quantite') return fmtNumber(data.totals?.quantite);
    if (c.key === 'total_eur') return fmtEur(data.totals?.total_eur ?? 0, true);
    return null;
  };

  return (
    <Table
      striped
      className="realise-table"
      minWidth={Math.max(640, columns.length * 120)}
      style={{ opacity: stale ? 0.6 : 1, transition: 'opacity 120ms' }}
    >
      <thead>
        <tr>
          <th data-glyph>
            <VisuallyHidden>Contrôle</VisuallyHidden>
          </th>
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
              <th key={c.key} data-align={c.align}>
                {c.label}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan={span}>
              <SkeletonRows rows={5} />
            </td>
          </tr>
        ) : !data || data.items.length === 0 ? (
          <tr>
            <td colSpan={span}>
              <EmptyState icon={<IconSearch size={40} />} title="Aucune écriture">
                Aucune écriture ne correspond aux filtres.
              </EmptyState>
            </td>
          </tr>
        ) : (
          data.items.map((e) => (
            <tr
              key={e.id}
              data-tone={e.statut_parsing === 'warn' ? 'warning' : e.statut_parsing === 'drop' ? 'danger' : undefined}
              data-clickable
              data-selected={selectedId === e.id || undefined}
              onClick={() => onSelect(e)}
            >
              <td data-glyph>
                <EntryGlyph entry={e} />
              </td>
              {columns.map((c) => (
                <td key={c.key} data-align={c.align} data-nowrap data-mono={c.mono || undefined}>
                  {c.render(e)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
      {data && data.total > 0 && (
        <tfoot>
          <tr>
            <td colSpan={labelSpan} data-nowrap>
              Total · {plural(data.total, 'écriture')}
            </td>
            {firstTotal >= 0 &&
              columns.slice(firstTotal).map((c) => (
                <td key={c.key} data-align={c.align} data-nowrap>
                  {totalCell(c)}
                </td>
              ))}
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
