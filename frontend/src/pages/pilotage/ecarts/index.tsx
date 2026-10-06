// Page Pilotage « Écarts d'imputation » (/ecarts) : tuples ressource × CT × semaine (prévu / réel / écart).
// Filtres dans l'URL (ct, ressource, flag, squad, q, vue) ; détail d'une ligne dans l'Inspector.
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  ActiveFilters,
  Button,
  EmptyState,
  FilterButton,
  Group,
  MultiSelect,
  Page,
  PageToolbar,
  Pagination,
  SearchField,
  SegmentedControl,
  Select,
  SortHeader,
  Stack,
  Table,
  Text,
  Tooltip,
  toast,
  type ActiveFilter,
  type MenuEntry,
} from '../../../ui';
import { IconDownload } from '../../../ui/Icons';
import { FLAG_SEVERITY, type EcartRow, type Flag } from '../../../api/types';
import { analyseApi } from '../../../api/client';
import { FLAG_META, FlagGlyph, InactiveBadge } from '../../../components/badges';
import { fmtHours, fmtHoursSigned, fmtWeek } from '../../../lib/format';
import ContextControl from '../shared/ContextControl';
import { useAnalyse } from '../shared/context';
import { AnalyseGate } from '../anomalies/AnalyseGate';
import { isAnalyseShown, norm, shortWeek } from '../anomalies/meta';
import { EcartRowInspector, RessourceInspector } from './EcartInspector';
import SyntheseImputations from './SyntheseImputations';
import { useSquads } from '../../referentiels/hooks';
import {
  DEFAULT_SORT,
  cmp,
  ecartTone,
  groupByRessource,
  nextSort,
  paginate,
  rowId,
  rowTone,
  sortGroups,
  sortRows,
  synthese,
  useEcartsUrl,
  type EcartsVue,
  type GroupKey,
  type ListKey,
  type RessourceRow,
  type Sort,
} from './model';
import './ecarts.css';

const PAGE_SIZE = 50;
const FLAG_OPTIONS = (Object.keys(FLAG_META) as Flag[])
  .sort((a, b) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a])
  .map((f) => ({ value: f, label: FLAG_META[f].label }));
const VUES: { value: EcartsVue; label: string }[] = [
  { value: 'liste', label: 'Liste' },
  { value: 'ressource', label: 'Par ressource' },
];

/** Téléchargement d'une URL via un lien temporaire (le serveur fournit le nom du fichier). */
function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function EcartsPage() {
  const analyse = useAnalyse();
  const shown = isAnalyseShown(analyse);
  const result = shown ? analyse.result.data : undefined;
  const { state, update } = useEcartsUrl();

  const [listSort, setListSort] = useState<Sort<ListKey>>({ ...DEFAULT_SORT });
  const [groupSort, setGroupSort] = useState<Sort<GroupKey>>({ ...DEFAULT_SORT });
  const [selected, setSelected] = useState<string | null>(null);

  // ---------------------------------------------------------------- Options des filtres
  const ecarts = useMemo(() => result?.ecarts ?? [], [result]);
  const opts = useMemo(() => {
    const cts = new Map<string, string>();
    const res = new Map<string, string>();
    const squads = new Map<string, string>();
    for (const e of ecarts) {
      cts.set(e.ct, e.ct_libelle);
      res.set(e.ressource, e.ressource_label || e.ressource);
      if (e.squad_id) squads.set(e.squad_id, e.squad_nom || e.squad_id);
    }
    const toData = (m: Map<string, string>, withCode: boolean) =>
      [...m.entries()]
        .map(([value, l]) => ({ value, label: withCode && l && l !== value ? `${value} — ${l}` : l || value }))
        .sort((a, b) => cmp(a.label, b.label));
    return { cts: toData(cts, true), res: toData(res, false), squads: toData(squads, false) };
  }, [ecarts]);
  // Valeur d'URL absente des données (lien entrant) : reste sélectionnable.
  const withValue = (data: { value: string; label: string }[], v?: string) =>
    v && !data.some((d) => d.value === v) ? [{ value: v, label: v }, ...data] : data;
  const labelOf = (data: { value: string; label: string }[], v: string) => data.find((d) => d.value === v)?.label ?? v;

  // Filtre squad : le squad choisi et tous ses sous-squads (un parent agrège ses enfants, cf. Capacité).
  const squadsQ = useSquads();
  const squadScope = useMemo(() => {
    if (!state.squad) return null;
    const children = new Map<string, string[]>();
    for (const s of squadsQ.data ?? []) if (s.parent_id) children.set(s.parent_id, [...(children.get(s.parent_id) ?? []), s.id]);
    const scope = new Set<string>();
    for (const todo = [state.squad]; todo.length; ) {
      const id = todo.pop()!;
      if (scope.has(id)) continue;
      scope.add(id);
      todo.push(...(children.get(id) ?? []));
    }
    return scope;
  }, [squadsQ.data, state.squad]);
  const squadName = (id: string) => squadsQ.data?.find((s) => s.id === id)?.nom_canonique ?? id;

  // ---------------------------------------------------------------- Filtrage, tri, regroupement
  // La synthèse suit tous les filtres sauf le flag (sinon une seule part) ; le tableau, tous.
  const filteredSansFlag = useMemo(() => {
    const nq = norm(state.q.trim());
    return ecarts.filter(
      (e) =>
        (!state.ct || e.ct === state.ct) &&
        (!state.ressource || e.ressource === state.ressource) &&
        (!squadScope || (!!e.squad_id && squadScope.has(e.squad_id))) &&
        (!nq || norm(`${e.ressource} ${e.ressource_label} ${e.ct} ${e.ct_libelle}`).includes(nq)),
    );
  }, [ecarts, state.ct, state.ressource, squadScope, state.q]);
  const filtered = useMemo(
    () => (state.flags.length === 0 ? filteredSansFlag : filteredSansFlag.filter((e) => state.flags.includes(e.flag))),
    [filteredSansFlag, state.flags],
  );
  const syntheseData = useMemo(() => synthese(filteredSansFlag), [filteredSansFlag]);
  // Clic sur une part : filtre sur ce seul flag, ou le retire s'il est déjà le seul filtré.
  const selectFlag = (f: Flag) => update({ flags: state.flags.length === 1 && state.flags[0] === f ? [] : [f] });
  const byRessource = state.vue === 'ressource';
  const rows = useMemo(() => (byRessource ? [] : sortRows(filtered, listSort)), [byRessource, filtered, listSort]);
  const groups = useMemo(
    () => (byRessource ? sortGroups(groupByRessource(filtered), groupSort) : []),
    [byRessource, filtered, groupSort],
  );

  // Page courante, revenue à 1 dès que les filtres, la vue ou le tri changent.
  const sig = `${state.vue}|${state.ct}|${state.ressource}|${state.squad}|${state.flags.join(',')}|${state.q}|${listSort.key}${listSort.dir}|${groupSort.key}${groupSort.dir}`;
  const [pageState, setPageState] = useState({ sig, page: 1 });
  const total = byRessource ? groups.length : rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageState.sig === sig ? pageState.page : 1, pages);
  const setPage = (p: number) => setPageState({ sig, page: p });

  const selectedRow = !byRessource && selected ? (filtered.find((e) => rowId(e) === selected) ?? null) : null;
  const selectedGroup = byRessource && selected ? (groups.find((g) => g.id === selected) ?? null) : null;

  // Semaine courte (« S36 ») quand la période tient dans une année.
  const sameYear = !!result && result.meta.week_from.slice(0, 4) === result.meta.week_to.slice(0, 4);
  const weekLabel = (w: string) => (sameYear ? shortWeek(w) : fmtWeek(w));

  // ---------------------------------------------------------------- Filtres actifs
  const filterCount = [state.ct, state.ressource, state.squad].filter(Boolean).length + (state.flags.length ? 1 : 0);
  const active: ActiveFilter[] = [];
  if (state.ct) active.push({ key: 'ct', label: `CT : ${state.ct}`, onRemove: () => update({ ct: null }) });
  if (state.ressource)
    active.push({ key: 'ressource', label: labelOf(opts.res, state.ressource), onRemove: () => update({ ressource: null }) });
  if (state.flags.length)
    active.push({ key: 'flag', label: state.flags.map((f) => FLAG_META[f].label).join(', '), onRemove: () => update({ flags: [] }) });
  if (state.squad) active.push({ key: 'squad', label: `Squad : ${opts.squads.some((d) => d.value === state.squad) ? labelOf(opts.squads, state.squad) : squadName(state.squad)}`, onRemove: () => update({ squad: null }) });
  const clearFilters = () => update({ ct: null, ressource: null, squad: null, flags: [] });

  // ---------------------------------------------------------------- Export
  const exportCsv = () => {
    if (!analyse.params) return;
    download(
      analyseApi.ecartsCsvUrl({
        ...analyse.params,
        include_inactive: analyse.params.include_inactive || undefined,
        ct: state.ct,
        ressource: state.ressource,
        flag: state.flags.length ? state.flags.join(',') : undefined,
        squad_id: state.squad,
      }),
    );
    if (state.q.trim())
      toast({ tone: 'info', title: 'Export lancé', message: "La recherche n'est pas appliquée à l'export ; les filtres le sont." });
  };
  const menu: MenuEntry[] = [
    { label: 'Exporter la conformité (CSV)', icon: <IconDownload size={15} />, onSelect: exportCsv, disabled: !shown },
  ];

  // ---------------------------------------------------------------- Barre d'outils
  const weeks = result ? `${weekLabel(result.meta.week_from)} → ${weekLabel(result.meta.week_to)}` : '';
  const subtitle = result ? `${filtered.length} tuple${filtered.length > 1 ? 's' : ''} · ${weeks}` : undefined;

  const bottom = (
    <Group gap={8}>
      <SegmentedControl<EcartsVue>
        aria-label="Présentation"
        equal={false}
        value={state.vue}
        onChange={(v) => {
          setSelected(null);
          update({ vue: v });
        }}
        data={VUES}
      />
      <SearchField
        value={state.q}
        onChange={(v) => update({ q: v })}
        placeholder="Ressource ou CT"
        aria-label="Rechercher une ressource ou un CT"
      />
      <FilterButton count={filterCount} onReset={clearFilters}>
        <Stack gap={12}>
          <Select
            label="CT"
            placeholder="Tous"
            data={withValue(opts.cts, state.ct)}
            value={state.ct ?? null}
            onChange={(v) => update({ ct: v })}
            searchable
            clearable
            menuWidth={290}
            nothingFound="Aucun CT"
            width="100%"
          />
          <Select
            label="Ressource"
            placeholder="Toutes"
            data={withValue(opts.res, state.ressource)}
            value={state.ressource ?? null}
            onChange={(v) => update({ ressource: v })}
            searchable
            clearable
            menuWidth={290}
            nothingFound="Aucune ressource"
            width="100%"
          />
          <MultiSelect<Flag>
            label="Flags"
            placeholder="Tous"
            data={FLAG_OPTIONS}
            value={state.flags}
            onChange={(v) => update({ flags: v })}
            clearable
            width="100%"
          />
          <Select
            label="Squad"
            placeholder="Toutes"
            data={withValue(opts.squads, state.squad).map((d) => (d.value === d.label ? { ...d, label: squadName(d.value) } : d))}
            value={state.squad ?? null}
            onChange={(v) => update({ squad: v })}
            clearable
            disabled={opts.squads.length === 0 && !state.squad}
            width="100%"
          />
        </Stack>
      </FilterButton>
      <ActiveFilters items={active} onClearAll={active.length > 1 ? clearFilters : undefined} />
    </Group>
  );

  const toolbar = (
    <PageToolbar
      title="Écarts d'imputation"
      subtitle={subtitle}
      actions={<ContextControl analyse={analyse} />}
      menu={menu}
      bottom={shown ? bottom : undefined}
    />
  );

  // ---------------------------------------------------------------- Contenu
  const planId = result?.meta.plan_version?.id;
  const close = () => setSelected(null);
  const inspector = byRessource ? (
    <RessourceInspector
      group={selectedGroup}
      planId={planId}
      onClose={close}
      onShowWeeks={(g) => {
        setSelected(null);
        update({ vue: 'liste', ressource: g.head.ressource, ct: g.ct, q: null });
      }}
    />
  ) : (
    <EcartRowInspector row={selectedRow} planId={planId} onClose={close} />
  );

  let content;
  if (!shown) content = <AnalyseGate analyse={analyse} />;
  else if (ecarts.length === 0)
    content = <EmptyState title="Aucun tuple à comparer">Le plan et le réalisé ne se recoupent pas sur la période.</EmptyState>;
  else if (total === 0)
    content = (
      <EmptyState
        title="Aucun tuple ne correspond"
        action={
          <Button
            onClick={() => {
              clearFilters();
              update({ q: null });
            }}
          >
            Effacer les filtres
          </Button>
        }
      >
        Modifiez la recherche ou les filtres.
      </EmptyState>
    );
  else
    content = (
      <Stack gap={12} className="ecarts-content" aria-busy={analyse.result.isPlaceholderData || undefined}>
        {byRessource ? (
          <GroupTable
            groups={paginate(groups, page, PAGE_SIZE)}
            sort={groupSort}
            onSort={(k, first) => setGroupSort((s) => nextSort(s, k, first))}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <ListTable
            rows={paginate(rows, page, PAGE_SIZE)}
            sort={listSort}
            onSort={(k, first) => setListSort((s) => nextSort(s, k, first))}
            selected={selected}
            onSelect={setSelected}
            weekLabel={weekLabel}
          />
        )}
        <Pagination
          page={page}
          total={pages}
          onChange={setPage}
          summary={`${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} sur ${total}`}
        />
      </Stack>
    );

  return (
    <Page toolbar={toolbar} inspector={shown ? inspector : undefined}>
      {shown && filteredSansFlag.length > 0 ? (
        <Stack gap={16}>
          <SyntheseImputations data={syntheseData} selected={state.flags} onSelect={selectFlag} />
          {content}
        </Stack>
      ) : (
        content
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ Tableaux
/** Entrée ou Espace sur une ligne focalisée : l'ouvre dans l'inspecteur. */
function activate(ev: KeyboardEvent, open: () => void) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  open();
}

function Th<K extends string>({
  k,
  sort,
  onSort,
  first = 'desc',
  align,
  children,
}: {
  k: K;
  sort: Sort<K>;
  onSort: (k: K, first: 'asc' | 'desc') => void;
  first?: 'asc' | 'desc';
  align?: 'right';
  children: string;
}) {
  return (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => onSort(k, first)} align={align}>
      {children}
    </SortHeader>
  );
}

function RessourceCell({ e }: { e: EcartRow }) {
  return (
    <span className="ecarts-ressource">
      <Text as="span" truncate>
        {e.ressource_label || e.ressource}
      </Text>
      {e.inactive && <InactiveBadge />}
    </span>
  );
}

function CtCell({ ct, libelle }: { ct: string; libelle: string }) {
  return (
    <td data-mono data-nowrap>
      <Tooltip label={libelle} disabled={!libelle}>
        {ct}
      </Tooltip>
    </td>
  );
}

function EcartCell({ flag, value }: { flag: Flag; value: number }) {
  return (
    <td data-align="right">
      <Text as="span" tabular weight={flag === 'conforme' ? 400 : 600} tone={ecartTone(flag)}>
        {fmtHoursSigned(value)}
      </Text>
    </td>
  );
}

interface ListTableProps {
  rows: EcartRow[];
  sort: Sort<ListKey>;
  onSort: (k: ListKey, first: 'asc' | 'desc') => void;
  selected: string | null;
  onSelect: (id: string) => void;
  weekLabel: (w: string) => string;
}

function ListTable({ rows, sort, onSort, selected, onSelect, weekLabel }: ListTableProps) {
  return (
    <Table hover minWidth={720} caption="Écarts d'imputation par ressource, CT et semaine">
      <thead>
        <tr>
          <th data-glyph aria-label="Flag" />
          <Th k="ressource" first="asc" sort={sort} onSort={onSort}>
            Ressource
          </Th>
          <Th k="ct" first="asc" sort={sort} onSort={onSort}>
            CT
          </Th>
          <Th k="semaine" first="asc" sort={sort} onSort={onSort}>
            Semaine
          </Th>
          <Th k="prevu" sort={sort} onSort={onSort} align="right">
            Prévu
          </Th>
          <Th k="reel" sort={sort} onSort={onSort} align="right">
            Réel
          </Th>
          <Th k="ecart" sort={sort} onSort={onSort} align="right">
            Écart
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const id = rowId(e);
          return (
            <tr
              key={id}
              data-clickable
              data-tone={rowTone(e.flag)}
              data-selected={selected === id || undefined}
              tabIndex={0}
              onClick={() => onSelect(id)}
              onKeyDown={(ev) => activate(ev, () => onSelect(id))}
            >
              <td data-glyph>
                <FlagGlyph flag={e.flag} />
              </td>
              <td>
                <RessourceCell e={e} />
              </td>
              <CtCell ct={e.ct} libelle={e.ct_libelle} />
              <td data-nowrap>{weekLabel(e.semaine)}</td>
              <td data-align="right">{fmtHours(e.prevu)}</td>
              <td data-align="right">{fmtHours(e.reel)}</td>
              <EcartCell flag={e.flag} value={e.ecart} />
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

interface GroupTableProps {
  groups: RessourceRow[];
  sort: Sort<GroupKey>;
  onSort: (k: GroupKey, first: 'asc' | 'desc') => void;
  selected: string | null;
  onSelect: (id: string) => void;
}

function GroupTable({ groups, sort, onSort, selected, onSelect }: GroupTableProps) {
  return (
    <Table hover minWidth={720} caption="Écarts d'imputation par ressource et CT sur la période">
      <thead>
        <tr>
          <th data-glyph aria-label="Flag le plus grave" />
          <Th k="ressource" first="asc" sort={sort} onSort={onSort}>
            Ressource
          </Th>
          <Th k="ct" first="asc" sort={sort} onSort={onSort}>
            CT
          </Th>
          <Th k="nbEcarts" sort={sort} onSort={onSort} align="right">
            Semaines en écart
          </Th>
          <Th k="prevu" sort={sort} onSort={onSort} align="right">
            Prévu
          </Th>
          <Th k="reel" sort={sort} onSort={onSort} align="right">
            Réel
          </Th>
          <Th k="ecart" sort={sort} onSort={onSort} align="right">
            Écart
          </Th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr
            key={g.id}
            data-clickable
            data-tone={rowTone(g.flag)}
            data-selected={selected === g.id || undefined}
            tabIndex={0}
            onClick={() => onSelect(g.id)}
            onKeyDown={(ev) => activate(ev, () => onSelect(g.id))}
          >
            <td data-glyph>
              <FlagGlyph flag={g.flag} />
            </td>
            <td>
              <RessourceCell e={g.head} />
            </td>
            <CtCell ct={g.ct} libelle={g.ct_libelle} />
            <td data-align="right">
              {g.nbEcarts} / {g.rows.length}
            </td>
            <td data-align="right">{fmtHours(g.prevu)}</td>
            <td data-align="right">{fmtHours(g.reel)}</td>
            <EcartCell flag={g.flag} value={g.ecart} />
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
