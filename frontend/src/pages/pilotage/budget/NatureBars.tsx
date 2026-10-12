// Analyse par nature (page Budget) : dépense prévue et réalisé par nature de coût, barres sur une échelle commune —
// piste = prévu (plan de charge, puis provisions restantes en teinte pâle), remplissage = réalisé, au-delà du prévu
// en rouge avec glyphe (DECISIONS n° 10, 16). Le prévu n'est pas un budget (n° 20) : le budget est l'enveloppe.
import type { CSSProperties } from 'react';
import { Card, StatusGlyph, Tooltip } from '../../../ui';
import type { BudgetNature } from '../../../api/types';
import { fmtEur, fmtPct } from '../../../lib/format';
import { ChartLegend, type ChartSeries } from '../shared/charts';
import { fmtEurShort } from '../shared/pilotage';

const pctOf = (v: number, scale: number) => `${scale > 0 ? (Math.max(0, v) / scale) * 100 : 0}%`;

/** Prévu d'une nature = PPS + provisions (repli si le serveur ne renvoie pas encore `prevu`). */
const prevuOf = (n: BudgetNature) => n.prevu ?? n.pps + (n.provisions ?? 0);
const provisionsOf = (n: BudgetNature) => Math.max(0, n.provisions ?? 0);

const LEGEND: ChartSeries[] = [
  { key: 'realise', label: 'Réalisé', token: '--accent' },
  { key: 'pps', label: 'Plan de charge (PPS)', token: '--fill-pressed' },
  { key: 'provisions', label: 'Provisions restantes', token: '--series-provision' },
];

function Detail({ n }: { n: BudgetNature }) {
  const prevu = prevuOf(n);
  const prov = provisionsOf(n);
  const reste = prevu - n.realise;
  return (
    <>
      <strong>{n.libelle}</strong>
      <br />
      {prov > 0 ? `PDC ${fmtEur(n.pps)} + provisions ${fmtEur(prov)} = prévu ${fmtEur(prevu)}` : `Prévu ${fmtEur(prevu)}`}
      <br />
      Réalisé {fmtEur(n.realise)} · {reste < 0 ? `Au-delà du prévu ${fmtEur(-reste)}` : `Reste ${fmtEur(reste)}`}
    </>
  );
}

export default function NatureBars({ rows }: { rows: BudgetNature[] }) {
  const scale = Math.max(0, ...rows.flatMap((n) => [prevuOf(n), n.realise]));
  const prevu = rows.reduce((s, n) => s + prevuOf(n), 0);
  const prov = rows.reduce((s, n) => s + provisionsOf(n), 0);
  const reel = rows.reduce((s, n) => s + n.realise, 0);
  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Analyse par nature</h2>
      </div>
      <p className="pil-card-head__sub">
        Prévu (plan + provisions) {fmtEur(prevu)}
        {prov > 0 && ` (dont ${fmtEurShort(prov)} de provisions)`} · Réalisé {fmtEur(reel)}
        {prevu > 0 && ` · ${fmtPct((reel / prevu) * 100)} du prévu`}
      </p>
      <ul className="pil-nature">
        {rows.map((n) => {
          const b = prevuOf(n);
          const p = provisionsOf(n);
          const over = n.realise > b;
          const pct = n.pct_consomme ?? (b > 0 ? (n.realise / b) * 100 : null);
          const label = `${n.libelle} : réalisé ${fmtEur(n.realise)} sur ${fmtEur(b)} prévus${
            p > 0 ? ` dont ${fmtEur(p)} de provisions` : ''
          }${pct != null ? ` (${fmtPct(pct)})` : ''}${over ? ', au-delà du prévu' : ''}`;
          return (
            <li key={n.nature}>
              <Tooltip label={<Detail n={n} />} placement="top">
                <div className="pil-nature__row" tabIndex={0} aria-label={label}>
                  <span className="pil-nature__label">{n.libelle}</span>
                  <span className="pil-nature__bar" aria-hidden>
                    <span className="pil-nature__track" data-split={p > 0 || undefined} style={{ width: pctOf(b - p, scale) }} />
                    {p > 0 && <span className="pil-nature__prov" data-gap={b - p > 0 || undefined} style={{ left: pctOf(b - p, scale), width: pctOf(p, scale) }} />}
                    <span className="pil-nature__fill" style={{ width: pctOf(Math.min(n.realise, b), scale) }} />
                    {over && (
                      <span
                        className="pil-nature__over"
                        style={{ left: pctOf(b, scale), width: pctOf(n.realise - b, scale) } as CSSProperties}
                      />
                    )}
                  </span>
                  <span className="pil-nature__value">
                    {fmtEurShort(n.realise)} <span className="pil-nature__of">/ {fmtEurShort(b)}</span>
                  </span>
                  <span className="pil-nature__pct" data-tone={over ? 'danger' : undefined}>
                    {over && <StatusGlyph kind="danger" tone="danger" size={12} label="Au-delà du prévu" />}
                    {pct != null ? fmtPct(Math.round(pct)) : '—'}
                  </span>
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {prov > 0 && <ChartLegend series={LEGEND} flush />}
    </Card>
  );
}
