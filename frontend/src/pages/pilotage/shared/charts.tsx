// Graphiques partagés des pages Pilotage : trajectoire cumulée (plan, budget max, provisions, réalisé, tendance),
// charge hebdomadaire, légende et bulle au look du kit. Couleurs résolues depuis les tokens.
// Semaines non couvertes par le plan de charge (DECISIONS n° 13) : hachure neutre + entrée de légende.
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Couverture, PrevisionPoint } from '../../../api/types';
import { fmtEur, fmtHours, fmtWeek } from '../../../lib/format';
import { fmtEurShort, useTokenColors, weekShort } from './pilotage';
import './pilotage.css';

// ------------------------------------------------------------------ Légende et bulle

/** Série affichée : clé de donnée, libellé, token de teinte, forme de la pastille. */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
  /** Pastille : trait plein, tirets, pointillé (ligne de référence), carré (barres / aires / bandes) ou hachure (non couvert). */
  shape?: 'line' | 'dash' | 'dot' | 'box' | 'hatch';
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

/** Légende sous un graphique : 12 px secondaire, pastilles alignées à gauche (`flush` : sans retrait d'axe Y). */
export function ChartLegend({ series, flush = false }: { series: ChartSeries[]; flush?: boolean }) {
  return (
    <div className="pil-legend" data-flush={flush || undefined}>
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
  note,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  series: ChartSeries[];
  format: (v: number) => string;
  title?: (datum: D) => ReactNode;
  /** Mention sous le titre (ex. semaine non couverte par le plan). */
  note?: (datum: D) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as D;
  const rows = series
    .map((s) => ({ s, entry: payload.find((p) => p.dataKey === s.key) }))
    .filter(({ entry }) => entry && entry.value != null);
  const mention = note?.(datum);
  if (rows.length === 0 && !mention) return null;
  return (
    <div className="pil-tooltip">
      <div className="pil-tooltip__title">{title ? title(datum) : label}</div>
      {mention && <div className="pil-tooltip__note">{mention}</div>}
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

// ------------------------------------------------------------------ Non couvert par le plan

const UNCOVERED_LABEL = 'Non couvert par le plan de charge';

/** Entrée de légende de la hachure « non couvert ». */
const UNCOVERED_SERIES: ChartSeries = { key: 'uncovered', label: UNCOVERED_LABEL, token: '--uncovered', shape: 'hatch' };

/** Mention de bulle d'une semaine selon sa couverture par la timeline du plan. */
function couvertureNote(c: Couverture | undefined): string | null {
  if (c === 'aucune') return UNCOVERED_LABEL;
  if (c === 'partielle') return 'Semaine partiellement couverte par le plan de charge';
  return null;
}

/** Suite de semaines consécutives non couvertes, en pas d'axe autour de la zone à hachurer. */
interface UncoveredRun {
  x1: string;
  x2: string;
  /** Pas d'axe couverts par le rectangle x1 → x2 (échelle « point »). */
  span: number;
  /** Retraits (en pas) au début et à la fin du rectangle. */
  insetStart: number;
  insetEnd: number;
}

/**
 * Suites de semaines `couverture === 'aucune'`. Échelle « band » (barres) : x1/x2 = première et dernière
 * semaine (ReferenceArea couvre leurs bandes). Échelle « point » (courbes) : une semaine n'a pas de largeur,
 * on étend aux semaines voisines puis on retire un demi-pas de chaque côté (zone centrée sur les points).
 */
function uncoveredRuns(points: { week: string; couverture?: Couverture }[], scale: 'band' | 'point'): UncoveredRun[] {
  const out: UncoveredRun[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    if (points[i].couverture !== 'aucune') continue;
    let j = i;
    while (j + 1 < n && points[j + 1].couverture === 'aucune') j++;
    if (scale === 'band') out.push({ x1: points[i].week, x2: points[j].week, span: 0, insetStart: 0, insetEnd: 0 });
    else {
      const a = i > 0 ? i - 1 : i;
      const b = j < n - 1 ? j + 1 : j;
      if (b > a)
        out.push({
          x1: points[a].week,
          x2: points[b].week,
          span: b - a,
          insetStart: a < i ? 0.5 : 0,
          insetEnd: b > j ? 0.5 : 0,
        });
    }
    i = j;
  }
  return out;
}

const HATCH_TOKENS = ['--gray'] as const;

/**
 * Motif de hachure SVG (135°, trait 2 px tous les 7 px, comme `--uncovered-hatch`). Appelé comme une fonction :
 * recharts n'affiche parmi ses enfants que ses propres composants et les éléments SVG bruts.
 */
function hatchDefs(id: string, color: string) {
  return (
    <defs>
      <pattern id={id} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={7} height={7} fill={color} fillOpacity={0.06} />
        <rect width={2} height={7} fill={color} fillOpacity={0.3} />
      </pattern>
    </defs>
  );
}

interface RectProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Zones hachurées des semaines non couvertes (ReferenceArea est rendu par recharts : appel direct, pas un composant). */
function uncoveredAreas(runs: UncoveredRun[], patternId: string) {
  return runs.map((r) => (
    <ReferenceArea
      key={r.x1}
      x1={r.x1}
      x2={r.x2}
      ifOverflow="hidden"
      shape={(p: RectProps) => {
        const x = p.x ?? 0;
        const w = p.width ?? 0;
        const step = r.span > 0 ? w / r.span : 0;
        return (
          <rect
            x={x + r.insetStart * step}
            y={p.y}
            width={Math.max(0, w - (r.insetStart + r.insetEnd) * step)}
            height={p.height}
            fill={`url(#${patternId})`}
          />
        );
      }}
    />
  ));
}

/** Id de motif SVG unique par graphique (sans « : », mal toléré dans `url(#…)`). */
const usePatternId = () => `pil-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

// ------------------------------------------------------------------ Trajectoire cumulée
// Budget = charge max = Σ PPS du plan + provisions restantes (DECISIONS n° 16). La courbe cumulée reste
// celle du plan seul ; les provisions ne sont pas placées à leurs dates : elles forment une bande
// « Provisions restantes » entre le total du plan et la ligne « Budget max ».

const FORECAST_SERIES: ChartSeries[] = [
  { key: 'reel_cumul', label: 'Réalisé', token: '--blue', shape: 'line' },
  { key: 'plan_cumul', label: 'Atterrissage plan', token: '--blue', shape: 'line', opacity: 0.5 },
  { key: 'tendance_cumul', label: 'Tendance', token: '--orange', shape: 'dash' },
  { key: 'budget_cumul', label: 'Plan de charge cumulé', token: '--text-tertiary', shape: 'dash' },
];

/** Entrées de légende propres au budget max (affichées seulement avec des provisions). */
const BUDGET_MAX_SERIES: ChartSeries = { key: 'budget_max', label: 'Budget max (PDC + provisions)', token: '--text-secondary', shape: 'dot' };
const PROVISION_SERIES: ChartSeries = { key: 'provisions', label: 'Provisions restantes', token: '--series-provision', shape: 'box' };

const FORECAST_TOKENS = ['--blue', '--orange', '--text-tertiary', '--text-secondary', '--separator', '--fill'] as const;

const AXIS = { axisLine: false, tickLine: false } as const;

/** Hauteur minimale (px) de la bande pour y écrire son libellé sans chevaucher la fin de la courbe du plan. */
const BAND_LABEL_MIN_HEIGHT = 30;

interface LabelViewBox {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

export interface ForecastChartProps {
  series: PrevisionPoint[];
  /** Semaine de l'arrêté des données (repère « Aujourd'hui »). */
  asOfWeek: string;
  /** Budget = charge max (Σ PPS + provisions) : ligne horizontale. */
  budget: number;
  /** Σ PPS du plan : bas de la bande « Provisions restantes » (bande absente si pps ≥ budget ou non fourni). */
  pps?: number;
  height?: number;
  /** Légende HTML sous le graphique (défaut true). */
  legend?: boolean;
}

/**
 * Courbes cumulées en € : plan de charge cumulé (aire pâle), réalisé (plein), atterrissage plan, tendance (pointillé),
 * budget max (ligne pointillée) et provisions restantes (bande entre le total du plan et le budget max).
 */
export function ForecastChart({ series, asOfWeek, budget, pps, height = 260, legend = true }: ForecastChartProps) {
  const c = useTokenColors(FORECAST_TOKENS);
  const hatch = useTokenColors(HATCH_TOKENS);
  const patternId = usePatternId();
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const hasToday = series.some((p) => p.week === asOfWeek);
  const runs = uncoveredRuns(series, 'point');
  const hasUncovered = series.some((p) => p.couverture === 'aucune');
  // Bande des provisions : seulement si elle a une épaisseur (évite une bande d'arrondi).
  const band = pps != null && budget - pps > 0.5 ? { y1: Math.max(0, pps), y2: budget } : null;
  const legendSeries = [
    ...FORECAST_SERIES,
    ...(band ? [BUDGET_MAX_SERIES, PROVISION_SERIES] : []),
    ...(hasUncovered ? [UNCOVERED_SERIES] : []),
  ];
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          {hatchDefs(patternId, hatch['--gray'])}
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          {uncoveredAreas(runs, patternId)}
          {band && (
            <ReferenceArea
              y1={band.y1}
              y2={band.y2}
              ifOverflow="extendDomain"
              // Token appliqué en style CSS (color-mix + thème) plutôt qu'en attribut SVG.
              shape={(p: RectProps) => <rect x={p.x} y={p.y} width={p.width} height={p.height} style={{ fill: 'var(--series-provision)' }} />}
              label={(p: LabelViewBox) => {
                const vb = p.viewBox ?? {};
                if ((vb.height ?? 0) < BAND_LABEL_MIN_HEIGHT || (vb.width ?? 0) < 160) return <g />;
                return (
                  <text
                    x={(vb.x ?? 0) + (vb.width ?? 0) - 6}
                    y={(vb.y ?? 0) + 15}
                    textAnchor="end"
                    fill={c['--text-secondary']}
                    fontSize={11}
                  >
                    {PROVISION_SERIES.label}
                  </text>
                );
              }}
            />
          )}
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} />
          <RTooltip
            cursor={{ stroke: c['--separator'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={
              <ChartTooltip<PrevisionPoint>
                series={FORECAST_SERIES}
                format={(v) => fmtEur(v)}
                title={(d) => fmtWeek(d.week)}
                note={(d) => couvertureNote(d.couverture)}
              />
            }
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
              stroke={band ? c['--text-secondary'] : c['--text-tertiary']}
              strokeDasharray={band ? '2 3' : '2 4'}
              strokeWidth={band ? 1.5 : 1}
              label={{
                value: `${band ? 'Budget max' : 'Budget'} ${fmtEurShort(budget)}`,
                position: 'insideBottomLeft',
                fill: c['--text-secondary'],
                fontSize: 11,
              }}
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
      {legend && <ChartLegend series={legendSeries} />}
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
  const hatch = useTokenColors(HATCH_TOKENS);
  const patternId = usePatternId();
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const data = series.map((p) => ({
    week: p.week,
    couverture: p.couverture,
    passe: p.week <= asOfWeek ? (p.heures_reel ?? 0) : null,
    avenir: p.week > asOfWeek ? p.heures_plan : null,
  }));
  const hasToday = data.some((p) => p.week === asOfWeek);
  const runs = uncoveredRuns(data, 'band');
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          {hatchDefs(patternId, hatch['--gray'])}
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          {uncoveredAreas(runs, patternId)}
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} tick={tick} tickFormatter={(v: number) => fmtHours(v)} />
          <RTooltip
            cursor={{ fill: c['--fill'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={
              <ChartTooltip<{ week: string; couverture?: Couverture }>
                series={LOAD_SERIES}
                format={fmtHours}
                title={(d) => fmtWeek(d.week)}
                note={(d) => couvertureNote(d.couverture)}
              />
            }
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
      <ChartLegend series={runs.length > 0 ? [...LOAD_SERIES, UNCOVERED_SERIES] : LOAD_SERIES} />
    </div>
  );
}
