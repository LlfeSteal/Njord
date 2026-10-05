// Sous-onglet Écarts (§7.1) : table ressource × CT × semaine, filtres (URL), tri, pagination, vue pivot.
import { useEffect, useMemo, useState } from 'react';
import { Button, Group, MultiSelect, Pagination, Select, Stack, StatusGlyph, Switch, Table, Text, Tooltip } from '../../ui';
import { IconFilterOff } from '../../ui/Icons';
import { FLAG_SEVERITY, type AnalyseResult, type EcartRow, type Flag } from '../../api/types';
import { FLAG_META, FlagBadge, FlagGlyph, InactiveBadge } from '../../components/badges';
import { fmtHours, fmtHoursSigned, fmtWeek } from '../../lib/format';
import { CtCell, FuzzyMark, SortTh } from './common';
import { cmp, ecartTone, paginate, useSort, type SortState } from './helpers';
import type { AnalyseUrlState, UrlPatch } from './params';

type Key = 'flag' | 'ressource' | 'ct' | 'semaine' | 'prevu' | 'reel' | 'ecart';
const PAGE_SIZES = ['25', '50', '100', '250'].map((v) => ({ value: v, label: v }));

const bySeverity = (a: EcartRow, b: EcartRow) =>
  FLAG_SEVERITY[b.flag] - FLAG_SEVERITY[a.flag] || Math.abs(b.ecart) - Math.abs(a.ecart);

function sortRows(rows: EcartRow[], s: SortState<Key>): EcartRow[] {
  const out = [...rows];
  const sign = s.dir === 'asc' ? -1 : 1; // le tri « flag » desc = gravité décroissante
  if (s.key === 'flag') return out.sort((a, b) => sign * bySeverity(a, b));
  const get = (e: EcartRow): string | number =>
    s.key === 'ressource' ? e.ressource_label || e.ressource : (e[s.key] as string | number);
  return out.sort((a, b) => (s.dir === 'asc' ? 1 : -1) * cmp(get(a), get(b)) || bySeverity(a, b));
}

function RessourceCell({ e }: { e: EcartRow }) {
  return (
    <Group gap={4} wrap={false}>
      <Stack gap={0}>
        <Group gap={2} wrap={false}>
          <Text>{e.ressource_label || e.ressource}</Text>
          {e.confidence === 'fuzzy' && <FuzzyMark />}
        </Group>
        {e.ressource_label && e.ressource_label !== e.ressource && (
          <Text size="sm" tone="secondary" mono>
            {e.ressource}
          </Text>
        )}
      </Stack>
      {e.inactive && <InactiveBadge />}
      {e.warn && (
        <Tooltip label="Ligne source signalée « warn » au parsing">
          <StatusGlyph kind="warning" tone="warning" label="avertissement de parsing" />
        </Tooltip>
      )}
    </Group>
  );
}

// ------------------------------------------------------------------ Vue pivot ressource × semaines
interface PivotRow {
  key: string;
  first: boolean;
  head: EcartRow;
  ct: string;
  ct_libelle: string;
  cells: Map<string, EcartRow>;
  prevu: number;
  reel: number;
}

function buildPivot(rows: EcartRow[]): PivotRow[] {
  const groups = new Map<string, Map<string, PivotRow>>();
  for (const e of rows) {
    const rk = e.personne_id ?? `nom:${e.ressource}`;
    const g = groups.get(rk) ?? new Map<string, PivotRow>();
    groups.set(rk, g);
    const r =
      g.get(e.ct) ??
      ({ key: `${rk}|${e.ct}`, first: false, head: e, ct: e.ct, ct_libelle: e.ct_libelle, cells: new Map(), prevu: 0, reel: 0 } as PivotRow);
    g.set(e.ct, r);
    r.cells.set(e.semaine, e);
    r.prevu += e.prevu;
    r.reel += e.reel;
  }
  const worst = (g: Map<string, PivotRow>) =>
    Math.max(...[...g.values()].flatMap((r) => [...r.cells.values()].map((e) => FLAG_SEVERITY[e.flag])));
  const spread = (g: Map<string, PivotRow>) => [...g.values()].reduce((s, r) => s + Math.abs(r.reel - r.prevu), 0);
  return [...groups.values()]
    .sort((a, b) => worst(b) - worst(a) || spread(b) - spread(a))
    .flatMap((g) =>
      [...g.values()].sort((a, b) => cmp(a.ct, b.ct)).map((r, i) => ({ ...r, first: i === 0 })),
    );
}

function PivotTable({ rows, weeks }: { rows: PivotRow[]; weeks: string[] }) {
  return (
    <Table className="analyse-pivot" minWidth={420 + weeks.length * 96}>
      <thead>
        <tr>
          <th>Ressource</th>
          <th>CT</th>
          {weeks.map((w) => (
            <th key={w} data-center>
              {fmtWeek(w).split(' ')[0]}
            </th>
          ))}
          <th data-align="right">Σ prévu</th>
          <th data-align="right">Σ réel</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.first ? <RessourceCell e={r.head} /> : null}</td>
            <td>
              <CtCell ct={r.ct} libelle={r.ct_libelle} />
            </td>
            {weeks.map((w) => {
              const e = r.cells.get(w);
              if (!e)
                return (
                  <td key={w} data-center>
                    <Text as="span" tone="tertiary">
                      —
                    </Text>
                  </td>
                );
              const m = FLAG_META[e.flag];
              return (
                <td key={w} data-center>
                  <Tooltip label={`${m.label} · prévu ${fmtHours(e.prevu)} · réel ${fmtHours(e.reel)}`}>
                    <Group gap={4} wrap={false}>
                      <FlagGlyph flag={e.flag} size={12} />
                      <Text as="span" size="sm" tabular weight={e.flag === 'conforme' ? 400 : 600} tone={ecartTone(e.flag, e.ecart)}>
                        {fmtHoursSigned(e.ecart)}
                      </Text>
                    </Group>
                  </Tooltip>
                </td>
              );
            })}
            <td data-align="right">{fmtHours(Math.round(r.prevu * 10) / 10)}</td>
            <td data-align="right">{fmtHours(Math.round(r.reel * 10) / 10)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ------------------------------------------------------------------ Onglet
export default function EcartsTab({
  result,
  state,
  update,
}: {
  result: AnalyseResult;
  state: AnalyseUrlState;
  update: (p: UrlPatch) => void;
}) {
  const { ecarts, meta } = result;
  const { sort, toggle } = useSort<Key>({ key: 'flag', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('50');
  const [pivot, setPivot] = useState(false);

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

  // Valeurs d'URL inconnues (ex. drill-down d'un CT sans écart) : garder l'option sélectionnable.
  const withValue = (data: { value: string; label: string }[], v?: string) =>
    v && !data.some((d) => d.value === v) ? [{ value: v, label: v }, ...data] : data;

  const filtered = useMemo(
    () =>
      ecarts.filter(
        (e) =>
          (!state.ct || e.ct === state.ct) &&
          (!state.ressource || e.ressource === state.ressource) &&
          (!state.squad || e.squad_id === state.squad) &&
          (state.flags.length === 0 || state.flags.includes(e.flag)),
      ),
    [ecarts, state.ct, state.ressource, state.squad, state.flags],
  );
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const pivotRows = useMemo(() => (pivot ? buildPivot(filtered) : []), [pivot, filtered]);
  const weeks = useMemo(
    () => (meta.weeks.length ? meta.weeks.map((w) => w.week) : [...new Set(ecarts.map((e) => e.semaine))].sort()),
    [meta.weeks, ecarts],
  );

  const filterKey = `${state.ct}|${state.ressource}|${state.squad}|${state.flags.join(',')}|${pivot}|${pageSize}|${sort.key}|${sort.dir}`;
  useEffect(() => setPage(1), [filterKey]);

  const size = Number(pageSize);
  const total = pivot ? pivotRows.length : sorted.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const hasFilter = !!(state.ct || state.ressource || state.squad || state.flags.length);

  const flagCounts = useMemo(() => {
    const c = new Map<Flag, number>();
    for (const e of filtered) c.set(e.flag, (c.get(e.flag) ?? 0) + 1);
    return c;
  }, [filtered]);

  return (
    <Stack gap={12}>
      <Group gap={8}>
        <Select
          aria-label="CT"
          placeholder="CT"
          data={withValue(opts.cts, state.ct)}
          value={state.ct ?? null}
          onChange={(v) => update({ ct: v })}
          searchable
          clearable
          menuWidth={290}
          nothingFound="Aucun CT"
        />
        <Select
          aria-label="Ressource"
          placeholder="Ressource"
          data={withValue(opts.res, state.ressource)}
          value={state.ressource ?? null}
          onChange={(v) => update({ ressource: v })}
          searchable
          clearable
          menuWidth={290}
          nothingFound="Aucune ressource"
        />
        <MultiSelect
          aria-label="Flag"
          placeholder="Flag"
          data={(Object.keys(FLAG_META) as Flag[])
            .sort((a, b) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a])
            .map((f) => ({ value: f, label: FLAG_META[f].label }))}
          value={state.flags}
          onChange={(v) => update({ flags: v })}
          clearable
        />
        <Select
          aria-label="Squad"
          placeholder="Squad"
          data={withValue(opts.squads, state.squad)}
          value={state.squad ?? null}
          onChange={(v) => update({ squad: v })}
          clearable
          disabled={opts.squads.length === 0 && !state.squad}
        />
        {hasFilter && (
          <Button
            variant="plain"
            icon={<IconFilterOff size={15} />}
            onClick={() => update({ ct: null, ressource: null, squad: null, flags: [] })}
          >
            Réinitialiser
          </Button>
        )}
      </Group>
      <Group justify="between" gap={8}>
        <Group gap={12}>
          <Text tone="secondary" tabular>
            {filtered.length} tuple{filtered.length > 1 ? 's' : ''}
          </Text>
          {[...flagCounts.entries()]
            .sort(([a], [b]) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a])
            .map(([f, n]) => (
              <Group key={f} gap={4} wrap={false}>
                <FlagGlyph flag={f} size={12} />
                <Text size="sm" tone="secondary" tabular>
                  {FLAG_META[f].label} : {n}
                </Text>
              </Group>
            ))}
        </Group>
        <Switch label="Regrouper par ressource" checked={pivot} onChange={setPivot} />
      </Group>

      {total === 0 ? (
        <Text tone="secondary" align="center" mt={24} mb={24}>
          Aucun tuple ne correspond aux filtres.
        </Text>
      ) : pivot ? (
        <PivotTable rows={paginate(pivotRows, page, size)} weeks={weeks} />
      ) : (
        <Table striped hover minWidth={820}>
          <thead>
            <tr>
              <SortTh k="ressource" sort={sort} onSort={toggle}>
                Ressource
              </SortTh>
              <SortTh k="ct" sort={sort} onSort={toggle}>
                CT
              </SortTh>
              <SortTh k="semaine" sort={sort} onSort={toggle}>
                Semaine
              </SortTh>
              <SortTh k="prevu" sort={sort} onSort={toggle} align="right">
                Prévu (h)
              </SortTh>
              <SortTh k="reel" sort={sort} onSort={toggle} align="right">
                Réel (h)
              </SortTh>
              <SortTh k="ecart" sort={sort} onSort={toggle} align="right">
                Écart (h)
              </SortTh>
              <SortTh k="flag" sort={sort} onSort={toggle}>
                Flag
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {paginate(sorted, page, size).map((e, i) => (
              <tr key={`${e.personne_id ?? e.ressource}|${e.ct}|${e.semaine}|${i}`}>
                <td>
                  <RessourceCell e={e} />
                </td>
                <td>
                  <CtCell ct={e.ct} libelle={e.ct_libelle} />
                </td>
                <td data-nowrap>{fmtWeek(e.semaine)}</td>
                <td data-align="right">{fmtHours(e.prevu)}</td>
                <td data-align="right">{fmtHours(e.reel)}</td>
                <td data-align="right">
                  <Text as="span" weight={e.flag === 'conforme' ? 400 : 600} tone={ecartTone(e.flag, e.ecart)}>
                    {fmtHoursSigned(e.ecart)}
                  </Text>
                </td>
                <td>
                  <FlagBadge flag={e.flag} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {total > 0 && (
        <Group justify="between">
          <Group gap={8}>
            <Text tone="secondary">Lignes par page</Text>
            <Select aria-label="Lignes par page" data={PAGE_SIZES} value={pageSize} onChange={(v) => v && setPageSize(v)} />
          </Group>
          {pages > 1 && <Pagination page={page} total={pages} onChange={setPage} />}
        </Group>
      )}
    </Stack>
  );
}
