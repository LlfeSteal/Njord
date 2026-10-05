// Composants partagés des sous-onglets Analyse : bulle et légende des graphiques, en-têtes triables, cartes KPI, badges.
// Les utilitaires (couleurs, tri, confiance, écarts) sont dans helpers.ts.
import type { ReactNode } from 'react';
import {
  Card,
  Group,
  SortHeader,
  Stack,
  StatusGlyph,
  Tag,
  Text,
  Title,
  Tooltip,
  type GlyphKind,
  type StatusTone,
} from '../../ui';
import type { Confidence } from '../../api/types';
import { CONFIDENCE_META, type ChartSeries, type SortState } from './helpers';
import './analyse.css';

function Swatch({ token, opacity }: { token: string; opacity?: number }) {
  return <span className="analyse-swatch" style={{ background: `var(${token})`, opacity }} aria-hidden />;
}

/** Légende sous un graphique : 12 px secondaire, pastilles 10 px rayon 3. */
export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="analyse-chart-legend">
      {series.map((s) => (
        <span key={s.key} className="analyse-chart-legend-item">
          <Swatch token={s.token} opacity={s.opacity} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

interface TooltipEntry {
  dataKey?: unknown;
  value?: unknown;
  payload?: unknown;
}

/**
 * Contenu de bulle recharts (`<RTooltip content={<ChartTooltip … />} />`), au look de la bulle du kit :
 * titre 13/600, une ligne 12 px secondaire par série avec sa pastille.
 */
export function ChartTooltip<D = unknown>({
  active,
  payload,
  label,
  series,
  format,
  title,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  series: ChartSeries[] | ((datum: D) => ChartSeries[]);
  format: (v: number) => string;
  title?: (datum: D) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as D;
  const list = typeof series === 'function' ? series(datum) : series;
  return (
    <div className="analyse-chart-tooltip">
      <div className="analyse-chart-tooltip-title">{title ? title(datum) : label}</div>
      {list.map((s) => {
        const entry = payload.find((p) => p.dataKey === s.key);
        if (!entry) return null;
        return (
          <div key={s.key} className="analyse-chart-tooltip-row">
            <Swatch token={s.token} opacity={s.opacity} />
            {s.label}
            <span className="analyse-chart-tooltip-value">{format(Number(entry.value))}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  align,
}: {
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  children: ReactNode;
  align?: 'right';
}) {
  return (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => onSort(k)} align={align}>
      {children}
    </SortHeader>
  );
}

// ------------------------------------------------------------------ Sections et cartes KPI
/** En-tête de section : titre 15/600, élément à droite, sous-titre 12 px secondaire. */
export function SectionHeader({ title, sub, aside }: { title: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <Stack gap={2} mb={8}>
      <Group justify="between" wrap={false}>
        <Title order={3}>{title}</Title>
        {aside}
      </Group>
      {sub && (
        <Text size="sm" tone="secondary">
          {sub}
        </Text>
      )}
    </Stack>
  );
}

/** Carte KPI (§8) : pas de bordure colorée ; un glyphe de statut optionnel avant le libellé donne le ton. */
export function StatCard({
  label,
  value,
  sub,
  children,
  glyph,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  glyph?: { kind: GlyphKind; tone: StatusTone };
}) {
  return (
    <Card>
      <Stack gap={4}>
        <Group gap={6} wrap={false}>
          {glyph && <StatusGlyph kind={glyph.kind} tone={glyph.tone} size={12} />}
          <Text size="sm" tone="secondary">
            {label}
          </Text>
        </Group>
        <Text size="kpi">{value}</Text>
        {sub && (
          <Text size="sm" tone="secondary">
            {sub}
          </Text>
        )}
        {children}
      </Stack>
    </Card>
  );
}

// ------------------------------------------------------------------ Confiance de correspondance
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const m = CONFIDENCE_META[confidence];
  return (
    <Tooltip label={m.hint}>
      <Tag tone={m.tone} glyph={m.glyph}>
        {m.label}
      </Tag>
    </Tooltip>
  );
}

/** Astérisque des correspondances approximatives. */
export function FuzzyMark() {
  return (
    <Tooltip label="Correspondance approximative (nom normalisé)">
      <Text
        as="span"
        tone="warning"
        weight={600}
        aria-label="correspondance approximative (nom normalisé)"
        style={{ cursor: 'help' }}
      >
        *
      </Text>
    </Tooltip>
  );
}

export function CtCell({ ct, libelle }: { ct: string; libelle?: string }) {
  return (
    <Stack gap={0}>
      <Text mono>{ct}</Text>
      {libelle && (
        <Text size="sm" tone="secondary" lineClamp={1}>
          {libelle}
        </Text>
      )}
    </Stack>
  );
}
