// Sous-onglet Écarts (§7.1) : table ressource × CT × semaine, filtres (URL), tri, pagination, vue pivot.
import { useEffect, useMemo, useState } from 'react';
import { Button, Group, MultiSelect, Pagination, Paper, Select, Stack, Switch, Table, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconFilterOff } from '@tabler/icons-react';
import { FLAG_SEVERITY, type AnalyseResult, type EcartRow, type Flag } from '../../api/types';
import { FLAG_META, FlagBadge, InactiveBadge } from '../../components/badges';
import { fmtHours, fmtHoursSigned, fmtWeek } from '../../lib/format';
import { CtCell, FuzzyMark, SortTh, cmp, ecartColor, paginate, useSort, type SortState } from './common';
import type { AnalyseUrlState, UrlPatch } from './params';

type Key = 'flag' | 'ressource' | 'ct' | 'semaine' | 'prevu' | 'reel' | 'ecart';
const PAGE_SIZES = ['25', '50', '100', '250'];

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

const flagBg = (f: Flag) =>
  f === 'conforme' ? undefined : `var(--mantine-color-${f === 'absence' ? 'gray' : FLAG_META[f].color}-light)`;

function RessourceCell({ e }: { e: EcartRow }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Stack gap={0}>
        <Group gap={2} wrap="nowrap">
          <Text size="sm">{e.ressource_label || e.ressource}</Text>
          {e.confidence === 'fuzzy' && <FuzzyMark />}
        </Group>
        {e.ressource_label && e.ressource_label !== e.ressource && (
          <Text size="xs" c="dimmed" ff="monospace">
            {e.ressource}
          </Text>
        )}
      </Stack>
      {e.inactive && <InactiveBadge />}
      {e.warn && (
        <Tooltip label="Ligne source signalée « warn » au parsing" withArrow>
          <IconAlertTriangle size={16} color="var(--mantine-color-yellow-7)" aria-label="avertissement de parsing" />
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
    <Table.ScrollContainer minWidth={420 + weeks.length * 96}>
      <Table withColumnBorders withTableBorder fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Ressource</Table.Th>
            <Table.Th>CT</Table.Th>
            {weeks.map((w) => (
              <Table.Th key={w} ta="center" style={{ whiteSpace: 'nowrap' }}>
                {fmtWeek(w).split(' ')[0]}
              </Table.Th>
            ))}
            <Table.Th ta="right">Σ prévu</Table.Th>
            <Table.Th ta="right">Σ réel</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.key} style={r.first ? { borderTop: '2px solid var(--mantine-color-default-border)' } : undefined}>
              <Table.Td>{r.first ? <RessourceCell e={r.head} /> : null}</Table.Td>
              <Table.Td>
                <CtCell ct={r.ct} libelle={r.ct_libelle} />
              </Table.Td>
              {weeks.map((w) => {
                const e = r.cells.get(w);
                if (!e)
                  return (
                    <Table.Td key={w} ta="center" c="dimmed">
                      —
                    </Table.Td>
                  );
                const m = FLAG_META[e.flag];
                return (
                  <Tooltip
                    key={w}
                    withArrow
                    label={`${m.emoji} ${m.label} · prévu ${fmtHours(e.prevu)} · réel ${fmtHours(e.reel)}`}
                  >
                    <Table.Td ta="center" style={{ background: flagBg(e.flag), whiteSpace: 'nowrap' }}>
                      <span aria-label={m.label}>{m.emoji}</span>{' '}
                      <Text span size="xs" fw={e.flag === 'conforme' ? 400 : 600}>
                        {fmtHoursSigned(e.ecart)}
                      </Text>
                    </Table.Td>
                  </Tooltip>
                );
              })}
              <Table.Td ta="right">{fmtHours(Math.round(r.prevu * 10) / 10)}</Table.Td>
              <Table.Td ta="right">{fmtHours(Math.round(r.reel * 10) / 10)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
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
    <Stack gap="md">
      <Paper withBorder p="sm" radius="md">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Select
            label="CT"
            placeholder="Tous"
            data={withValue(opts.cts, state.ct)}
            value={state.ct ?? null}
            onChange={(v) => update({ ct: v })}
            searchable
            clearable
            w={{ base: '100%', sm: 260 }}
            nothingFoundMessage="Aucun CT"
          />
          <Select
            label="Ressource"
            placeholder="Toutes"
            data={withValue(opts.res, state.ressource)}
            value={state.ressource ?? null}
            onChange={(v) => update({ ressource: v })}
            searchable
            clearable
            w={{ base: '100%', sm: 220 }}
            nothingFoundMessage="Aucune ressource"
          />
          <MultiSelect
            label="Flag"
            placeholder={state.flags.length ? undefined : 'Tous'}
            data={(Object.keys(FLAG_META) as Flag[])
              .sort((a, b) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a])
              .map((f) => ({ value: f, label: `${FLAG_META[f].emoji} ${FLAG_META[f].label}` }))}
            value={state.flags}
            onChange={(v) => update({ flags: v as Flag[] })}
            clearable
            w={{ base: '100%', sm: 280 }}
          />
          <Select
            label="Squad"
            placeholder="Toutes"
            data={withValue(opts.squads, state.squad)}
            value={state.squad ?? null}
            onChange={(v) => update({ squad: v })}
            clearable
            w={{ base: '100%', sm: 180 }}
            disabled={opts.squads.length === 0 && !state.squad}
          />
          {hasFilter && (
            <Button
              variant="subtle"
              size="sm"
              leftSection={<IconFilterOff size={16} />}
              onClick={() => update({ ct: null, ressource: null, squad: null, flags: [] })}
            >
              Réinitialiser
            </Button>
          )}
        </Group>
        <Group justify="space-between" mt="sm" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            <Text size="sm" c="dimmed">
              {filtered.length} tuple{filtered.length > 1 ? 's' : ''}
            </Text>
            {[...flagCounts.entries()]
              .sort(([a], [b]) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a])
              .map(([f, n]) => (
                <Text key={f} size="xs" c="dimmed">
                  <span aria-hidden>{FLAG_META[f].emoji}</span> {FLAG_META[f].label} : {n}
                </Text>
              ))}
          </Group>
          <Switch label="Regrouper par ressource" checked={pivot} onChange={(e) => setPivot(e.currentTarget.checked)} />
        </Group>
      </Paper>

      {total === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Aucun tuple ne correspond aux filtres.
        </Text>
      ) : pivot ? (
        <PivotTable rows={paginate(pivotRows, page, size)} weeks={weeks} />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table striped highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
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
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {paginate(sorted, page, size).map((e, i) => (
                <Table.Tr key={`${e.personne_id ?? e.ressource}|${e.ct}|${e.semaine}|${i}`}>
                  <Table.Td>
                    <RessourceCell e={e} />
                  </Table.Td>
                  <Table.Td>
                    <CtCell ct={e.ct} libelle={e.ct_libelle} />
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtWeek(e.semaine)}</Table.Td>
                  <Table.Td ta="right">{fmtHours(e.prevu)}</Table.Td>
                  <Table.Td ta="right">{fmtHours(e.reel)}</Table.Td>
                  <Table.Td ta="right">
                    <Text span size="sm" fw={e.flag === 'conforme' ? 400 : 600} c={ecartColor(e.flag, e.ecart)}>
                      {fmtHoursSigned(e.ecart)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <FlagBadge flag={e.flag} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {total > 0 && (
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Lignes par page
            </Text>
            <Select data={PAGE_SIZES} value={pageSize} onChange={(v) => v && setPageSize(v)} w={80} size="xs" allowDeselect={false} />
          </Group>
          {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} size="sm" />}
        </Group>
      )}
    </Stack>
  );
}
