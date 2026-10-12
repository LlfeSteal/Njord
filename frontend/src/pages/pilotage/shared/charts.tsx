// Graphiques partagés des pages Pilotage : trajectoire vers l'enveloppe et Σ enveloppes de la vue d'ensemble
// (DECISIONS n° 20), charge hebdomadaire,
// légende et bulle au look du kit. Couleurs résolues depuis les tokens. La barre par CT est dans EnveloppeBars.tsx.
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
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Couverture, PrevisionCT, PrevisionPoint, Previsions } from '../../../api/types';
import { fmtEur, fmtHours, fmtWeek } from '../../../lib/format';
import { StatusGlyph, type GlyphKind, type StatusTone } from '../../../ui';
import { fmtEurShort, fmtEurSigned, useTokenColors, weekShort } from './pilotage';
import './pilotage.css';

// ------------------------------------------------------------------ Légende et bulle

/** Série affichée : clé de donnée, libellé, token de teinte, forme de la pastille. */
export interface ChartSeries {
  key: string;
  label: string;
  token: string;
  /** Pastille : trait plein, tirets, carré (barres / aires / bandes), hachure (non couvert) ou repère vertical. */
  shape?: 'line' | 'dash' | 'box' | 'hatch' | 'tick';
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
  extra,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  series: ChartSeries[];
  format: (v: number) => string;
  title?: (datum: D) => ReactNode;
  /** Mention sous le titre (ex. semaine non couverte par le plan). */
  note?: (datum: D) => ReactNode;
  /** Lignes ajoutées après les séries, sans pastille (ex. écart à l'enveloppe à la dernière semaine). */
  extra?: (datum: D) => { label: string; value: string }[];
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as D;
  const rows = series
    .map((s) => ({ s, entry: payload.find((p) => p.dataKey === s.key) }))
    .filter(({ entry }) => entry && entry.value != null);
  const mention = note?.(datum);
  const more = extra?.(datum) ?? [];
  if (rows.length === 0 && !mention && more.length === 0) return null;
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
      {more.map((r) => (
        <div key={r.label} className="pil-tooltip__row">
          {r.label}
          <span className="pil-tooltip__value">{r.value}</span>
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

// ------------------------------------------------------------------ Trajectoire vers l'enveloppe (DECISIONS n° 20)
// Une question : l'enveloppe sera-t-elle consommée en entier, sans surconsommation ? Axe = période de l'enveloppe
// (périmètre : union des périodes), zone cible [cible_min, enveloppe], ligne d'enveloppe, éventail plan ↔ tendance,
// réalisé jusqu'à « Aujourd'hui » et point d'arrivée sur la projection plan, glyphé et libellé selon le statut.

const FORECAST_SERIES: ChartSeries[] = [
  { key: 'reel_cumul', label: 'Réalisé', token: '--blue', shape: 'line' },
  { key: 'plan_cumul', label: 'Projection plan', token: '--blue', shape: 'line', opacity: 0.5 },
  { key: 'tendance_cumul', label: 'Tendance', token: '--blue', shape: 'dash' },
];

/** Entrée de légende de la zone cible (pastille plus soutenue que la bande pour rester lisible). */
const TARGET_SERIES: ChartSeries = { key: 'zone', label: 'Zone cible', token: '--success', opacity: 0.25 };

/** Zone de dépassement (au-dessus de l'enveloppe) : fond rouge pâle, pour lire d'un coup d'œil où l'on atterrit. */
const OVER_SERIES: ChartSeries = { key: 'over', label: 'Dépassement', token: '--danger', opacity: 0.18 };

const FORECAST_TOKENS = ['--blue', '--success', '--danger', '--text', '--text-secondary', '--separator', '--card'] as const;

const AXIS = { axisLine: false, tickLine: false } as const;

/** Arrondit au-dessus sur un pas « rond » (1, 2, 2,5, 5 × 10ⁿ) pour 4 intervalles : graduations lisibles. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return Math.ceil(v / step) * step;
}

/** Sous cette hauteur (inspecteur), le graphique est compact : ni légende, ni libellé long. */
const COMPACT_HEIGHT = 240;

const DAY_MS = 86_400_000;

/** Lundi (YYYY-MM-DD) de la semaine ISO d'une date, ou null si illisible. */
function mondayOf(date: string): string | null {
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * DAY_MS).toISOString().slice(0, 10);
}

/** Semaine ISO « YYYY-Www » du lundi `t` (ms UTC). */
function isoWeekOf(t: number): string {
  const thu = new Date(t + 3 * DAY_MS);
  const y = thu.getUTCFullYear();
  const w = Math.ceil(((thu.getTime() - Date.UTC(y, 0, 1)) / DAY_MS + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** Point de la trajectoire : point du backend restreint à la période, éventail [bas, haut] entre les projections. */
interface TrajPoint {
  week: string;
  debut: string;
  couverture?: Couverture;
  reel_cumul: number | null;
  plan_cumul: number | null;
  tendance_cumul: number | null;
  fan: [number, number] | null;
  /** Semaine ajoutée après la fin du plan, jusqu'à la fin de l'enveloppe (projections seules). */
  extension?: boolean;
}

const fanOf = (plan: number | null, tend: number | null): [number, number] | null =>
  plan == null || tend == null ? null : [Math.min(plan, tend), Math.max(plan, tend)];

/**
 * Série de la trajectoire : semaines dont le lundi est dans [semaine de date_debut, semaine de date_fin] pour un CT
 * (toute la série pour le périmètre). Plan arrêté avant la fin de l'enveloppe : semaines prolongées jusqu'à elle,
 * projections menées linéairement jusqu'aux atterrissages du backend.
 */
function trajectoryOf(p: PrevisionCT): TrajPoint[] {
  const env = p.ct !== '' ? p.enveloppe : null;
  const from = env ? mondayOf(env.date_debut) : null;
  const to = env ? mondayOf(env.date_fin) : null;
  const pts: TrajPoint[] = (p.series ?? [])
    .filter((s) => !from || !to || (s.debut.slice(0, 10) >= from && s.debut.slice(0, 10) <= to))
    .map((s) => ({
      week: s.week,
      debut: s.debut,
      couverture: s.couverture,
      reel_cumul: s.reel_cumul,
      plan_cumul: s.plan_cumul,
      tendance_cumul: s.tendance_cumul,
      fan: fanOf(s.plan_cumul, s.tendance_cumul),
    }));
  const last = pts[pts.length - 1];
  if (!to || !last) return pts;
  const end = Date.parse(`${to}T00:00:00Z`);
  const lastStart = Date.parse(`${last.debut.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(lastStart) || end <= lastStart) return pts;
  const k = Math.min(Math.round((end - lastStart) / (7 * DAY_MS)), 60);
  const lerp = (a: number | null, b: number, i: number) => (a == null ? null : a + ((b - a) * i) / k);
  const startPlan = last.plan_cumul ?? last.reel_cumul;
  const startTend = last.tendance_cumul ?? last.reel_cumul;
  for (let i = 1; i <= k; i++) {
    const t = lastStart + i * 7 * DAY_MS;
    const plan = lerp(startPlan, p.atterrissage_plan, i);
    const tend = lerp(startTend, p.atterrissage_tendance, i);
    pts.push({
      week: isoWeekOf(t),
      debut: new Date(t).toISOString().slice(0, 10),
      reel_cumul: null,
      plan_cumul: plan,
      tendance_cumul: tend,
      fan: fanOf(plan, tend),
      extension: true,
    });
  }
  return pts;
}

/** Statut du point d'arrivée : au-dessus de l'enveloppe, sous la zone cible, vigilance (dans la zone) ou dans la cible. */
type LandingKind = 'over' | 'under' | 'vigilance' | 'in';

const LANDING_GLYPH: Record<LandingKind, { kind: GlyphKind; tone: StatusTone }> = {
  over: { kind: 'danger', tone: 'danger' },
  under: { kind: 'attention', tone: 'attention' },
  vigilance: { kind: 'warning', tone: 'warning' },
  in: { kind: 'success', tone: 'success' },
};

/** Taille du glyphe du point d'arrivée (px) et rayon de son anneau couleur carte (2 px autour). */
const LANDING_SIZE = 14;

interface DotShapeProps {
  cx?: number;
  cy?: number;
}

interface AreaLabelProps {
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

export interface ForecastChartProps {
  /** Prévision d'un CT avec enveloppe, ou du périmètre des enveloppes (`ct` = ''). Sans budget : rien n'est rendu. */
  prevision: PrevisionCT;
  /** Semaine de l'arrêté des données (repère « Aujourd'hui »). */
  asOfWeek: string;
  height?: number;
  /** Légende HTML sous le graphique (défaut : sauf en format compact). */
  legend?: boolean;
}

/** Trajectoire cumulée vers l'enveloppe : zone cible, enveloppe, réalisé, éventail plan ↔ tendance, point d'arrivée. */
export function ForecastChart({ prevision, asOfWeek, height = 260, legend }: ForecastChartProps) {
  const c = useTokenColors(FORECAST_TOKENS);
  const budget = prevision.budget;
  const series = budget == null ? [] : trajectoryOf(prevision);
  if (budget == null || series.length === 0) return null;

  const compact = height < COMPACT_HEIGHT;
  const showLegend = legend ?? !compact;
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const hasToday = series.some((p) => p.week === asOfWeek);
  const cibleMin = prevision.cible_min;
  const hasZone = cibleMin != null && budget - cibleMin > 0.5;

  // Point d'arrivée, à la dernière semaine : même lecture que le statut, le tableau et la phrase. Dépassement :
  // atterrissage plan au-dessus de l'enveloppe ; sous-consommation (au-delà des seuils) : le point est sur la
  // projection retenue (la plus basse), à « enveloppe − non consommé » ; sinon atterrissage plan, dans la cible.
  const last = series[series.length - 1];
  const ecart = prevision.ecart_plan ?? prevision.atterrissage_plan - budget;
  const nonConso = prevision.non_consomme ?? 0;
  const kind: LandingKind =
    prevision.statut === 'depassement'
      ? 'over'
      : prevision.sous_consommation
        ? 'under'
        : prevision.statut === 'vigilance'
          ? 'vigilance'
          : 'in';
  const landing = kind === 'under' ? budget - nonConso : prevision.atterrissage_plan;
  const source = prevision.non_consomme_source === 'tendance' ? ' (tendance)' : '';
  const landingText = compact
    ? kind === 'over'
      ? `+${fmtEurShort(ecart)}`
      : kind === 'under'
        ? `−${fmtEurShort(nonConso)}`
        : fmtEurShort(landing)
    : kind === 'over'
      ? `+${fmtEurShort(ecart)} de dépassement`
      : kind === 'under'
        ? `${fmtEurShort(nonConso)} non consommés${source}`
        : kind === 'vigilance'
          ? `${fmtEurShort(landing)} · dans la cible, vigilance`
          : `${fmtEurShort(landing)} · dans la cible`;
  const landingWords =
    kind === 'over'
      ? 'Au-dessus de l’enveloppe'
      : kind === 'under'
        ? 'Sous la zone cible'
        : kind === 'vigilance'
          ? 'Vigilance'
          : 'Dans la zone cible';

  // Échelle Y explicite : 0 → plafond rond de max(enveloppe, projections, données).
  let dataMax = Math.max(budget, landing, prevision.atterrissage_tendance);
  for (const p of series) dataMax = Math.max(dataMax, p.reel_cumul ?? 0, p.plan_cumul ?? 0, p.tendance_cumul ?? 0);
  const yMax = niceCeil(dataMax);
  const halo = { stroke: c['--card'], strokeWidth: 3, paintOrder: 'stroke' } as const;

  /** « Zone cible » dans la bande (en haut à gauche), sous elle si la bande est trop fine pour le texte. */
  const zoneLabel = (p: AreaLabelProps) => {
    const vb = p.viewBox ?? {};
    const x = (vb.x ?? 0) + 6;
    const top = vb.y ?? 0;
    const h = vb.height ?? 0;
    const y = h >= 16 ? top + 13 : top + h + 13;
    return (
      <text x={x} y={y} fill={c['--text-secondary']} fontSize={11} {...halo}>
        Zone cible
      </text>
    );
  };

  /** Point d'arrivée : glyphe de statut sur anneau carte, libellé direct à l'encre (au-dessus, à gauche du point). */
  const landingShape = (p: DotShapeProps) => {
    const cx = p.cx ?? 0;
    const cy = p.cy ?? 0;
    const g = LANDING_GLYPH[kind];
    const below = cy < 34;
    return (
      <g>
        <circle cx={cx} cy={cy} r={LANDING_SIZE / 2 + 2} fill={c['--card']} />
        <g transform={`translate(${cx - LANDING_SIZE / 2},${cy - LANDING_SIZE / 2})`}>
          <StatusGlyph kind={g.kind} tone={g.tone} size={LANDING_SIZE} label={landingWords} />
        </g>
        <text
          x={cx - LANDING_SIZE / 2 - 6}
          y={below ? cy + LANDING_SIZE + 6 : cy - LANDING_SIZE / 2 - 4}
          textAnchor="end"
          fill={c['--text']}
          fontSize={12}
          fontWeight={600}
          {...halo}
        >
          {landingText}
        </text>
      </g>
    );
  };

  const tooltipNote = (d: TrajPoint) => (d.extension ? 'Après la fin du plan : projections seules' : couvertureNote(d.couverture));
  const tooltipExtra = (d: TrajPoint) => (d.week === last.week ? [{ label: 'Écart à l’enveloppe', value: fmtEurSigned(ecart) }] : []);
  const legendSeries = [...FORECAST_SERIES, ...(hasZone ? [TARGET_SERIES] : []), OVER_SERIES];
  // « Aujourd'hui » sur la dernière semaine (enveloppe terminée) : marge pour que son libellé centré ne soit pas coupé.
  const todayAtEnd = hasToday && last.week === asOfWeek;
  const lineProps = { type: 'monotone' as const, dot: false, connectNulls: false, isAnimationActive: false };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={series} margin={{ top: 20, right: todayAtEnd && !compact ? 36 : 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          <ReferenceArea y1={budget} y2={yMax} fill={c['--danger']} fillOpacity={0.06} ifOverflow="hidden" />
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} domain={[0, yMax]} tickCount={5} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} />
          <RTooltip
            cursor={{ stroke: c['--separator'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={
              <ChartTooltip<TrajPoint>
                series={FORECAST_SERIES}
                format={(v) => fmtEur(v)}
                title={(d) => fmtWeek(d.week)}
                note={tooltipNote}
                extra={tooltipExtra}
              />
            }
          />
          {hasZone && (
            <ReferenceArea y1={cibleMin} y2={budget} fill={c['--success']} fillOpacity={0.12} ifOverflow="extendDomain" label={zoneLabel} />
          )}
          <ReferenceLine
            y={budget}
            stroke={c['--text-secondary']}
            strokeDasharray="2 3"
            strokeWidth={1.5}
            ifOverflow="extendDomain"
            label={{ value: `Enveloppe ${fmtEurShort(budget)}`, position: 'insideBottomLeft', fill: c['--text-secondary'], fontSize: 11 }}
          />
          {hasToday && (
            <ReferenceLine
              x={asOfWeek}
              stroke={c['--text-secondary']}
              strokeWidth={1}
              label={compact ? undefined : { value: 'Aujourd’hui', position: 'top', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          <Area dataKey="fan" type="monotone" stroke="none" fill={c['--blue']} fillOpacity={0.15} activeDot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="plan_cumul" {...lineProps} stroke={c['--blue']} strokeOpacity={0.5} strokeWidth={2} activeDot={{ r: 3 }} />
          <Line dataKey="tendance_cumul" {...lineProps} stroke={c['--blue']} strokeDasharray="4 3" strokeWidth={1.5} activeDot={{ r: 3 }} />
          <Line dataKey="reel_cumul" {...lineProps} stroke={c['--blue']} strokeWidth={2} activeDot={{ r: 3 }} />
          <ReferenceDot x={last.week} y={landing} r={4} ifOverflow="extendDomain" shape={landingShape} />
        </ComposedChart>
      </ResponsiveContainer>
      {showLegend && <ChartLegend series={legendSeries} />}
    </div>
  );
}

// ------------------------------------------------------------------ Vue d'ensemble : Σ enveloppes (DECISIONS n° 20)
// Σ des enveloppes actives chaque semaine (lissée), face à la consommation cumulée du périmètre des enveloppes :
// réalisé jusqu'à « Aujourd'hui », puis projection du plan de charge en pointillé.

const OVERVIEW_SERIES: ChartSeries[] = [
  { key: 'env', label: 'Σ enveloppes actives', token: '--text-secondary', shape: 'line' },
  { key: 'reel_cumul', label: 'Réalisé', token: '--blue', shape: 'line' },
  { key: 'plan_cumul', label: 'Plan de charge (projection)', token: '--blue', shape: 'dash' },
];

const OVERVIEW_TOKENS = ['--blue', '--success', '--text-secondary', '--separator'] as const;

/** Lissage gaussien (σ en semaines, fenêtre ±3σ) : adoucit les marches à l'ouverture / fermeture d'une enveloppe. */
function smooth(values: number[], sigma = 2): number[] {
  const r = Math.ceil(3 * sigma);
  const w = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const top = Math.max(0, ...values);
  return values.map((_, i) => {
    let num = 0;
    let den = 0;
    for (let k = -r; k <= r; k++) {
      const v = values[i + k];
      if (v == null) continue;
      num += v * w[k + r];
      den += w[k + r];
    }
    return den > 0 ? Math.min(top, Math.max(0, num / den)) : 0;
  });
}

interface OverviewPoint {
  week: string;
  /** Σ brute des enveloppes actives (bulle) et sa version lissée (tracé). */
  envRaw: number;
  env: number;
  reel_cumul: number | null;
  plan_cumul: number | null;
}

/** Vue d'ensemble : Σ enveloppes actives (lissée) face au réalisé cumulé, puis au plan de charge projeté. */
export function EnveloppesOverviewChart({ previsions, height = 280 }: { previsions: Previsions; height?: number }) {
  const c = useTokenColors(OVERVIEW_TOKENS);
  const envs = previsions.par_ct.flatMap((p) => (p.enveloppe ? [p.enveloppe] : []));
  const series = previsions.global.series ?? [];
  if (envs.length === 0 || series.length === 0) return null;

  // Semaine [lundi, dimanche] : une enveloppe est active si sa période la chevauche.
  const raw = series.map((s) => {
    const mon = s.debut.slice(0, 10);
    const sun = new Date(Date.parse(`${mon}T00:00:00Z`) + 6 * DAY_MS).toISOString().slice(0, 10);
    return envs.reduce((sum, e) => (e.date_debut <= sun && e.date_fin >= mon ? sum + e.montant : sum), 0);
  });
  const lisse = smooth(raw);
  const data: OverviewPoint[] = series.map((s, i) => ({
    week: s.week,
    envRaw: raw[i],
    env: lisse[i],
    reel_cumul: s.reel_cumul,
    plan_cumul: s.plan_cumul,
  }));
  const peak = Math.max(...raw);
  let dataMax = peak;
  for (const d of data) dataMax = Math.max(dataMax, d.reel_cumul ?? 0, d.plan_cumul ?? 0);
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const hasToday = data.some((d) => d.week === previsions.as_of_week);
  const lineProps = { type: 'monotone' as const, dot: false, connectNulls: false, isAnimationActive: false };
  const peakIdx = raw.indexOf(peak);
  const peakLabel = (p: { x?: number; y?: number; index?: number }) =>
    p.index === peakIdx ? (
      <text x={(p.x ?? 0) + 6} y={(p.y ?? 0) - 8} fill={c['--text-secondary']} fontSize={11}>
        Σ enveloppes {fmtEurShort(peak)}
      </text>
    ) : (
      <g />
    );

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c['--separator']} />
          <XAxis dataKey="week" {...AXIS} tick={tick} tickFormatter={weekShort} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...AXIS} width={56} domain={[0, niceCeil(dataMax)]} tickCount={5} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} />
          <RTooltip
            cursor={{ stroke: c['--separator'] }}
            wrapperStyle={{ outline: 'none' }}
            isAnimationActive={false}
            content={
              <ChartTooltip<OverviewPoint>
                series={OVERVIEW_SERIES.filter((s) => s.key !== 'env')}
                format={(v) => fmtEur(v)}
                title={(d) => fmtWeek(d.week)}
                extra={(d) => [{ label: 'Σ enveloppes actives', value: fmtEur(d.envRaw) }]}
              />
            }
          />
          <Area
            dataKey="env"
            type="monotone"
            stroke={c['--text-secondary']}
            strokeWidth={2}
            fill={c['--success']}
            fillOpacity={0.1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            label={peakLabel}
          />
          {hasToday && (
            <ReferenceLine
              x={previsions.as_of_week}
              stroke={c['--text-secondary']}
              strokeWidth={1}
              label={{ value: 'Aujourd’hui', position: 'top', fill: c['--text-secondary'], fontSize: 11 }}
            />
          )}
          <Line dataKey="plan_cumul" {...lineProps} stroke={c['--blue']} strokeDasharray="4 3" strokeWidth={2} activeDot={{ r: 3 }} />
          <Line dataKey="reel_cumul" {...lineProps} stroke={c['--blue']} strokeWidth={2} activeDot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend series={OVERVIEW_SERIES} />
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
