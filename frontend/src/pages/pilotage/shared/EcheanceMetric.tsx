// Chiffre clé « Non consommé au jj/mm » (DECISIONS n° 17) : le budget de l'exercice non consommé à l'échéance est perdu.
// Partagé par la vue d'ensemble et la page Budget.
import { Metric } from '../../../ui';
import { fmtEur } from '../../../lib/format';
import { fmtDayMonth, fmtEurShort, fmtEurSigned, paceText, provisionsNonEngagees, SOUS_CONSO_GLYPH, type Echeance } from './pilotage';

/**
 * Ce qui restera du budget de l'exercice à l'échéance selon la pire projection, orange (et glyphe cercle « ! »)
 * au-delà des seuils de sous-consommation, neutre en deçà. Si les deux projections dépassent le budget de l'exercice :
 * « Dépassement prévu » en rouge, montant minimal.
 * `variant` : « overview » (libellé daté, part de provisions) ou « budget » (libellé « Non consommé prévu », échéance en sous-ligne).
 */
export default function EcheanceMetric({ e, variant = 'overview' }: { e: Echeance; variant?: 'overview' | 'budget' }) {
  const d = fmtDayMonth(e.date);
  if (e.depassement > 0.5)
    return (
      <Metric
        label={`Dépassement prévu au ${d}`}
        value={`+${fmtEur(e.depassement)}`}
        tone="danger"
        glyph={{ kind: 'danger', tone: 'danger' }}
        sub={`au moins, sur ${fmtEurShort(e.budget)} de budget de l’exercice · plan ${fmtEurSigned(e.projPlan - e.budget)}, tendance ${fmtEurSigned(e.projTendance - e.budget)}`}
      />
    );
  const unspent = e.nonConsomme > 0.5;
  const prov = provisionsNonEngagees(e);
  const parts = unspent
    ? [
        variant === 'budget' ? `au ${d}` : null,
        variant === 'overview' && prov > 0.5 ? `dont ${fmtEurShort(prov)} de provisions non engagées` : null,
        paceText(e),
      ]
    : [variant === 'budget' ? `au ${d}` : null, `budget de l’exercice (${fmtEurShort(e.budget)}) consommé selon les projections`];
  return (
    <Metric
      label={variant === 'budget' ? 'Non consommé prévu' : `Non consommé au ${d}`}
      value={fmtEur(e.nonConsomme)}
      tone={e.sousConso ? 'warning' : undefined}
      glyph={e.sousConso ? SOUS_CONSO_GLYPH : undefined}
      sub={parts.filter(Boolean).join(' · ') || `sur ${fmtEurShort(e.budget)} de budget de l’exercice`}
    />
  );
}
