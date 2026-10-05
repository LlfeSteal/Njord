// Sous-onglet Budget (§7.4) : synthèse globale, table par CT (drill-down vers Écarts), barres empilées par CT.
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Banner, Card, Grid, Group, Stack, StatusGlyph, Table, Tag, Text, Tooltip } from '../../ui';
import { IconChevronRight } from '../../ui/Icons';
import type { AnalyseResult, BudgetCT } from '../../api/types';
import { fmtEur, fmtHours, fmtPct } from '../../lib/format';
import {
  ChartLegend,
  ChartTooltip,
  CtCell,
  SectionHeader,
  SortTh,
  StatCard,
} from './common';
import { cmp, useSort, useTokenColors, type ChartSeries } from './helpers';
import { useDrillDown } from './params';

type Key = 'ct' | 'securise' | 'non_securise' | 'non_classe' | 'pct_securite' | 'pps_plan' | 'heures_mo' | 'cout_mo_eur';
const CHART_MAX = 15;

// Empilement : sécurisé (vert), non sécurisé (orange), non classé (gris) — §2.3.
const BUDGET_SERIES: ChartSeries[] = [
  { key: 'securise', label: 'Sécurisé', token: '--green' },
  { key: 'non_securise', label: 'Non sécurisé', token: '--orange' },
  { key: 'non_classe', label: 'Non classé', token: '--gray' },
];
const TOKENS = ['--green', '--orange', '--gray', '--card', '--separator', '--text-secondary', '--fill'] as const;

/** Libellé d'axe d'un CT (11 px secondaire), suivi du glyphe d'alerte s'il est à risque. */
function CtTick({
  x = 0,
  y = 0,
  payload,
  fill,
  risky,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  fill: string;
  risky: Set<string>;
}) {
  if (!payload) return null;
  const risk = risky.has(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={risk ? -18 : 0} y={0} dy={4} fill={fill} fontSize={11} textAnchor="end">
        {payload.value}
      </text>
      {risk && (
        <g transform="translate(-13,-6)">
          <StatusGlyph kind="warning" tone="warning" size={12} label="CT à risque" />
        </g>
      )}
    </g>
  );
}

export default function BudgetTab({ result }: { result: AnalyseResult }) {
  const { par_ct, global } = result.budget;
  const c = useTokenColors(TOKENS);
  const drill = useDrillDown();
  const { sort, toggle } = useSort<Key>({ key: 'non_securise', dir: 'desc' });
  const tick = { fill: c['--text-secondary'], fontSize: 11 };

  const rows = useMemo(
    () =>
      [...par_ct].sort(
        (a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key] as string | number | null, b[sort.key] as string | number | null) || cmp(a.ct, b.ct),
      ),
    [par_ct, sort],
  );

  const chartData = useMemo(() => {
    const tot = (b: BudgetCT) => Math.abs(b.securise) + Math.abs(b.non_securise) + Math.abs(b.non_classe);
    return [...par_ct]
      .sort((a, b) => tot(b) - tot(a))
      .slice(0, CHART_MAX)
      .map((b) => ({
        ct: b.ct,
        securise: Math.round(b.securise),
        non_securise: Math.round(b.non_securise),
        non_classe: Math.round(b.non_classe),
      }));
  }, [par_ct]);
  const risky = useMemo(() => new Set(par_ct.filter((b) => b.risque).map((b) => b.ct)), [par_ct]);

  const totals = useMemo(
    () =>
      par_ct.reduce(
        (s, b) => ({ pps: s.pps + b.pps_plan, h: s.h + b.heures_mo, mo: s.mo + b.cout_mo_eur }),
        { pps: 0, h: 0, mo: 0 },
      ),
    [par_ct],
  );

  return (
    <Stack gap={16}>
      {result.alertes.alerte_globale && (
        <Banner tone="error" title="Alerte globale">
          Part non sécurisée de {fmtPct(global.pct_non_securise)} : au-delà du seuil paramétré.
        </Banner>
      )}
      <Grid cols={{ base: 1, xs: 2, md: 4 }}>
        <StatCard label="Sécurisé" value={fmtEur(global.securise)} glyph={{ kind: 'dot', tone: 'success' }} />
        <StatCard
          label="Non sécurisé"
          value={fmtEur(global.non_securise)}
          sub={`${fmtPct(global.pct_non_securise)} du budget classé`}
          glyph={{ kind: 'dot', tone: 'warning' }}
        />
        <StatCard
          label="Non classé"
          value={fmtEur(global.non_classe)}
          sub="TYPE hors listes de référence"
          glyph={{ kind: 'dot', tone: 'neutral' }}
        />
        <StatCard label="% sécurité global" value={fmtPct(global.pct_securite)} sub="Σ sécurisé ÷ Σ (sécurisé + non sécurisé)" />
      </Grid>

      <Card>
        <SectionHeader
          title="Budget par CT"
          sub={
            <>
              € réalisés par classification{par_ct.length > CHART_MAX ? ` — ${CHART_MAX} CT les plus consommateurs` : ''} ·{' '}
              <span className="analyse-inline-glyph">
                <StatusGlyph kind="warning" tone="warning" size={12} />
              </span>{' '}
              = CT à risque. Hors main d’œuvre (comptée en heures).
            </>
          }
        />
        {chartData.length === 0 ? (
          <Text tone="secondary">Aucune écriture valorisée en €.</Text>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={chartData.length * 40 + 40}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke={c['--separator']} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={tick} tickFormatter={(v: number) => fmtEur(v)} />
                <YAxis
                  type="category"
                  dataKey="ct"
                  width={120}
                  axisLine={false}
                  tickLine={false}
                  tick={<CtTick fill={c['--text-secondary']} risky={risky} />}
                />
                <RTooltip
                  cursor={{ fill: c['--fill'] }}
                  wrapperStyle={{ outline: 'none' }}
                  isAnimationActive={false}
                  content={<ChartTooltip series={BUDGET_SERIES} format={(v) => fmtEur(v)} />}
                />
                <Bar dataKey="securise" name="Sécurisé" stackId="b" fill={c['--green']} stroke={c['--card']} strokeWidth={1} maxBarSize={24} />
                <Bar dataKey="non_securise" name="Non sécurisé" stackId="b" fill={c['--orange']} stroke={c['--card']} strokeWidth={1} maxBarSize={24} />
                <Bar dataKey="non_classe" name="Non classé" stackId="b" fill={c['--gray']} stroke={c['--card']} strokeWidth={1} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend series={BUDGET_SERIES} />
          </>
        )}
      </Card>

      <section>
        <SectionHeader title="Synthèse par CT" sub="Cliquer une ligne pour ouvrir le tableau d’écarts filtré sur ce CT." />
        <Table hover minWidth={980}>
          <thead>
            <tr>
              <SortTh k="ct" sort={sort} onSort={toggle}>
                CT
              </SortTh>
              <SortTh k="securise" sort={sort} onSort={toggle} align="right">
                Sécurisé
              </SortTh>
              <SortTh k="non_securise" sort={sort} onSort={toggle} align="right">
                Non sécurisé
              </SortTh>
              <SortTh k="non_classe" sort={sort} onSort={toggle} align="right">
                Non classé
              </SortTh>
              <SortTh k="pct_securite" sort={sort} onSort={toggle} align="right">
                % sécurité
              </SortTh>
              <SortTh k="pps_plan" sort={sort} onSort={toggle} align="right">
                PPS plan
              </SortTh>
              <SortTh k="heures_mo" sort={sort} onSort={toggle} align="right">
                Heures MO
              </SortTh>
              <SortTh k="cout_mo_eur" sort={sort} onSort={toggle} align="right">
                <Tooltip
                  label="Coût de la main d’œuvre, à titre informatif (non inclus dans les Σ € — évite le double comptage)"
                  maxWidth={280}
                >
                  <span>Coût MO (info)</span>
                </Tooltip>
              </SortTh>
              <th aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.ct}
                data-clickable
                onClick={() => drill({ ct: b.ct })}
                onKeyDown={(e) => e.key === 'Enter' && drill({ ct: b.ct })}
                tabIndex={0}
                aria-label={`Voir les écarts du CT ${b.ct}`}
              >
                <td>
                  <Group gap={8} wrap={false}>
                    <CtCell ct={b.ct} libelle={b.ct_libelle} />
                    {b.risque && (
                      <Tag tone="warning" glyph="warning">
                        À risque
                      </Tag>
                    )}
                  </Group>
                </td>
                <td data-align="right">{fmtEur(b.securise)}</td>
                <td data-align="right">
                  <Text as="span" weight={b.risque ? 600 : undefined}>
                    {fmtEur(b.non_securise)}
                  </Text>
                </td>
                <td data-align="right">{fmtEur(b.non_classe)}</td>
                <td data-align="right">{fmtPct(b.pct_securite)}</td>
                <td data-align="right">{fmtEur(b.pps_plan)}</td>
                <td data-align="right">{fmtHours(b.heures_mo)}</td>
                <td data-align="right">
                  <Text as="span" tone="secondary">
                    {fmtEur(b.cout_mo_eur)}
                  </Text>
                </td>
                <td data-actions>
                  <Text as="span" tone="tertiary">
                    <IconChevronRight size={14} />
                  </Text>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-emphasis>
              <td>Total ({par_ct.length} CT)</td>
              <td data-align="right">{fmtEur(global.securise)}</td>
              <td data-align="right">{fmtEur(global.non_securise)}</td>
              <td data-align="right">{fmtEur(global.non_classe)}</td>
              <td data-align="right">{fmtPct(global.pct_securite)}</td>
              <td data-align="right">{fmtEur(totals.pps)}</td>
              <td data-align="right">{fmtHours(Math.round(totals.h * 10) / 10)}</td>
              <td data-align="right">
                <Text as="span" tone="secondary">
                  {fmtEur(totals.mo)}
                </Text>
              </td>
              <td />
            </tr>
          </tfoot>
        </Table>
      </section>
    </Stack>
  );
}
