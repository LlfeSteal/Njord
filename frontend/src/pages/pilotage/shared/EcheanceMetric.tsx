// Chiffre clé « Non consommé prévu » (DECISIONS n° 17, 20, 21) : l'enveloppe non consommée à sa fin est perdue.
// Page Budget, sur le périmètre des CT avec enveloppe (chacun à sa propre échéance, montants sommés CT par CT).
import { Metric } from '../../../ui';
import { fmtEur } from '../../../lib/format';
import { echeanceWords, fmtEurShort, fmtEurSigned, paceText, SOUS_CONSO_GLYPH, type Echeance } from './pilotage';

/**
 * Ce qui restera de l'enveloppe à l'échéance selon le plan de charge (DECISIONS n° 21), orange (et glyphe cercle « ! »)
 * au-delà des seuils de sous-consommation, neutre en deçà. Si l'atterrissage plan dépasse l'enveloppe : « Dépassement
 * prévu » en rouge. La tendance n'est citée qu'en repère.
 */
export default function EcheanceMetric({ e }: { e: Echeance }) {
  const w = echeanceWords(e);
  const ofBudget = e.kind === 'enveloppe' ? 'd’enveloppe' : 'd’enveloppes';
  if (e.depassement > 0.5)
    return (
      <Metric
        label="Dépassement prévu"
        value={`+${fmtEur(e.depassement)}`}
        tone="danger"
        glyph={{ kind: 'danger', tone: 'danger' }}
        sub={`sur ${fmtEurShort(e.budget)} ${ofBudget} · atterrissage plan ${fmtEurShort(e.projPlan)} · tendance ${fmtEurSigned(e.projTendance - e.budget)} (repère)`}
      />
    );
  const unspent = e.nonConsomme > 0.5;
  const parts = unspent
    ? [w.when, paceText(e)]
    : [w.when, `${w.the} (${fmtEurShort(e.budget)}) consommé${w.fem ? 'e' : ''} selon le plan de charge`];
  return (
    <Metric
      label="Non consommé prévu"
      value={fmtEur(e.nonConsomme)}
      tone={e.sousConso ? 'warning' : undefined}
      glyph={e.sousConso ? SOUS_CONSO_GLYPH : undefined}
      sub={parts.filter(Boolean).join(' · ') || `sur ${fmtEurShort(e.budget)} ${ofBudget}`}
    />
  );
}
