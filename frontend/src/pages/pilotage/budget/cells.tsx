// Cellules partagées des tableaux par CT (Budget, Prévisions) : une ligne, sans retour.
import { ProgressBar, StatusGlyph } from '../../../ui';
import type { Enveloppe } from '../../../api/types';
import { fmtEur, fmtPct, fmtPeriod } from '../../../lib/format';
import { fmtEurSigned, rowGlyph, rowReason } from '../shared/pilotage';
import type { CtRow } from './model';
import './budget.css';

export function CtLabel({ ct, libelle }: { ct: string; libelle?: string }) {
  return (
    <span className="pil-ct" title={libelle ? `${ct} — ${libelle}` : ct}>
      <span className="pil-ct__code">{ct}</span>
      {libelle && <span className="pil-ct__label">{libelle}</span>}
    </span>
  );
}

/**
 * Glyphe d'une ligne CT : octogone (dépassement, risque), triangle (vigilance), cercle « ! » (sous-consommation).
 * Sans enveloppe : ni statut ni sous-consommation (DECISIONS n° 20), seul le risque de sécurisation reste.
 */
export function RowGlyph({ row, size }: { row: Pick<CtRow, 'statut' | 'risque'> & { sousConso?: boolean }; size?: number }) {
  const g = rowGlyph(row.statut, row.risque, row.sousConso);
  if (!g) return null;
  return <StatusGlyph kind={g.kind} tone={g.tone} size={size} label={rowReason(row.statut, row.risque, row.sousConso)} />;
}

/**
 * Cellule « Budget » (DECISIONS n° 20) : montant de l'enveloppe, période en infobulle ; sans enveloppe,
 * « Sans enveloppe » en texte secondaire (ni pastille, ni montant). Une ligne.
 */
export function BudgetCell({ b }: { b: { enveloppe: Enveloppe | null; budget: number | null } }) {
  if (b.budget == null) return <span className="pil-budget pil-budget--none">Sans enveloppe</span>;
  return (
    <span
      className="pil-budget"
      title={b.enveloppe ? `Enveloppe ${fmtPeriod(b.enveloppe.date_debut, b.enveloppe.date_fin)} : ${fmtEur(b.enveloppe.montant)}` : undefined}
    >
      <span className="pil-budget__value">{fmtEur(b.budget)}</span>
    </span>
  );
}

/**
 * « Reste à l'échéance » : non consommé (orange au-delà des seuils de sous-consommation) ou dépassement « + » en rouge.
 * Le signe porte l'information sans la couleur ; `title` explique le calcul (enveloppe − projection retenue).
 */
export function Reste({ value, over, warn, title }: { value: number | null; over: boolean; warn: boolean; title?: string }) {
  if (value == null) return <>—</>;
  if (over)
    return (
      <span className="pil-signed" data-tone="danger" title={title}>
        {fmtEurSigned(value)}
      </span>
    );
  return (
    <span className="pil-signed" data-tone={warn && value > 0 ? 'warning' : undefined} title={title}>
      {fmtEur(value)}
    </span>
  );
}

export function Signed({ value }: { value: number | null }) {
  return (
    <span className="pil-signed" data-tone={value != null && value > 0 ? 'danger' : undefined}>
      {fmtEurSigned(value)}
    </span>
  );
}

export function Consumption({ pct }: { pct: number | null }) {
  if (pct == null) return <>—</>;
  return (
    <span className="pil-progress">
      <ProgressBar value={pct} width={120} tone={pct > 100 ? 'danger' : 'accent'} label={`Consommé : ${fmtPct(pct)}`} />
      <span className="pil-progress__pct">{fmtPct(Math.round(pct))}</span>
    </span>
  );
}
