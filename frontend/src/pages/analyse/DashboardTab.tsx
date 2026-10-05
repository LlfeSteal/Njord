// Sous-onglet Tableau de bord (§7.6) : cartes KPI, prévu vs réel par semaine, répartition des flags, top écarts.
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, Collapse, Grid, Group, Link, Stack, Table, Text } from '../../ui';
import type { AnalyseResult, Flag } from '../../api/types';
import { FLAG_META, FlagBadge, FlagGlyph, InactiveBadge } from '../../components/badges';
import { fmtHours, fmtHoursSigned, fmtPct, fmtRatio, fmtWeek } from '../../lib/format';
import {
  ChartLegend,
  ChartTooltip,
  CtCell,
  FuzzyMark,
  SectionHeader,
  StatCard,
} from './common';
import { ecartTone, flagToken, useTokenColors, type ChartSeries } from './helpers';
import { useDrillDown, useTabLink } from './params';

const FLAG_ORDER: Flag[] = ['absence', 'hors_plan', 'sur_imputation', 'sous_imputation', 'conforme'];

// Prévu = piste (même teinte, 30 %), réel = plein (§8 Charts).
const WEEKLY_SERIES: ChartSeries[] = [
  { key: 'prevu', label: 'Prévu', token: '--blue', opacity: 0.3 },
  { key: 'reel', label: 'Réel', token: '--blue' },
];
const TOKENS = ['--blue', '--separator', '--text-secondary', '--fill', ...FLAG_ORDER.map(flagToken)] as const;

interface FlagDatum {
  flag: Flag;
  n: number;
}

function PointsRow({ flag, points, detail }: { flag: Flag; points: number; detail: string }) {
  return (
    <Group justify="between" gap={4} wrap={false}>
      <Group gap={6} wrap={false}>
        <FlagGlyph flag={flag} size={12} />
        <Text size="sm">{FLAG_META[flag].label}</Text>
      </Group>
      <Text size="sm" tone="secondary" tabular>
        <Text as="span" tone="primary" weight={600}>
          {points} pt{points > 1 ? 's' : ''}
        </Text>{' '}
        · {detail}
      </Text>
    </Group>
  );
}

/** Libellé d'axe d'un flag : glyphe 12 px + libellé 11 px secondaire. */
function FlagTick({ x = 0, y = 0, payload, fill }: { x?: number; y?: number; payload?: { value: Flag }; fill: string }) {
  if (!payload) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <g transform="translate(-146,-6)">
        <FlagGlyph flag={payload.value} size={12} />
      </g>
      <text x={-128} y={0} dy={4} fill={fill} fontSize={11} textAnchor="start">
        {FLAG_META[payload.value].label}
      </text>
    </g>
  );
}

export default function DashboardTab({ result }: { result: AnalyseResult }) {
  const { kpis, ecarts, meta } = result;
  const c = useTokenColors(TOKENS);
  const drill = useDrillDown();
  const tabLink = useTabLink();
  const [showWeeklyTable, setShowWeeklyTable] = useState(false);
  const tick = { fill: c['--text-secondary'], fontSize: 11 };

  const weekly = useMemo(() => {
    const weeks = meta.weeks.length ? meta.weeks.map((w) => w.week) : [...new Set(ecarts.map((e) => e.semaine))].sort();
    const acc = new Map(weeks.map((w) => [w, { prevu: 0, reel: 0 }]));
    for (const e of ecarts) {
      const a = acc.get(e.semaine) ?? { prevu: 0, reel: 0 };
      a.prevu += e.prevu;
      a.reel += e.reel;
      acc.set(e.semaine, a);
    }
    return [...acc.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, v]) => ({
        week,
        label: fmtWeek(week).split(' ')[0],
        prevu: Math.round(v.prevu * 10) / 10,
        reel: Math.round(v.reel * 10) / 10,
      }));
  }, [ecarts, meta.weeks]);

  const flagCounts = useMemo(() => {
    const n: Record<Flag, number> = { absence: 0, hors_plan: 0, sur_imputation: 0, sous_imputation: 0, conforme: 0 };
    for (const e of ecarts) n[e.flag] += 1;
    return FLAG_ORDER.map((f): FlagDatum => ({ flag: f, n: n[f] }));
  }, [ecarts]);

  const top = useMemo(
    () =>
      ecarts
        .filter((e) => e.flag !== 'conforme')
        .sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart))
        .slice(0, 10),
    [ecarts],
  );

  const ecartTotal = kpis.total_reel_h - kpis.total_prevu_h;

  return (
    <Stack gap={16}>
      <Grid cols={{ base: 1, xs: 2, md: 3 }}>
        <StatCard
          label="Taux de conformité"
          value={fmtRatio(kpis.taux_conformite)}
          sub={`${kpis.nb_conformes} conformes / ${kpis.nb_tuples_compares} tuples comparés${meta.include_inactive ? '' : ' · inactifs exclus'}`}
          glyph={{ kind: 'success', tone: 'conforme' }}
        />
        <StatCard label="Points FLAG" value={kpis.points_total}>
          <Stack gap={2} mt={4}>
            <PointsRow flag="sur_imputation" points={kpis.points_sur_imputation} detail={`${kpis.nb_sur_imputation} × 2`} />
            <PointsRow flag="sous_imputation" points={kpis.points_sous_imputation} detail={`${kpis.nb_sous_imputation} × 1`} />
            <PointsRow flag="absence" points={kpis.points_absence} detail={`${kpis.nb_absence} × 2`} />
            <PointsRow flag="hors_plan" points={kpis.points_hors_plan} detail={`${fmtHours(kpis.heures_hors_plan)} ÷ 12`} />
          </Stack>
        </StatCard>
        <StatCard
          label="Taux d’absence"
          value={fmtRatio(kpis.taux_absence)}
          sub={`${kpis.nb_personnes_absentes} absent${kpis.nb_personnes_absentes > 1 ? 's' : ''} / ${kpis.nb_personnes_planifiees} planifié${kpis.nb_personnes_planifiees > 1 ? 's' : ''} (Σ réel = 0 sur la période)`}
          glyph={{ kind: 'none', tone: 'absence' }}
        />
        <StatCard label="Budget sécurisé" value={fmtPct(kpis.pct_securise)} sub="Sécurisé ÷ (sécurisé + non sécurisé)">
          <Link to={tabLink('budget')} size="sm">
            Voir la synthèse budgétaire
          </Link>
        </StatCard>
        <StatCard
          label="CT à risque"
          value={kpis.nb_ct_risque}
          sub="Σ non sécurisé au-delà du seuil"
          glyph={kpis.nb_ct_risque > 0 ? { kind: 'warning', tone: 'warning' } : undefined}
        >
          <Link to={tabLink('alertes')} size="sm">
            Voir les alertes
          </Link>
        </StatCard>
        <StatCard
          label="Prévu vs réel"
          value={
            <>
              {fmtHours(kpis.total_prevu_h)}{' '}
              <Text as="span" size="xl" tone="secondary">
                / {fmtHours(kpis.total_reel_h)}
              </Text>
            </>
          }
          sub={`Écart global ${fmtHoursSigned(Math.round(ecartTotal * 10) / 10)} (réel − prévu, hors plan inclus)`}
        />
      </Grid>

      <Grid cols={{ base: 1, lg: 2 }}>
        <Card>
          <SectionHeader
            title="Prévu vs réel par semaine"
            aside={
              <Button variant="plain" size="sm" onClick={() => setShowWeeklyTable((s) => !s)} aria-expanded={showWeeklyTable}>
                {showWeeklyTable ? 'Masquer les données' : 'Voir les données'}
              </Button>
            }
          />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weekly} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={1} barCategoryGap="24%">
              <CartesianGrid vertical={false} stroke={c['--separator']} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={tick} />
              <YAxis width={64} axisLine={false} tickLine={false} tick={tick} tickFormatter={(v: number) => fmtHours(v)} />
              <RTooltip
                cursor={{ fill: c['--fill'] }}
                wrapperStyle={{ outline: 'none' }}
                isAnimationActive={false}
                content={<ChartTooltip series={WEEKLY_SERIES} format={fmtHours} />}
              />
              <Bar dataKey="prevu" name="Prévu" fill={c['--blue']} fillOpacity={0.3} radius={[3, 3, 0, 0]} maxBarSize={24} />
              <Bar dataKey="reel" name="Réel" fill={c['--blue']} radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
          <ChartLegend series={WEEKLY_SERIES} />
          <Collapse opened={showWeeklyTable}>
            <Table striped card={false} minWidth={320} mt={12}>
              <thead>
                <tr>
                  <th>Semaine</th>
                  <th data-align="right">Prévu</th>
                  <th data-align="right">Réel</th>
                  <th data-align="right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => (
                  <tr key={w.week}>
                    <td>{fmtWeek(w.week)}</td>
                    <td data-align="right">{fmtHours(w.prevu)}</td>
                    <td data-align="right">{fmtHours(w.reel)}</td>
                    <td data-align="right">{fmtHoursSigned(Math.round((w.reel - w.prevu) * 10) / 10)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Collapse>
        </Card>

        <Card>
          <SectionHeader
            title="Répartition des flags"
            sub="Nombre de tuples ressource × CT × semaine — cliquer une barre filtre le tableau d’écarts"
          />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={flagCounts} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={c['--separator']} />
              <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={tick} />
              <YAxis
                type="category"
                dataKey="flag"
                width={150}
                axisLine={false}
                tickLine={false}
                tick={<FlagTick fill={c['--text-secondary']} />}
              />
              <RTooltip
                cursor={{ fill: c['--fill'] }}
                wrapperStyle={{ outline: 'none' }}
                isAnimationActive={false}
                content={
                  <ChartTooltip<FlagDatum>
                    title={(d) => FLAG_META[d.flag].label}
                    series={(d) => [{ key: 'n', label: 'Nombre', token: flagToken(d.flag) }]}
                    format={(v) => `${v} tuple${v > 1 ? 's' : ''}`}
                  />
                }
              />
              <Bar
                dataKey="n"
                maxBarSize={24}
                radius={[0, 3, 3, 0]}
                cursor="pointer"
                onClick={(d: { flag?: Flag }) => d.flag && drill({ flags: [d.flag] })}
                isAnimationActive={false}
              >
                {flagCounts.map((f) => (
                  <Cell key={f.flag} fill={c[flagToken(f.flag) as (typeof TOKENS)[number]]} />
                ))}
                <LabelList dataKey="n" position="right" fill={c['--text-secondary']} fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </Grid>

      <section>
        <SectionHeader title="Top écarts" aside={<Link to={tabLink('ecarts')}>Tous les écarts</Link>} />
        {top.length === 0 ? (
          <Text tone="secondary">Aucun écart signalé sur la période.</Text>
        ) : (
          <Table hover minWidth={640}>
            <thead>
              <tr>
                <th>Ressource</th>
                <th>CT</th>
                <th>Semaine</th>
                <th data-align="right">Prévu</th>
                <th data-align="right">Réel</th>
                <th data-align="right">Écart</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {top.map((e, i) => (
                <tr
                  key={`${e.ressource}|${e.ct}|${e.semaine}|${i}`}
                  data-clickable
                  onClick={() => drill({ ct: e.ct, ressource: e.ressource })}
                  tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && drill({ ct: e.ct, ressource: e.ressource })}
                  aria-label={`Voir les écarts de ${e.ressource_label} sur ${e.ct}`}
                >
                  <td>
                    <Group gap={4} wrap={false}>
                      <Text>{e.ressource_label || e.ressource}</Text>
                      {e.confidence === 'fuzzy' && <FuzzyMark />}
                      {e.inactive && <InactiveBadge />}
                    </Group>
                  </td>
                  <td>
                    <CtCell ct={e.ct} />
                  </td>
                  <td data-nowrap>{fmtWeek(e.semaine)}</td>
                  <td data-align="right">{fmtHours(e.prevu)}</td>
                  <td data-align="right">{fmtHours(e.reel)}</td>
                  <td data-align="right">
                    <Text as="span" weight={600} tone={ecartTone(e.flag, e.ecart)}>
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
      </section>
    </Stack>
  );
}
