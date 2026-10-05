// Sous-onglet Tableau de bord (§7.6) : cartes KPI, prévu vs réel par semaine, répartition des flags, top écarts.
import { useMemo, useState } from 'react';
import { Anchor, Card, Collapse, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import type { AnalyseResult, Flag } from '../../api/types';
import { FLAG_META, FlagBadge, InactiveBadge } from '../../components/badges';
import { fmtHours, fmtHoursSigned, fmtPct, fmtRatio, fmtWeek } from '../../lib/format';
import { CtCell, FuzzyMark, StatCard, ecartColor, useChartPalette } from './common';
import { useDrillDown, useTabLink } from './params';

const FLAG_ORDER: Flag[] = ['absence', 'hors_plan', 'sur_imputation', 'sous_imputation', 'conforme'];

function PointsRow({ flag, points, detail }: { flag: Flag; points: number; detail: string }) {
  const m = FLAG_META[flag];
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs">
        <span aria-hidden>{m.emoji}</span> {m.label}
      </Text>
      <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <Text span fw={600} c="var(--mantine-color-text)">
          {points} pt{points > 1 ? 's' : ''}
        </Text>{' '}
        · {detail}
      </Text>
    </Group>
  );
}

export default function DashboardTab({ result }: { result: AnalyseResult }) {
  const { kpis, ecarts, meta } = result;
  const pal = useChartPalette();
  const drill = useDrillDown();
  const tabLink = useTabLink();
  const [showWeeklyTable, setShowWeeklyTable] = useState(false);

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
    const c: Record<Flag, number> = { absence: 0, hors_plan: 0, sur_imputation: 0, sous_imputation: 0, conforme: 0 };
    for (const e of ecarts) c[e.flag] += 1;
    return FLAG_ORDER.map((f) => ({ flag: f, label: `${FLAG_META[f].emoji} ${FLAG_META[f].label}`, n: c[f] }));
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
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
        <StatCard
          label="Taux de conformité"
          value={fmtRatio(kpis.taux_conformite)}
          sub={`${kpis.nb_conformes} conformes / ${kpis.nb_tuples_compares} tuples comparés${meta.include_inactive ? '' : ' · inactifs exclus'}`}
          accent="green"
        />
        <StatCard label="Points FLAG" value={kpis.points_total} accent="red">
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
          sub={`${kpis.nb_personnes_absentes} absent${kpis.nb_personnes_absentes > 1 ? 's' : ''} / ${kpis.nb_personnes_planifiees} planifié${kpis.nb_personnes_planifiees > 1 ? 's' : ''} (⚫ Σ réel = 0 sur la période)`}
          accent="dark"
        />
        <StatCard
          label="Budget sécurisé"
          value={fmtPct(kpis.pct_securise)}
          sub="Sécurisé ÷ (sécurisé + non sécurisé)"
          accent="blue"
        >
          <Anchor component={Link} to={tabLink('budget')} size="xs">
            Voir la synthèse budgétaire
          </Anchor>
        </StatCard>
        <StatCard
          label="CT à risque"
          value={kpis.nb_ct_risque}
          sub="Σ non sécurisé au-delà du seuil"
          accent={kpis.nb_ct_risque > 0 ? 'orange' : 'gray'}
        >
          <Anchor component={Link} to={tabLink('alertes')} size="xs">
            Voir les alertes
          </Anchor>
        </StatCard>
        <StatCard
          label="Prévu vs réel"
          value={
            <>
              {fmtHours(kpis.total_prevu_h)}{' '}
              <Text span c="dimmed" fz={18}>
                / {fmtHours(kpis.total_reel_h)}
              </Text>
            </>
          }
          sub={`Écart global ${fmtHoursSigned(Math.round(ecartTotal * 10) / 10)} (réel − prévu, hors plan inclus)`}
          accent="indigo"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" padding="md">
          <Group justify="space-between" mb="xs">
            <Title order={4}>Prévu vs réel par semaine</Title>
            <Anchor component="button" type="button" size="xs" onClick={() => setShowWeeklyTable((s) => !s)}>
              {showWeeklyTable ? 'Masquer les données' : 'Voir les données'}
            </Anchor>
          </Group>
          <BarChart
            h={280}
            data={weekly}
            dataKey="label"
            series={[
              { name: 'prevu', label: 'Prévu', color: pal.series1 },
              { name: 'reel', label: 'Réel', color: pal.series2 },
            ]}
            valueFormatter={(v) => fmtHours(v)}
            withLegend
            legendProps={{ verticalAlign: 'bottom', height: 36 }}
            tickLine="none"
            gridAxis="y"
            strokeDasharray="0"
            gridColor={pal.grid}
            textColor={pal.text}
            maxBarWidth={24}
            barProps={{ radius: [4, 4, 0, 0] }}
            barChartProps={{ barGap: 2 }}
            yAxisProps={{ width: 64 }}
          />
          <Collapse in={showWeeklyTable}>
            <Table.ScrollContainer minWidth={320} mt="sm">
              <Table striped withTableBorder fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Semaine</Table.Th>
                    <Table.Th ta="right">Prévu</Table.Th>
                    <Table.Th ta="right">Réel</Table.Th>
                    <Table.Th ta="right">Écart</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {weekly.map((w) => (
                    <Table.Tr key={w.week}>
                      <Table.Td>{fmtWeek(w.week)}</Table.Td>
                      <Table.Td ta="right">{fmtHours(w.prevu)}</Table.Td>
                      <Table.Td ta="right">{fmtHours(w.reel)}</Table.Td>
                      <Table.Td ta="right">{fmtHoursSigned(Math.round((w.reel - w.prevu) * 10) / 10)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Collapse>
        </Card>

        <Card withBorder radius="md" padding="md">
          <Title order={4} mb={2}>
            Répartition des flags
          </Title>
          <Text size="xs" c="dimmed" mb="xs">
            Nombre de tuples ressource × CT × semaine — cliquer une barre filtre le tableau d’écarts
          </Text>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <RBarChart data={flagCounts} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke={pal.grid} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: pal.text, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={150}
                  tick={{ fill: pal.text, fontSize: 12 }}
                  axisLine={{ stroke: pal.grid }}
                  tickLine={false}
                />
                <RTooltip
                  cursor={{ fill: pal.grid, fillOpacity: 0.4 }}
                  formatter={(v: number) => [`${v} tuple${v > 1 ? 's' : ''}`, 'Nombre']}
                  contentStyle={{
                    background: 'var(--mantine-color-body)',
                    border: '1px solid var(--mantine-color-default-border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--mantine-color-text)' }}
                  itemStyle={{ color: 'var(--mantine-color-text)' }}
                />
                <Bar
                  dataKey="n"
                  maxBarSize={24}
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(d: { flag?: Flag }) => d.flag && drill({ flags: [d.flag] })}
                  isAnimationActive={false}
                >
                  {flagCounts.map((f) => (
                    <Cell key={f.flag} fill={pal.flag[f.flag]} />
                  ))}
                  <LabelList dataKey="n" position="right" fill={pal.text} fontSize={12} />
                </Bar>
              </RBarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" padding="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Top écarts</Title>
          <Anchor component={Link} to={tabLink('ecarts')} size="sm">
            Tous les écarts
          </Anchor>
        </Group>
        {top.length === 0 ? (
          <Text c="dimmed" size="sm">
            Aucun écart signalé sur la période. 🟢
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Ressource</Table.Th>
                  <Table.Th>CT</Table.Th>
                  <Table.Th>Semaine</Table.Th>
                  <Table.Th ta="right">Prévu</Table.Th>
                  <Table.Th ta="right">Réel</Table.Th>
                  <Table.Th ta="right">Écart</Table.Th>
                  <Table.Th>Flag</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {top.map((e, i) => (
                  <Table.Tr
                    key={`${e.ressource}|${e.ct}|${e.semaine}|${i}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => drill({ ct: e.ct, ressource: e.ressource })}
                    tabIndex={0}
                    onKeyDown={(ev) => ev.key === 'Enter' && drill({ ct: e.ct, ressource: e.ressource })}
                    aria-label={`Voir les écarts de ${e.ressource_label} sur ${e.ct}`}
                  >
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Text size="sm">{e.ressource_label || e.ressource}</Text>
                        {e.confidence === 'fuzzy' && <FuzzyMark />}
                        {e.inactive && <InactiveBadge />}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <CtCell ct={e.ct} />
                    </Table.Td>
                    <Table.Td>{fmtWeek(e.semaine)}</Table.Td>
                    <Table.Td ta="right">{fmtHours(e.prevu)}</Table.Td>
                    <Table.Td ta="right">{fmtHours(e.reel)}</Table.Td>
                    <Table.Td ta="right">
                      <Text span size="sm" fw={600} c={ecartColor(e.flag, e.ecart)}>
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
      </Card>
    </Stack>
  );
}
