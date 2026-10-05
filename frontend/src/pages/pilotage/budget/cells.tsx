// Cellules partagées des tableaux par CT (Budget, Prévisions) : une ligne, sans retour.
import { ProgressBar, StatusGlyph } from '../../../ui';
import { fmtPct } from '../../../lib/format';
import { fmtEurSigned, rowReason, rowTone } from '../shared/pilotage';
import type { CtRow } from './model';

export function CtLabel({ ct, libelle }: { ct: string; libelle?: string }) {
  return (
    <span className="pil-ct" title={libelle ? `${ct} — ${libelle}` : ct}>
      <span className="pil-ct__code">{ct}</span>
      {libelle && <span className="pil-ct__label">{libelle}</span>}
    </span>
  );
}

export function RowGlyph({ row }: { row: Pick<CtRow, 'statut' | 'risque'> }) {
  const tone = rowTone(row.statut, row.risque);
  if (!tone) return null;
  return <StatusGlyph kind={tone} tone={tone} label={rowReason(row.statut, row.risque)} />;
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
