// Analyse budgétaire (page Budget) : PPS du plan et réalisé par nature de coût, barres sur une échelle
// commune — piste = PPS, remplissage = réalisé, dépassement en rouge avec glyphe (DECISIONS n° 10).
import type { CSSProperties } from 'react';
import { Card, StatusGlyph, Tooltip } from '../../../ui';
import type { BudgetNature } from '../../../api/types';
import { fmtEur, fmtPct } from '../../../lib/format';
import { fmtEurShort } from '../shared/pilotage';

const pctOf = (v: number, scale: number) => `${scale > 0 ? (Math.max(0, v) / scale) * 100 : 0}%`;

function Detail({ n }: { n: BudgetNature }) {
  const reste = n.pps - n.realise;
  return (
    <>
      <strong>{n.libelle}</strong>
      <br />
      PPS {fmtEur(n.pps)} · Réalisé {fmtEur(n.realise)}
      <br />
      {reste < 0 ? `Dépassement ${fmtEur(-reste)}` : `Reste ${fmtEur(reste)}`}
    </>
  );
}

export default function NatureBars({ rows }: { rows: BudgetNature[] }) {
  const scale = Math.max(0, ...rows.flatMap((n) => [n.pps, n.realise]));
  const pps = rows.reduce((s, n) => s + n.pps, 0);
  const reel = rows.reduce((s, n) => s + n.realise, 0);
  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Analyse budgétaire</h2>
      </div>
      <p className="pil-card-head__sub">
        PPS {fmtEur(pps)} · Réalisé {fmtEur(reel)}
        {pps > 0 && ` · ${fmtPct((reel / pps) * 100)} consommé`}
      </p>
      <ul className="pil-nature">
        {rows.map((n) => {
          const over = n.realise > n.pps;
          const label = `${n.libelle} : réalisé ${fmtEur(n.realise)} sur ${fmtEur(n.pps)} de PPS${
            n.pct_consomme != null ? ` (${fmtPct(n.pct_consomme)})` : ''
          }${over ? ', dépassement' : ''}`;
          return (
            <li key={n.nature}>
              <Tooltip label={<Detail n={n} />} placement="top">
                <div className="pil-nature__row" tabIndex={0} aria-label={label}>
                  <span className="pil-nature__label">{n.libelle}</span>
                  <span className="pil-nature__bar" aria-hidden>
                    <span className="pil-nature__track" style={{ width: pctOf(n.pps, scale) }} />
                    <span className="pil-nature__fill" style={{ width: pctOf(Math.min(n.realise, n.pps), scale) }} />
                    {over && (
                      <span
                        className="pil-nature__over"
                        style={{ left: pctOf(n.pps, scale), width: pctOf(n.realise - n.pps, scale) } as CSSProperties}
                      />
                    )}
                  </span>
                  <span className="pil-nature__value">
                    {fmtEurShort(n.realise)} <span className="pil-nature__of">/ {fmtEurShort(n.pps)}</span>
                  </span>
                  <span className="pil-nature__pct" data-tone={over ? 'danger' : undefined}>
                    {over && <StatusGlyph kind="danger" tone="danger" size={12} label="Dépassement" />}
                    {n.pct_consomme != null ? fmtPct(Math.round(n.pct_consomme)) : '—'}
                  </span>
                </div>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
