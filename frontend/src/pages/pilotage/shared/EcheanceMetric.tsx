// Chiffre clé « Non consommé au jj/mm » (DECISIONS n° 17) : le budget de l'exercice non consommé à l'échéance est perdu.
// Partagé par la vue d'ensemble et la page Budget. Avec des enveloppes (n° 19), chaque CT configuré a sa propre
// échéance (fin de son enveloppe) : le périmètre dit alors « à l'échéance » plutôt qu'une date.
import { Metric } from '../../../ui';
import { fmtEur } from '../../../lib/format';
import { echeanceWords, fmtEurShort, fmtEurSigned, paceText, provisionsNonEngagees, SOUS_CONSO_GLYPH, type Echeance } from './pilotage';

/**
 * Ce qui restera du budget de l'exercice à l'échéance selon la pire projection, orange (et glyphe cercle « ! »)
 * au-delà des seuils de sous-consommation, neutre en deçà. Si les deux projections dépassent le budget de l'exercice :
 * « Dépassement prévu » en rouge, montant minimal.
 * `variant` : « overview » (libellé daté, part de provisions) ou « budget » (libellé « Non consommé prévu », échéance en sous-ligne).
 */
export default function EcheanceMetric({ e, variant = 'overview' }: { e: Echeance; variant?: 'overview' | 'budget' }) {
  const w = echeanceWords(e);
  // « d'enveloppe » / « de budget de l'exercice » / « de budget à l'échéance ».
  const ofBudget = e.kind === 'enveloppe' ? 'd’enveloppe' : `de ${w.budget}`;
  if (e.depassement > 0.5)
    return (
      <Metric
        label={`Dépassement prévu ${w.when}`}
        value={`+${fmtEur(e.depassement)}`}
        tone="danger"
        glyph={{ kind: 'danger', tone: 'danger' }}
        sub={`au moins, sur ${fmtEurShort(e.budget)} ${ofBudget} · plan ${fmtEurSigned(e.projPlan - e.budget)}, tendance ${fmtEurSigned(e.projTendance - e.budget)}`}
      />
    );
  const unspent = e.nonConsomme > 0.5;
  const prov = provisionsNonEngagees(e);
  const parts = unspent
    ? [
        variant === 'budget' ? w.when : null,
        variant === 'overview' && e.kind === 'exercice' && prov > 0.5 ? `dont ${fmtEurShort(prov)} de provisions non engagées` : null,
        paceText(e),
      ]
    : [variant === 'budget' ? w.when : null, `${w.budget} (${fmtEurShort(e.budget)}) consommé${w.fem ? 'e' : ''} selon les projections`];
  return (
    <Metric
      label={variant === 'budget' ? 'Non consommé prévu' : `Non consommé ${w.when}`}
      value={fmtEur(e.nonConsomme)}
      tone={e.sousConso ? 'warning' : undefined}
      glyph={e.sousConso ? SOUS_CONSO_GLYPH : undefined}
      sub={parts.filter(Boolean).join(' · ') || `sur ${fmtEurShort(e.budget)} ${ofBudget}`}
    />
  );
}
