// Barre par CT (Vue d'ensemble, Prévisions portée globale, DECISIONS n° 20) : chaque CT avec enveloppe sur une
// échelle commune en % de sa propre enveloppe. Zone cible [cible_min %, 100 %], repère 100 %, consommé puis
// atterrissage plan, repère de la tendance. Triée du plus à risque au moins. Barres HTML/CSS (pas de recharts).
import type { CSSProperties } from 'react';
import { StatusGlyph, Tooltip } from '../../../ui';
import type { PrevisionCT } from '../../../api/types';
import { fmtEur, fmtPeriod } from '../../../lib/format';
import { ChartLegend, type ChartSeries } from './charts';
import { fmtEurShort, rowGlyph } from './pilotage';
import './pilotage.css';

const LEGEND: ChartSeries[] = [
  { key: 'consomme', label: 'Consommé', token: '--blue' },
  { key: 'plan', label: 'Atterrissage plan', token: '--blue', opacity: 0.3 },
  { key: 'tendance', label: 'Tendance', token: '--text', shape: 'tick' },
  { key: 'zone', label: 'Zone cible', token: '--success', opacity: 0.25 },
  { key: 'over', label: 'Dépassement', token: '--danger', opacity: 0.18 },
];

/** Axe : 0 → 100 %, étendu au plus grand atterrissage jusqu'à 150 % (au-delà : barre coupée d'un chevron). */
const AXIS_CAP = 150;

const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmtPct0 = (v: number) => `${pctFmt.format(v)} %`;

interface Row {
  p: PrevisionCT;
  budget: number;
  /** Consommé, atterrissage plan, tendance et bas de la zone cible, en % de l'enveloppe. */
  consomme: number;
  plan: number;
  tendance: number;
  cible: number;
  /** Rang de tri : 0 dépassement, 1 sous-consommation, 2 vigilance, 3 ok. */
  rank: number;
}

const pctOf = (v: number, budget: number) => (budget > 0 ? (v / budget) * 100 : v > 0.5 ? AXIS_CAP : 0);

function rankOf(p: PrevisionCT): number {
  if (p.statut === 'depassement') return 0;
  if (p.sous_consommation) return 1;
  if (p.statut === 'vigilance') return 2;
  return 3;
}

/** Dépassement (écart plan décroissant), sous-consommation (non consommé décroissant), vigilance, ok (% décroissant). */
function compareRows(a: Row, b: Row): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank === 0) return (b.p.ecart_plan ?? 0) - (a.p.ecart_plan ?? 0);
  if (a.rank === 1) return (b.p.non_consomme ?? 0) - (a.p.non_consomme ?? 0);
  return b.plan - a.plan || a.p.ct.localeCompare(b.p.ct, 'fr', { numeric: true });
}

/** Mots du statut d'une ligne (glyphe jamais seul : forme + mots). */
function statusWords(p: PrevisionCT): string {
  if (p.sous_consommation) return 'Sous-consommation : enveloppe qui risque de ne pas être consommée';
  if (p.statut === 'depassement') return 'Dépassement : atterrissage au-delà de l’enveloppe';
  if (p.statut === 'vigilance') return 'Vigilance : atterrissage proche de l’enveloppe';
  return 'Dans la zone cible';
}

/** Dernière ligne de la bulle : dépassement ou non consommé (plan de charge, DECISIONS n° 21), sinon dans la cible. */
function verdict(p: PrevisionCT): string {
  if ((p.ecart_plan ?? 0) > 0.5) return `+${fmtEur(p.ecart_plan)} de dépassement`;
  if ((p.non_consomme ?? 0) > 0.5) return `${fmtEur(p.non_consomme)} non consommés`;
  return 'Enveloppe consommée dans la zone cible';
}

function RowTooltip({ row }: { row: Row }) {
  const p = row.p;
  const env = p.enveloppe;
  const lines: [string, string][] = [
    ['Enveloppe', fmtEur(row.budget)],
    ['Consommé', fmtEur(p.consomme)],
    ['Atterrissage plan', fmtEur(p.atterrissage_plan)],
    ['Tendance', fmtEur(p.atterrissage_tendance)],
  ];
  return (
    <div>
      <div className="pil-tooltip__title">
        {p.ct}
        {p.ct_libelle ? ` — ${p.ct_libelle}` : ''}
      </div>
      {env && <div className="pil-tooltip__note">Période {fmtPeriod(env.date_debut, env.date_fin)}</div>}
      {lines.map(([label, value]) => (
        <div key={label} className="pil-tooltip__row">
          {label}
          <span className="pil-tooltip__value">{value}</span>
        </div>
      ))}
      <div className="pil-envbars__verdict">{verdict(p)}</div>
    </div>
  );
}

/** Position en % de la piste pour un % d'enveloppe, bornée à l'axe. */
const at = (v: number, max: number) => `${(Math.max(0, Math.min(v, max)) / max) * 100}%`;

export interface EnveloppeBarsProps {
  previsions: PrevisionCT[];
  /** N premières lignes (le parent affiche le lien « Voir les N CT »). */
  limit?: number;
  /** Clic sur une ligne : inspecteur du CT. */
  onSelect?: (ct: string) => void;
}

/** Une ligne par CT avec enveloppe, en % de son enveloppe ; les CT sans enveloppe sont ignorés. */
export function EnveloppeBars({ previsions, limit, onSelect }: EnveloppeBarsProps) {
  const all: Row[] = previsions
    .filter((p): p is PrevisionCT & { budget: number } => p.budget != null)
    .map((p) => ({
      p,
      budget: p.budget,
      consomme: pctOf(p.consomme, p.budget),
      plan: pctOf(p.atterrissage_plan, p.budget),
      tendance: pctOf(p.atterrissage_tendance, p.budget),
      cible: pctOf(p.cible_min ?? p.budget, p.budget),
      rank: rankOf(p),
    }))
    .sort(compareRows);
  if (all.length === 0) return null;
  const rows = limit != null ? all.slice(0, limit) : all;
  // Une enveloppe à 0 € n'a pas de % : elle n'étire pas l'axe (mention à la place de sa barre).
  const peak = Math.max(100, ...rows.filter((r) => r.budget > 0).map((r) => Math.max(r.plan, r.tendance)));
  const max = Math.min(AXIS_CAP, Math.ceil(peak / 10) * 10);
  const ticks = [0, 50, 100, ...(max - 100 >= 20 ? [max] : [])];

  return (
    <div className="pil-envbars">
      <div className="pil-envbars__axis" aria-hidden>
        <span />
        <span className="pil-envbars__scale">
          {ticks.map((t, i) => (
            <span
              key={t}
              className="pil-envbars__tick-label"
              data-edge={i === 0 ? 'start' : i === ticks.length - 1 && t === max ? 'end' : undefined}
              style={{ left: at(t, max) }}
            >
              {fmtPct0(t)}
            </span>
          ))}
        </span>
        <span />
      </div>
      <ul className="pil-envbars__list">
        {rows.map((r) => {
          const p = r.p;
          const glyph = rowGlyph(p.statut, false, p.sous_consommation);
          const clipped = r.plan > max;
          const hasPlan = r.plan - r.consomme > 0.05;
          const consClipped = r.consomme > max;
          const value = `${r.budget > 0 ? fmtPct0(r.plan) : '—'} · ${fmtEurShort(p.atterrissage_plan)} / ${fmtEurShort(r.budget)}`;
          const label = `${p.ct}${p.ct_libelle ? ` ${p.ct_libelle}` : ''} : atterrissage plan ${value}. ${statusWords(p)}.`;
          return (
            <li key={p.ct}>
              <Tooltip label={<RowTooltip row={r} />} placement="top" maxWidth={340}>
                <button
                  type="button"
                  className="pil-envbars__row"
                  data-clickable={onSelect ? '' : undefined}
                  aria-label={label}
                  onClick={onSelect ? () => onSelect(p.ct) : undefined}
                >
                  <span className="pil-envbars__label">
                    <span className="pil-envbars__glyph">
                      {glyph && <StatusGlyph kind={glyph.kind} tone={glyph.tone} size={16} label={statusWords(p)} />}
                    </span>
                    <span className="pil-envbars__code">{p.ct}</span>
                    {p.ct_libelle && <span className="pil-envbars__libelle">{p.ct_libelle}</span>}
                  </span>
                  {r.budget > 0 ? (
                    <span className="pil-envbars__track" aria-hidden>
                      <span className="pil-envbars__over" style={{ left: at(100, max) }} />
                      {r.cible < 100 && (
                        <span className="pil-envbars__zone" style={{ left: at(r.cible, max), width: `calc(${at(100, max)} - ${at(r.cible, max)})` }} />
                      )}
                      <span className="pil-envbars__ref" style={{ left: at(100, max) }} />
                      {r.consomme > 0.05 && (
                        <span
                          className="pil-envbars__consomme"
                          data-end={!hasPlan || consClipped ? '' : undefined}
                          data-clip={consClipped ? '' : undefined}
                          style={{ width: at(r.consomme, max) }}
                        />
                      )}
                      {hasPlan && !consClipped && (
                        <span
                          className="pil-envbars__plan"
                          data-gap={r.consomme > 0.05 ? '' : undefined}
                          data-clip={clipped ? '' : undefined}
                          style={{ '--from': at(r.consomme, max), '--to': at(r.plan, max) } as CSSProperties}
                        />
                      )}
                      <span className="pil-envbars__tendance" style={{ left: at(r.tendance, max) }} />
                    </span>
                  ) : (
                    <span className="pil-envbars__track">
                      <span className="pil-envbars__note">
                        Enveloppe à 0 € : {fmtEurShort(p.consomme)} consommés, atterrissage {fmtEurShort(p.atterrissage_plan)}
                      </span>
                    </span>
                  )}
                  <span className="pil-envbars__value">{value}</span>
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <ChartLegend series={LEGEND} flush />
    </div>
  );
}

export default EnveloppeBars;
