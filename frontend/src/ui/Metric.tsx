// Chiffres clés : Metric, ProgressBar.
// CONTRAT FIGÉ (props). Styles dans Metric.css.
import type { ReactNode } from 'react';
import type { GlyphKind } from './types';
import { StatusGlyph, type StatusTone } from './Status';
import './Metric.css';

export interface MetricProps {
  /** Libellé 12 px secondaire (au-dessus). */
  label: ReactNode;
  /** Valeur 28/600 tabulaire. */
  value: ReactNode;
  /** Ligne 12 px secondaire sous la valeur (contexte, variation). */
  sub?: ReactNode;
  /** Couleur de la valeur (rare : dépassement → danger). */
  tone?: 'danger' | 'warning' | 'success';
  /** Glyphe de statut avant le libellé. */
  glyph?: { kind: GlyphKind; tone: StatusTone };
  /** Élément sous la ligne sub (ProgressBar…). */
  children?: ReactNode;
}

/** Chiffre clé sans carte (§ densité : 3 au plus par écran). */
export function Metric({ label, value, sub, tone, glyph, children }: MetricProps) {
  return (
    <div className="ui-metric">
      <div className="ui-metric__label">
        {glyph && <StatusGlyph kind={glyph.kind} tone={glyph.tone} size={12} />}
        <span className="ui-metric__label-text">{label}</span>
      </div>
      <div className="ui-metric__value" data-tone={tone}>
        {value}
      </div>
      {sub && <div className="ui-metric__sub">{sub}</div>}
      {children != null && children !== false && <div className="ui-metric__extra">{children}</div>}
    </div>
  );
}

export interface ProgressBarProps {
  /** Valeur en % (0..100 ; > 100 = dépassement, la barre est pleine et le ton passe à danger). */
  value: number;
  /** Repère vertical (ex. avancement attendu), en %. */
  marker?: number;
  /** Défaut 'accent'. */
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** Libellé accessible (aria-label). */
  label: string;
  /** Largeur (défaut 100 %). */
  width?: number | string;
}

const clamp = (v: number) => Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));

/** Barre 4 px (6 px si width ≥ 200), piste --fill, rayon 2, role="progressbar". */
export function ProgressBar({ value, marker, tone = 'accent', label, width = '100%' }: ProgressBarProps) {
  const over = value > 100;
  const now = Math.round(Number.isFinite(value) ? value : 0);
  const text = `${now} %${marker != null ? ` (repère ${Math.round(marker)} %)` : ''}`;
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(100, now)}
      aria-valuenow={now}
      aria-valuetext={text}
      // Largeur en px : épaisseur décidée ici ; largeur relative : requête de conteneur (Metric.css).
      data-thick={(typeof width === 'number' && width >= 200) || undefined}
      data-fluid={typeof width === 'string' || undefined}
      style={{ width }}
    >
      <div className="ui-progress__track">
        <div className="ui-progress__bar" data-tone={over ? 'danger' : tone} style={{ width: `${clamp(value)}%` }} />
        {marker != null && <div className="ui-progress__marker" style={{ left: `${clamp(marker)}%` }} />}
      </div>
    </div>
  );
}
