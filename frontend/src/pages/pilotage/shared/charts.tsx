// Graphiques partagés des pages Pilotage : trajectoire cumulée (budget, réalisé, plan, tendance),
// charge hebdomadaire, légende et bulle au look du kit. Couleurs résolues depuis les tokens.
import type { CSSProperties, ReactNode } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PrevisionPoint } from '../../../api/types';
import { fmtEur, fmtHours, fmtWeek } from '../../../lib/format';
import { fmtEurShort, useTokenColors, weekShort } from './pilotage';
import './pilotage.css';

// ------------------------------------------------------------------ Légende et bulle

/** Série affichée : clé de donnée, libellé, token de teinte, forme de la pastille. */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
  /** Pastille : trait plein, trait pointillé, ou carré (barres / aires). */
  shape?: 'line' | 'dash' | 'box';
  /** Opacité de la pastille (piste = 0,3). */
  opacity?: number;
}

function Swatch({ s }: { s: ChartSeries }) {
  return (
    <span
      className="pil-swatch"
      data-shape={s.shape ?? 'box'}
      style={{ '--pil-swatch': `var(${s.token})`, opacity: s.opacity } as CSSProperties}
      aria-hidden
    />
  );
}

/** Légende sous un graphique : 12 px secondaire, pastilles alignées à gauche. */
export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="pil-legend">
      {series.map((s) => (
        <span key={s.key} className="pil-legend__item">
          <Swatch s={s} />
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
 * titre 13/600, une ligne 12 px par série renseignée avec sa pastille.
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
  series: ChartSeries[];
  format: (v: number) => string;
  title?: (datum: D) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as D;
  const rows = series
    .map((s) => ({ s, entry: payload.find((p) => p.dataKey === s.key) }))
    .filter(({ entry }) => entry && entry.value != null);
  if (rows.length === 0) return null;
  return (
    <div className="pil-tooltip">
      <div className="pil-tooltip__title">{title ? title(datum) : label}</div>
      {rows.map(({ s, entry }) => (
        <div key={s.key} className="pil-tooltip__row">
          <Swatch s={s} />
          {s.label}
          <span className="pil-tooltip__value">{format(Number(entry!.value))}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Trajectoire cumulée

const FORECAST_SERIES: ChartSeries[] = [
  { key: 'reel_cumul', label: 'Réalisé', token: '--blue', shape: 'line' },
  { key: 'plan_cumul', label: 'Atterrissage plan', token: '--blue', shape: 'line', opacity: 0.5 },
  { key: 'tendance_cumul', label: 'Tendance', token: '--orange', shape: 'dash' },
  { key: 'budget_cumul', label: 'Budget prévu', token: '--text-tertiary', shape: 'dash' },
];

const FORECAST_TOKENS = ['--blue', '--orange', '--text-tertiary', '--text-secondary', '--separator', '--fill'] as const;

const AXIS = { axisLine: false, tickLine: false } as const;

export interface ForecastChartProps {
  series: PrevisionPoint[];
  /** Semaine de l'arrêté des données (repère « Aujourd'hui »). */
  asOfWeek: string;
  /** Budget total : ligne horizontale. */
  budget: number;
  height?: number;
  /** Légende HTML sous le graphique (défaut true). */
  legend?: boolean;
}

/** Courbes cumulées en € : budget (aire pâle), réalisé (plein), plan, tendance (pointillé). */
export function ForecastChart({ series, asOfWeek, budget, height = 260, legend = true }: ForecastChartProps) {
  const c = useTokenColors(FORECAST_TOKENS);
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const hasToday = series.some((p) => p.week === asOfWeek);
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} />
          <RTooltip
            cursor={{ stroke: c['--separator'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={<ChartTooltip<PrevisionPoint> series={FORECAST_SERIES} format={(v) => fmtEur(v)} title={(d) => fmtWeek(d.week)} />}
          />
          <Area
            dataKey="budget_cumul"
            type="monotone"
            stroke={c['--text-tertiary']}
            strokeDasharray="4 4"
            strokeWidth={1}
            fill={c['--fill']}
            fillOpacity={1}
            isAnimationActive={false}
            activeDot={false}
          />
          {budget > 0 && (
            <ReferenceLine
              y={budget}
              ifOverflow="extendDomain"
              stroke={c['--text-tertiary']}
              strokeDasharray="2 4"
              label={{ value: `Budget ${fmtEurShort(budget)}`, position: 'insideBottomLeft', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          {hasToday && (
            <ReferenceLine
              x={asOfWeek}
              stroke={c['--text-secondary']}
              strokeWidth={1}
              label={{ value: 'Aujourd’hui', position: 'top', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          <Line dataKey="plan_cumul" type="monotone" stroke={c['--blue']} strokeOpacity={0.5} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="tendance_cumul" type="monotone" stroke={c['--orange']} strokeDasharray="4 3" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="reel_cumul" type="monotone" stroke={c['--blue']} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {legend && <ChartLegend series={FORECAST_SERIES} />}
    </div>
  );
}

// ------------------------------------------------------------------ Charge hebdomadaire

const LOAD_SERIES: ChartSeries[] = [
  { key: 'passe', label: 'Réalisé', token: '--blue' },
  { key: 'avenir', label: 'Planifié', token: '--blue', opacity: 0.3 },
];

const LOAD_TOKENS = ['--blue', '--text-secondary', '--separator', '--fill'] as const;

/** Heures par semaine : passé = réalisé (plein), à venir = plan (piste), repère « Aujourd'hui ». */
export function LoadChart({ series, asOfWeek, height = 200 }: { series: PrevisionPoint[]; asOfWeek: string; height?: number }) {
  const c = useTokenColors(LOAD_TOKENS);
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const data = series.map((p) => ({
    week: p.week,
    passe: p.week <= asOfWeek ? (p.heures_reel ?? 0) : null,
    avenir: p.week > asOfWeek ? p.heures_plan : null,
  }));
  const hasToday = data.some((p) => p.week === asOfWeek);
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} tick={tick} tickFormatter={(v: number) => fmtHours(v)} />
          <RTooltip
            cursor={{ fill: c['--fill'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={<ChartTooltip<{ week: string }> series={LOAD_SERIES} format={fmtHours} title={(d) => fmtWeek(d.week)} />}
          />
          {hasToday && (
            <ReferenceLine
              x={asOfWeek}
              stroke={c['--text-secondary']}
              label={{ value: 'Aujourd’hui', position: 'top', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          <Bar dataKey="passe" stackId="h" fill={c['--blue']} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Bar dataKey="avenir" stackId="h" fill={c['--blue']} fillOpacity={0.3} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <ChartLegend series={LOAD_SERIES} />
    </div>
  );
}
