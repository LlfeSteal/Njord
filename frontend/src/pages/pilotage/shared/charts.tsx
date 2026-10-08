// Graphiques partagés des pages Pilotage : trajectoire cumulée (réalisé, projections, plan prévu, budget max,
// fin d'exercice), charge hebdomadaire, légende et bulle au look du kit. Couleurs résolues depuis les tokens.
// Semaines non couvertes par le plan de charge (DECISIONS n° 13) : hachure neutre + entrée de légende.
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
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
import { extendToEcheance, fmtDayMonth, fmtEurShort, useTokenColors, weekOfDate, weekShort, type Echeance, type ForecastPoint } from './pilotage';
import './pilotage.css';

// ------------------------------------------------------------------ Légende et bulle

/** Série affichée : clé de donnée, libellé, token de teinte, forme de la pastille. */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
  /** Pastille : trait plein, tirets, carré (barres / aires / bandes) ou hachure (non couvert). */
  shape?: 'line' | 'dash' | 'box' | 'hatch';
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
// Version épurée (2026-10-08) : 4 courbes au plus (réalisé, projection plan, tendance, plan de charge prévu),
// une ligne de budget en escalier (budget de l'exercice jusqu'à la fin d'exercice, puis budget max = charge max,
// DECISIONS n° 16-17) et, à la fin d'exercice, un crochet « X k€ non consommés » appuyé sur cette ligne. Les repères sont étiquetés dans le tracé ; la légende ne nomme que les courbes.

const FORECAST_SERIES: ChartSeries[] = [
  { key: 'reel_cumul', label: 'Réalisé', token: '--blue', shape: 'line' },
  { key: 'plan_cumul', label: 'Projection plan', token: '--blue', shape: 'line', opacity: 0.5 },
  { key: 'tendance_cumul', label: 'Tendance', token: '--orange', shape: 'dash' },
  { key: 'budget_cumul', label: 'Plan de charge prévu', token: '--text-tertiary', shape: 'dash' },
];

const FORECAST_TOKENS = ['--blue', '--orange', '--text', '--text-tertiary', '--text-secondary', '--separator', '--card', '--risk-unspent', '--danger'] as const;

interface SegmentShapeProps {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

const AXIS = { axisLine: false, tickLine: false } as const;

/** Arrondit au-dessus sur un pas « rond » (1, 2, 2,5, 5 × 10ⁿ) pour 4 intervalles : graduations lisibles. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return Math.ceil(v / step) * step;
}

/** Sous cette hauteur (inspecteur), le graphique est compact : ni légende, ni hachure, ni libellé long. */
const COMPACT_HEIGHT = 240;

interface LabelViewBox {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

export interface ForecastChartProps {
  series: PrevisionPoint[];
  /** Semaine de l'arrêté des données (repère « Aujourd'hui »). */
  asOfWeek: string;
  /** Budget max = charge max (Σ PPS + provisions) : seule ligne horizontale. */
  budget: number;
  height?: number;
  /** Légende HTML sous le graphique (défaut : sauf en format compact). */
  legend?: boolean;
  /**
   * Fin d'exercice (`echeanceOf(prevision)`) : repère vertical et crochet entre la pire projection et le budget
   * de l'exercice (« X k€ non consommés », ou dépassement en rouge). Sans effet hors de l'horizon de la série.
   */
  echeance?: Echeance | null;
}

/** Courbes cumulées en € : réalisé, projections plan et tendance, plan de charge prévu, budget max et fin d'exercice. */
export function ForecastChart({ series: points, asOfWeek, budget, height = 260, legend, echeance }: ForecastChartProps) {
  // Plan arrêté avant la fin d'exercice : semaines prolongées jusqu'à l'échéance (projections seules).
  const series = extendToEcheance(points, echeance);
  const c = useTokenColors(FORECAST_TOKENS);
  const hatch = useTokenColors(HATCH_TOKENS);
  const patternId = usePatternId();
  const compact = height < COMPACT_HEIGHT;
  const showLegend = legend ?? !compact;
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const hasToday = series.some((p) => p.week === asOfWeek);
  const runs = compact ? [] : uncoveredRuns(series, 'point');

  // Fin d'exercice : semaine de l'échéance, position relative (placement des libellés) et écart à mesurer.
  const n = series.length;
  const eWeek = echeance ? weekOfDate(series, echeance.date) : null;
  const eIdx = eWeek ? series.findIndex((p) => p.week === eWeek) : -1;
  const asIdx = series.findIndex((p) => p.week === asOfWeek);
  const eFrac = n > 1 && eIdx >= 0 ? eIdx / (n - 1) : 0;
  const gap =
    echeance && eWeek
      ? echeance.nonConsomme > 0.5
        ? { kind: 'unspent' as const, low: echeance.worst, high: echeance.budget, amount: echeance.nonConsomme }
        : echeance.depassement > 0.5
          ? { kind: 'over' as const, low: echeance.budget, high: echeance.budget + echeance.depassement, amount: echeance.depassement }
          : null
      : null;
  const eDate = echeance ? fmtDayMonth(echeance.date) : '';
  // Budget en escalier : budget de l'exercice jusqu'à la fin d'exercice, budget max ensuite. Le crochet s'appuie
  // ainsi sur la ligne tracée ; une seule ligne si l'échéance est hors horizon ou si les deux budgets sont égaux.
  const first = series[0]?.week;
  const last = series[n - 1]?.week;
  const step =
    echeance && eWeek && first && last && eWeek !== last && echeance.budget > 0 && Math.abs(echeance.budget - budget) > 0.5
      ? { year: echeance.date.slice(0, 4), exercice: echeance.budget }
      : null;
  const budgetLine = { stroke: c['--text-secondary'], strokeDasharray: '2 3', strokeWidth: 1.5, ifOverflow: 'extendDomain' as const };
  // Échelle Y explicite : les segments de référence n'étendent pas le domaine (recharts), budgets et crochet compris.
  const yMax = Math.max(budget, step?.exercice ?? 0, gap?.high ?? 0);
  const yDomain: [number, (dataMax: number) => number] = [0, (dataMax: number) => niceCeil(Math.max(dataMax, yMax))];
  const budgetLabel = (value: string, position: 'insideBottomLeft' | 'insideBottomRight') => ({
    value,
    position,
    fill: c['--text-secondary'],
    fontSize: 11,
  });

  /** Libellé « Fin d'exercice » : à droite du trait (à gauche près du bord droit), abaissé s'il touche « Aujourd'hui ». */
  const echeanceLabel = (p: LabelViewBox) => {
    const vb = p.viewBox ?? {};
    const x = vb.x ?? 0;
    const y = vb.y ?? 0;
    const anchorEnd = eFrac > 0.75;
    const sameSide = asIdx >= 0 && ((anchorEnd && asIdx < eIdx) || (!anchorEnd && asIdx > eIdx));
    const dist = n > 1 && asIdx >= 0 ? Math.abs(eIdx - asIdx) / (n - 1) : 1;
    const close = !compact && hasToday && dist < (sameSide ? 0.25 : 0.12);
    return (
      <text
        x={anchorEnd ? x - 4 : x + 4}
        y={close ? y + 12 : y - 6}
        textAnchor={anchorEnd ? 'end' : 'start'}
        fill={c['--text-secondary']}
        stroke={c['--card']}
        strokeWidth={3}
        paintOrder="stroke"
        fontSize={11}
      >
        {compact ? eDate : `Fin d’exercice ${eDate}`}
      </text>
    );
  };

  /** Crochet de mesure à l'échéance : trait entre la pire projection et le budget de l'exercice, embouts, montant. */
  const gapShape = (p: SegmentShapeProps) => {
    if (!gap) return <g />;
    const x = p.x1 ?? 0;
    const top = Math.min(p.y1 ?? 0, p.y2 ?? 0);
    const bot = Math.max(p.y1 ?? 0, p.y2 ?? 0);
    const color = gap.kind === 'unspent' ? c['--risk-unspent'] : c['--danger'];
    const left = eFrac > 0.3;
    const tx = left ? x - 9 : x + 9;
    const mid = (top + bot) / 2;
    const halo = { stroke: c['--card'], strokeWidth: 3, paintOrder: 'stroke' } as const;
    return (
      <g>
        <line x1={x} x2={x} y1={top} y2={bot} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <line x1={x - 5} x2={x + 5} y1={top} y2={top} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <line x1={x - 5} x2={x + 5} y1={bot} y2={bot} stroke={color} strokeWidth={2} strokeLinecap="round" />
        {!compact && (
          <text x={tx} y={mid} dy="0.35em" textAnchor={left ? 'end' : 'start'} fill={c['--text']} fontSize={12} fontWeight={600} {...halo}>
            {gap.kind === 'unspent' ? `${fmtEurShort(gap.amount)} non consommés` : `+${fmtEurShort(gap.amount)} de dépassement`}
          </text>
        )}
      </g>
    );
  };

  /** Mention de bulle : fin d'exercice (montant et budget de l'exercice) puis couverture par le plan. */
  const tooltipNote = (d: ForecastPoint) => {
    const cov = d.extension ? 'Après la fin du plan : projections seules' : couvertureNote(d.couverture);
    if (!echeance || d.week !== eWeek) return cov;
    const what = gap
      ? gap.kind === 'unspent'
        ? `${fmtEur(gap.amount)} non consommés`
        : `+${fmtEur(gap.amount)} de dépassement`
      : 'budget entièrement consommé';
    const e = `Fin d’exercice ${eDate} : ${what} (budget de l’exercice ${fmtEur(echeance.budget)})`;
    return cov ? `${e} · ${cov}` : e;
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          {hatchDefs(patternId, hatch['--gray'])}
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          {uncoveredAreas(runs, patternId)}
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} domain={yDomain} tickCount={5} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} />
          <RTooltip
            cursor={{ stroke: c['--separator'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={
              <ChartTooltip<ForecastPoint> series={FORECAST_SERIES} format={(v) => fmtEur(v)} title={(d) => fmtWeek(d.week)} note={tooltipNote} />
            }
          />
          {step ? (
            <>
              <ReferenceLine
                {...budgetLine}
                segment={[
                  { x: first, y: step.exercice },
                  { x: eWeek!, y: step.exercice },
                ]}
                label={budgetLabel(`${compact ? '' : `Budget ${step.year} `}${fmtEurShort(step.exercice)}`, 'insideBottomLeft')}
              />
              <ReferenceLine
                {...budgetLine}
                segment={[
                  { x: eWeek!, y: budget },
                  { x: last, y: budget },
                ]}
                label={budgetLabel(`${compact ? '' : 'Budget max '}${fmtEurShort(budget)}`, 'insideBottomRight')}
              />
            </>
          ) : (
            budget > 0 && (
              <ReferenceLine {...budgetLine} y={budget} label={budgetLabel(`${compact ? 'Budget' : 'Budget max'} ${fmtEurShort(budget)}`, 'insideBottomLeft')} />
            )
          )}
          {hasToday && (
            <ReferenceLine
              x={asOfWeek}
              stroke={c['--text-secondary']}
              strokeWidth={1}
              label={compact ? undefined : { value: 'Aujourd’hui', position: 'top', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          {eWeek && <ReferenceLine x={eWeek} stroke={c['--text-tertiary']} strokeDasharray="3 3" strokeWidth={1} label={echeanceLabel} />}
          <Line dataKey="budget_cumul" type="monotone" stroke={c['--text-tertiary']} strokeDasharray="4 4" strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="plan_cumul" type="monotone" stroke={c['--blue']} strokeOpacity={0.5} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="tendance_cumul" type="monotone" stroke={c['--orange']} strokeDasharray="4 3" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="reel_cumul" type="monotone" stroke={c['--blue']} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          {gap && eWeek && (
            <ReferenceLine
              isFront
              ifOverflow="extendDomain"
              segment={[
                { x: eWeek, y: gap.low },
                { x: eWeek, y: gap.high },
              ]}
              shape={gapShape}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {showLegend && <ChartLegend series={runs.length > 0 ? [...FORECAST_SERIES, UNCOVERED_SERIES] : FORECAST_SERIES} />}
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
