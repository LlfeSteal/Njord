// Carte « Plan de charge face aux enveloppes » (page Budget, DECISIONS n° 19) : lecture brute des CT configurés,
// chacun sur sa période. Une phrase de lecture + barres divergentes de l'écart d'atterrissage à l'enveloppe par CT
// (atterrissage − enveloppe) : à droite = au-dessus de l'enveloppe (rouge), à gauche = non consommé (orange au-delà
// des seuils de sous-consommation, gris en deçà). Clic sur une ligne = inspecteur du CT.
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Card, Link } from '../../../ui';
import type { EnveloppesSynthese, PrevisionCT } from '../../../api/types';
import { fmtEur, fmtPeriod } from '../../../lib/format';
import { ChartLegend, type ChartSeries } from '../shared/charts';
import { fmtEurShort, fmtEurShortSigned, useTokenColors } from '../shared/pilotage';

/** Au-delà, on montre les plus gros écarts (en valeur absolue) : le tableau garde tous les CT. */
const MAX_BARS = 16;
const ROW_HEIGHT = 28;
const BAR_SIZE = 14;

type Kind = 'over' | 'under' | 'tolerance';

interface Datum {
  ct: string;
  libelle: string;
  ecart: number;
  kind: Kind;
  p: PrevisionCT;
}

const TOKENS = ['--danger', '--warning', '--gray', '--text', '--text-secondary', '--separator', '--fill', '--card', '--font-mono'] as const;

const SERIES: Record<Kind, ChartSeries> = {
  over: { key: 'over', label: 'Au-dessus de l’enveloppe', token: '--danger' },
  under: { key: 'under', label: 'Sous-consommation (au-delà des seuils)', token: '--warning' },
  tolerance: { key: 'tolerance', label: 'Sous l’enveloppe, dans les seuils', token: '--gray', opacity: 0.6 },
};

/** Sur-imputation (écart > 0) d'abord ; sinon sous-consommation signalée ; sinon écart dans les seuils (gris). */
const kindOf = (p: PrevisionCT): Kind => ((p.ecart_plan ?? 0) > 0.5 ? 'over' : p.sous_consommation ? 'under' : 'tolerance');

/** Chemin d'une barre horizontale, bout de donnée arrondi (4 px), carrée côté zéro. */
function barPath(left: number, top: number, w: number, h: number, roundRight: boolean): string {
  const r = Math.max(0, Math.min(4, w, h / 2));
  if (roundRight)
    return `M${left},${top} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} Z`;
  return `M${left + w},${top} v${h} h${-(w - r)} a${r},${r} 0 0 1 ${-r},${-r} v${-(h - 2 * r)} a${r},${r} 0 0 1 ${r},${-r} Z`;
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Datum;
}

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}

function EcartTooltip({ active, payload }: TooltipProps) {
  const d = active ? (payload?.[0]?.payload as Datum | undefined) : undefined;
  if (!d) return null;
  const p = d.p;
  const env = p.enveloppe;
  const rows: [string, string][] = [
    ['Enveloppe', fmtEur(p.budget)],
    ['Atterrissage plan', fmtEur(p.atterrissage_plan)],
    ['Écart', `${d.ecart > 0.5 ? '+' : d.ecart < -0.5 ? '−' : ''}${fmtEur(Math.abs(d.ecart))}`],
  ];
  if ((p.non_consomme ?? 0) > 0.5) rows.push(['Non consommé (plan de charge)', fmtEur(p.non_consomme)]);
  if ((p.plan_hors_enveloppe ?? 0) > 0.5) rows.push(['Plan hors enveloppe', fmtEur(p.plan_hors_enveloppe)]);
  return (
    <div className="pil-tooltip">
      <div className="pil-tooltip__title">
        {d.ct}
        {d.libelle ? ` — ${d.libelle}` : ''}
      </div>
      {env && <div className="pil-tooltip__note">Période {fmtPeriod(env.date_debut, env.date_fin)}</div>}
      {rows.map(([label, value]) => (
        <div key={label} className="pil-tooltip__row">
          {label}
          <span className="pil-tooltip__value">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** « 3 CT » (invariable). */
const nCt = (n: number) => `${n} CT`;

/** Phrase de lecture : écart net des CT configurés, puis lecture brute (dépassements, non consommés, hors enveloppe). */
function Sentence({ s }: { s: EnveloppesSynthese }) {
  const parts: string[] = [];
  if (s.nb_depassement > 0) parts.push(`${nCt(s.nb_depassement)} au-dessus de leur enveloppe : +${fmtEurShort(s.depassement)}`);
  if (s.nb_sous_consommation > 0)
    parts.push(`${nCt(s.nb_sous_consommation)} en sous-consommation : ${fmtEurShort(s.non_consomme)} non consommés`);
  if (s.plan_hors_enveloppe > 0.5) parts.push(`${fmtEurShort(s.plan_hors_enveloppe)} de plan hors enveloppe`);
  const todo = s.nb_ct - s.nb_configures;
  const one = s.nb_configures === 1;
  const net =
    Math.abs(s.ecart) <= 0.5
      ? `au niveau ${one ? 'de son enveloppe' : 'des enveloppes'}`
      : `${fmtEurShort(Math.abs(s.ecart))} ${s.ecart > 0 ? 'au-dessus' : 'en dessous'} ${one ? 'de son enveloppe' : 'de leurs enveloppes au net'}`;
  return (
    <p className="pil-card-head__sub">
      Atterrissage {one ? 'du CT avec enveloppe' : `des ${nCt(s.nb_configures)} avec enveloppe`} : {fmtEurShort(s.atterrissage)} pour{' '}
      {fmtEurShort(s.montant)} d’enveloppe{one ? '' : 's'}, soit {net}
      {parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
      {todo > 0 && (
        <>
          {' · '}
          <Link to="/enveloppes?filtre=sans_enveloppe" size="sm">
            {nCt(todo)} sans enveloppe
          </Link>
        </>
      )}
      .
    </p>
  );
}

export interface EnveloppesCardProps {
  synthese: EnveloppesSynthese;
  /** Prévisions par CT (seuls les CT configurés sont tracés). */
  parCt: PrevisionCT[];
  onOpen: (ct: string) => void;
}

export default function EnveloppesCard({ synthese, parCt, onOpen }: EnveloppesCardProps) {
  const c = useTokenColors(TOKENS);
  const configured = parCt.filter((p) => p.enveloppe && p.ecart_plan != null);
  const ecartOf = (p: PrevisionCT) => p.ecart_plan ?? 0;
  // Les plus gros écarts en valeur absolue, puis triés par écart (dépassements en haut, non consommés en bas).
  const shown: Datum[] = [...configured]
    .sort((a, b) => Math.abs(ecartOf(b)) - Math.abs(ecartOf(a)))
    .slice(0, MAX_BARS)
    .sort((a, b) => ecartOf(b) - ecartOf(a) || a.ct.localeCompare(b.ct))
    .map((p) => ({ ct: p.ct, libelle: p.ct_libelle, ecart: ecartOf(p), kind: kindOf(p), p }));
  const kinds = (['over', 'under', 'tolerance'] as const).filter((k) => shown.some((d) => d.kind === k));
  const min = Math.min(0, ...shown.map((d) => d.ecart));
  const max = Math.max(0, ...shown.map((d) => d.ecart));
  // Marge pour les montants en bout de barre, des deux côtés du zéro.
  const pad = Math.max(max - min, 1) * 0.22;
  const domain: [number, number] = [min < 0 ? min - pad : 0, max > 0 ? max + pad : 0];
  if (domain[0] === 0 && domain[1] === 0) domain[1] = 1;
  const tick = { fill: c['--text-secondary'], fontSize: 11 };
  const fill: Record<Kind, { color: string; opacity: number }> = {
    over: { color: c['--danger'], opacity: 1 },
    under: { color: c['--warning'], opacity: 1 },
    tolerance: { color: c['--gray'], opacity: 0.6 },
  };

  /** Barre (bout arrondi côté donnée) et montant signé en bout de barre, à l'encre secondaire. */
  const shape = (props: BarShapeProps) => {
    const d = props.payload;
    if (!d) return <g />;
    const x = props.x ?? 0;
    const w = props.width ?? 0;
    const left = Math.min(x, x + w);
    const right = Math.max(x, x + w);
    const top = props.y ?? 0;
    const h = props.height ?? 0;
    const pos = d.ecart >= 0;
    const f = fill[d.kind];
    return (
      <g>
        {right - left > 0.5 && <path d={barPath(left, top, right - left, h, pos)} fill={f.color} fillOpacity={f.opacity} />}
        <text
          x={pos ? right + 6 : left - 6}
          y={top + h / 2}
          dy="0.35em"
          textAnchor={pos ? 'start' : 'end'}
          fill={c['--text-secondary']}
          fontSize={11}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmtEurShortSigned(d.ecart)}
        </text>
      </g>
    );
  };

  /** Repère zéro (atterrissage = enveloppe), étiqueté des deux sens de lecture. */
  const zeroLabel = (p: { viewBox?: { x?: number; y?: number } }) => {
    const x = p.viewBox?.x ?? 0;
    const y = (p.viewBox?.y ?? 0) - 6;
    const halo = { stroke: c['--card'], strokeWidth: 3, paintOrder: 'stroke' as const, fontSize: 11, fill: c['--text-secondary'] };
    return (
      <g>
        {min < 0 && (
          <text x={x - 6} y={y} textAnchor="end" {...halo}>
            ← sous l’enveloppe
          </text>
        )}
        {max > 0 && (
          <text x={x + 6} y={y} textAnchor="start" {...halo}>
            au-dessus →
          </text>
        )}
      </g>
    );
  };

  const truncated = configured.length > shown.length;
  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Plan de charge face aux enveloppes</h2>
        <Link to="/enveloppes" size="sm">
          Enveloppes
        </Link>
      </div>
      <Sentence s={synthese} />
      {shown.length > 0 && (
        <div
          className="pil-env-chart"
          role="img"
          aria-label={`Écart d’atterrissage à l’enveloppe par CT : ${shown.map((d) => `${d.ct} ${fmtEurShortSigned(d.ecart)}`).join(', ')}`}
        >
          <ResponsiveContainer width="100%" height={shown.length * ROW_HEIGHT + 44}>
            <BarChart
              data={shown}
              layout="vertical"
              margin={{ top: 20, right: 12, bottom: 0, left: 0 }}
              barSize={BAR_SIZE}
              onClick={(st) => {
                const ct = st?.activeLabel;
                if (ct != null) onOpen(String(ct));
              }}
            >
              <CartesianGrid horizontal={false} stroke={c['--separator']} />
              <XAxis type="number" domain={domain} axisLine={false} tickLine={false} tick={tick} tickFormatter={(v: number) => fmtEurShort(v)} tickCount={5} />
              <YAxis
                type="category"
                dataKey="ct"
                axisLine={false}
                tickLine={false}
                width={92}
                interval={0}
                tick={{ ...tick, fill: c['--text'], fontFamily: c['--font-mono'] }}
              />
              <RTooltip cursor={{ fill: c['--fill'] }} wrapperStyle={{ outline: 'none' }} isAnimationActive={false} content={<EcartTooltip />} />
              <ReferenceLine x={0} stroke={c['--text-secondary']} strokeWidth={1} label={zeroLabel} />
              <Bar dataKey="ecart" shape={shape} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <ChartLegend series={kinds.map((k) => SERIES[k])} flush />
        </div>
      )}
      {truncated && (
        <p className="pil-note">
          Les {shown.length} plus gros écarts sur {nCt(configured.length)} avec enveloppe ; tous les CT sont dans le tableau.
        </p>
      )}
    </Card>
  );
}
