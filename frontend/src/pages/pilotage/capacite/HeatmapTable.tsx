// Carte de chaleur de la page Capacité : une ligne par squad (enfants indentés), une colonne par semaine.
// Échelle divergente autour de 100 % : neutre 85–115 %, violet = sous-utilisé, rouge = sur-utilisé,
// 3 intensités ; glyphe au-delà du dernier seuil pour que la couleur ne porte pas seule le sens.
import type { CSSProperties, KeyboardEvent } from 'react';
import { StatusGlyph, Table, Tooltip } from '../../../ui';
import type { WeekInfo } from '../../../api/types';
import { FLAG_META } from '../../../components/badges';
import { fmtHours, fmtPct, fmtWeek } from '../../../lib/format';
import { shortWeek } from '../anomalies/meta';
import { HEAT_STEPS, heatOf, type CapaciteCell, type CapaciteRow, type Heat } from './model';

const SIDE_LABEL = { sous: 'Sous-utilisé', sur: 'Sur-utilisé' } as const;

/** Zone de l'échelle, en clair (bulle, légende). */
const zoneOf = (h: Heat) => (h.side ? SIDE_LABEL[h.side] : 'Conforme');

/** Glyphe des cellules au-delà du dernier seuil (forme des flags sous- / sur-imputation). */
function OuterGlyph({ side, size = 11 }: { side: 'sous' | 'sur'; size?: number }) {
  return side === 'sur' ? (
    <StatusGlyph kind={FLAG_META.sur_imputation.glyph} tone="sur_imputation" size={size} />
  ) : (
    <StatusGlyph kind={FLAG_META.sous_imputation.glyph} tone="sous_imputation" size={size} />
  );
}

function CellDetail({ c, squad, period }: { c: CapaciteCell; squad: string; period: string }) {
  const h = heatOf(c);
  let use: string;
  if (h.empty) use = 'Ni prévu ni réel';
  else if (h.horsPlan) use = 'Hors plan : aucune heure prévue';
  else use = `Utilisation ${fmtPct(c.utilisation)} · ${zoneOf(h)}`;
  return (
    <>
      <strong>{squad}</strong> · {period}
      <br />
      Prévu {fmtHours(c.prevu)} · Réel {fmtHours(c.reel)}
      {c.horsPlan > 0 && !h.horsPlan && ` (dont ${fmtHours(c.horsPlan)} hors plan)`}
      <br />
      {use}
    </>
  );
}

function HeatCell({ c, squad, period, className }: { c: CapaciteCell; squad: string; period: string; className?: string }) {
  const h = heatOf(c);
  let content;
  if (h.empty) content = <span className="cap-tile__none">—</span>;
  else if (h.horsPlan)
    content = (
      <>
        <StatusGlyph kind={FLAG_META.hors_plan.glyph} tone="hors_plan" size={11} />
        <span className="cap-tile__hp">hors plan</span>
      </>
    );
  else
    content = (
      <>
        {h.side && h.step === 3 && <OuterGlyph side={h.side} />}
        {fmtPct(Math.round(c.utilisation ?? 0))}
      </>
    );
  return (
    <td className={className ? `cap-cell ${className}` : 'cap-cell'}>
      <Tooltip label={<CellDetail c={c} squad={squad} period={period} />} delay={200}>
        <span className="cap-tile" data-side={h.side ?? undefined} data-step={h.step || undefined} data-empty={h.empty || undefined}>
          {content}
        </span>
      </Tooltip>
    </td>
  );
}

/** Entrée ou Espace sur une ligne focalisée : l'ouvre. */
function activate(ev: KeyboardEvent, open: () => void) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  open();
}

interface HeatmapTableProps {
  rows: CapaciteRow[];
  total: CapaciteRow;
  weeks: WeekInfo[];
  /** Libellé de la période (bulles des colonnes de total). */
  period: string;
  onOpen: (squadId: string) => void;
}

export default function HeatmapTable({ rows, total, weeks, period, onOpen }: HeatmapTableProps) {
  // Ligne d'un parent : la suivante est plus profonde.
  const isParent = (i: number) => i + 1 < rows.length && rows[i + 1].depth > rows[i].depth;
  return (
    <Table minWidth={220 + weeks.length * 64 + 3 * 88} className="cap-table" caption="Utilisation de la capacité par squad et par semaine">
      <thead>
        <tr>
          <th className="cap-squad">Squad</th>
          {weeks.map((w) => (
            <th
              key={w.week}
              data-align="center"
              data-locked={w.verrouillee || undefined}
              title={`${fmtWeek(w.week)}${w.verrouillee ? ' · verrouillée' : ''}`}
            >
              {shortWeek(w.week)}
            </th>
          ))}
          <th data-align="right" className="cap-sep">
            Prévu
          </th>
          <th data-align="right">Réel</th>
          <th data-align="center">Utilisation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const id = r.id;
          const open = id ? () => onOpen(id) : undefined;
          return (
            <tr
              key={id ?? '∅'}
              data-clickable={open ? true : undefined}
              tabIndex={open ? 0 : undefined}
              onClick={open}
              onKeyDown={open ? (ev) => activate(ev, open) : undefined}
              aria-label={open ? `Voir les écarts du squad ${r.nom}` : undefined}
            >
              <td
                className="cap-squad"
                data-parent={isParent(i) || undefined}
                data-none={!id || undefined}
                style={{ '--cap-depth': r.depth } as CSSProperties}
              >
                <span className="cap-squad__name">{r.nom}</span>
              </td>
              {r.weeks.map((c, wi) => (
                <HeatCell key={weeks[wi].week} c={c} squad={r.nom} period={fmtWeek(weeks[wi].week)} />
              ))}
              <td data-align="right" className="cap-sep">
                {fmtHours(r.prevu)}
              </td>
              <td data-align="right">{fmtHours(r.reel)}</td>
              <HeatCell c={r} squad={r.nom} period={period} className="cap-cell--total" />
            </tr>
          );
        })}
      </tbody>
      {rows.length > 1 && (
        <tfoot>
          <tr>
            <td className="cap-squad">Total</td>
            {total.weeks.map((c, wi) => (
              <HeatCell key={weeks[wi].week} c={c} squad="Total" period={fmtWeek(weeks[wi].week)} />
            ))}
            <td data-align="right" className="cap-sep">
              {fmtHours(total.prevu)}
            </td>
            <td data-align="right">{fmtHours(total.reel)}</td>
            <HeatCell c={total} squad="Total" period={period} className="cap-cell--total" />
          </tr>
        </tfoot>
      )}
    </Table>
  );
}

// ------------------------------------------------------------------ Légende
const [S1, S2, S3] = HEAT_STEPS;
const SCALE: { side?: 'sous' | 'sur'; step?: 1 | 2 | 3; label: string }[] = [
  { side: 'sous', step: 3, label: `< ${100 - S3} %` },
  { side: 'sous', step: 2, label: `${100 - S3}–${100 - S2}` },
  { side: 'sous', step: 1, label: `${100 - S2}–${100 - S1}` },
  { label: `Conforme ${100 - S1}–${100 + S1} %` },
  { side: 'sur', step: 1, label: `${100 + S1}–${100 + S2}` },
  { side: 'sur', step: 2, label: `${100 + S2}–${100 + S3}` },
  { side: 'sur', step: 3, label: `> ${100 + S3} %` },
];

export function HeatLegend() {
  return (
    <div className="cap-legend">
      <div className="cap-legend__scale" role="img" aria-label={`Échelle : sous-utilisé sous ${100 - S1} %, conforme de ${100 - S1} à ${100 + S1} %, sur-utilisé au-delà ; glyphe sous ${100 - S3} % et au-delà de ${100 + S3} %`}>
        <span className="cap-legend__end">Sous-utilisé</span>
        <ol className="cap-legend__steps" aria-hidden>
          {SCALE.map((s) => (
            <li key={s.label} data-mid={!s.side || undefined}>
              <span className="cap-legend__swatch cap-tile" data-side={s.side} data-step={s.step}>
                {s.side && s.step === 3 && <OuterGlyph side={s.side} size={10} />}
              </span>
              <span className="cap-legend__label">{s.label}</span>
            </li>
          ))}
        </ol>
        <span className="cap-legend__end">Sur-utilisé</span>
      </div>
      <span className="cap-legend__item">
        <StatusGlyph kind={FLAG_META.hors_plan.glyph} tone="hors_plan" size={11} />
        hors plan : réel sans heure prévue
      </span>
    </div>
  );
}
