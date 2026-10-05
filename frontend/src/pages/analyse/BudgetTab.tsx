// Sous-onglet Budget (§7.4) : synthèse globale, table par CT (drill-down vers Écarts), barres empilées par CT.
import { useMemo } from 'react';
import { Alert, Badge, Card, Group, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconAlertTriangle, IconChevronRight } from '@tabler/icons-react';
import type { AnalyseResult, BudgetCT } from '../../api/types';
import { fmtEur, fmtHours, fmtPct } from '../../lib/format';
import { CtCell, SortTh, StatCard, cmp, useChartPalette, useSort } from './common';
import { useDrillDown } from './params';

type Key = 'ct' | 'securise' | 'non_securise' | 'non_classe' | 'pct_securite' | 'pps_plan' | 'heures_mo' | 'cout_mo_eur';
const CHART_MAX = 15;

export default function BudgetTab({ result }: { result: AnalyseResult }) {
  const { par_ct, global } = result.budget;
  const pal = useChartPalette();
  const drill = useDrillDown();
  const { sort, toggle } = useSort<Key>({ key: 'non_securise', dir: 'desc' });

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
        ct: b.risque ? `⚠️ ${b.ct}` : b.ct,
        securise: Math.round(b.securise),
        non_securise: Math.round(b.non_securise),
        non_classe: Math.round(b.non_classe),
      }));
  }, [par_ct]);

  const totals = useMemo(
    () =>
      par_ct.reduce(
        (s, b) => ({ pps: s.pps + b.pps_plan, h: s.h + b.heures_mo, mo: s.mo + b.cout_mo_eur }),
        { pps: 0, h: 0, mo: 0 },
      ),
    [par_ct],
  );

  return (
    <Stack gap="lg">
      {result.alertes.alerte_globale && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="Alerte globale">
          Part non sécurisée de {fmtPct(global.pct_non_securise)} : au-delà du seuil paramétré.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <StatCard label="🔒 Sécurisé" value={fmtEur(global.securise)} accent="blue" />
        <StatCard label="⚠️ Non sécurisé" value={fmtEur(global.non_securise)} sub={`${fmtPct(global.pct_non_securise)} du budget classé`} accent="orange" />
        <StatCard label="Non classé" value={fmtEur(global.non_classe)} sub="TYPE hors listes de référence" accent="gray" />
        <StatCard label="% sécurité global" value={fmtPct(global.pct_securite)} sub="Σ sécurisé ÷ Σ (sécurisé + non sécurisé)" accent="indigo" />
      </SimpleGrid>

      <Card withBorder radius="md" padding="md">
        <Title order={4} mb={2}>
          Budget par CT
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          € réalisés par classification{par_ct.length > CHART_MAX ? ` — ${CHART_MAX} CT les plus consommateurs` : ''} · ⚠️ = CT à risque. Hors main d’œuvre (comptée en heures).
        </Text>
        {chartData.length === 0 ? (
          <Text c="dimmed" size="sm">
            Aucune écriture valorisée en €.
          </Text>
        ) : (
          <BarChart
            h={chartData.length * 40 + 90}
            data={chartData}
            dataKey="ct"
            type="stacked"
            orientation="vertical"
            series={[
              { name: 'securise', label: 'Sécurisé', color: pal.series1 },
              { name: 'non_securise', label: 'Non sécurisé', color: pal.series2 },
              { name: 'non_classe', label: 'Non classé', color: pal.other },
            ]}
            valueFormatter={(v) => fmtEur(v)}
            withLegend
            legendProps={{ verticalAlign: 'bottom', height: 36 }}
            tickLine="none"
            gridAxis="x"
            strokeDasharray="0"
            gridColor={pal.grid}
            textColor={pal.text}
            maxBarWidth={24}
            barProps={{ stroke: pal.surface, strokeWidth: 1 }}
            yAxisProps={{ width: 120 }}
            xAxisProps={{ tickFormatter: (v: number) => fmtEur(v) }}
          />
        )}
      </Card>

      <Card withBorder radius="md" padding="md">
        <Title order={4} mb={2}>
          Synthèse par CT
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          Cliquer une ligne pour ouvrir le tableau d’écarts filtré sur ce CT.
        </Text>
        <Table.ScrollContainer minWidth={980}>
          <Table highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <SortTh k="ct" sort={sort} onSort={toggle}>
                  CT
                </SortTh>
                <SortTh k="securise" sort={sort} onSort={toggle} align="right">
                  🔒 Sécurisé
                </SortTh>
                <SortTh k="non_securise" sort={sort} onSort={toggle} align="right">
                  ⚠️ Non sécurisé
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
                  <Tooltip label="Coût de la main d’œuvre, à titre informatif (non inclus dans les Σ € — évite le double comptage)" multiline maw={280}>
                    <span>Coût MO (info)</span>
                  </Tooltip>
                </SortTh>
                <Table.Th aria-label="Action" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((b) => (
                <Table.Tr
                  key={b.ct}
                  onClick={() => drill({ ct: b.ct })}
                  onKeyDown={(e) => e.key === 'Enter' && drill({ ct: b.ct })}
                  tabIndex={0}
                  aria-label={`Voir les écarts du CT ${b.ct}`}
                  style={{ cursor: 'pointer', background: b.risque ? 'var(--mantine-color-red-light)' : undefined }}
                >
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <CtCell ct={b.ct} libelle={b.ct_libelle} />
                      {b.risque && (
                        <Badge color="red" variant="filled" size="sm" leftSection="⚠️">
                          À risque
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{fmtEur(b.securise)}</Table.Td>
                  <Table.Td ta="right" fw={b.risque ? 700 : undefined}>
                    {fmtEur(b.non_securise)}
                  </Table.Td>
                  <Table.Td ta="right">{fmtEur(b.non_classe)}</Table.Td>
                  <Table.Td ta="right">{fmtPct(b.pct_securite)}</Table.Td>
                  <Table.Td ta="right">{fmtEur(b.pps_plan)}</Table.Td>
                  <Table.Td ta="right">{fmtHours(b.heures_mo)}</Table.Td>
                  <Table.Td ta="right" c="dimmed">
                    {fmtEur(b.cout_mo_eur)}
                  </Table.Td>
                  <Table.Td>
                    <IconChevronRight size={16} aria-hidden />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={600}>
                <Table.Td>Total ({par_ct.length} CT)</Table.Td>
                <Table.Td ta="right">{fmtEur(global.securise)}</Table.Td>
                <Table.Td ta="right">{fmtEur(global.non_securise)}</Table.Td>
                <Table.Td ta="right">{fmtEur(global.non_classe)}</Table.Td>
                <Table.Td ta="right">{fmtPct(global.pct_securite)}</Table.Td>
                <Table.Td ta="right">{fmtEur(totals.pps)}</Table.Td>
                <Table.Td ta="right">{fmtHours(Math.round(totals.h * 10) / 10)}</Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {fmtEur(totals.mo)}
                </Table.Td>
                <Table.Td />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
