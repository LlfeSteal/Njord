// Retours : Banner, Spinner, Skeleton, EmptyState.
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Feedback.css.
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { IconClose, IconTimeline } from './Icons';
import { StatusGlyph, type StatusTone } from './Status';
import { cx, marginStyle, type BaseProps, type GlyphKind } from './types';
import './Feedback.css';

/** Glyphe et ton par ton de retour (même table dans Toast.tsx). */
const FEEDBACK_GLYPH: Record<'error' | 'warning' | 'info' | 'success', { kind: GlyphKind; tone: StatusTone }> = {
  error: { kind: 'danger', tone: 'danger' },
  warning: { kind: 'warning', tone: 'warning' },
  info: { kind: 'info', tone: 'accent' },
  success: { kind: 'success', tone: 'success' },
};

export interface BannerProps extends BaseProps {
  /** error (octogone rouge) · warning (triangle orange) · info (cercle i bleu) · success (cercle ✓ vert). */
  tone: 'error' | 'warning' | 'info' | 'success';
  /** Titre 13/600. */
  title?: ReactNode;
  /** Texte 13 px secondaire. */
  children?: ReactNode;
  /** Action à droite (ex. <Button size="sm">Réessayer</Button>). */
  action?: ReactNode;
  /** Bouton de fermeture. */
  onClose?: () => void;
  /** Variante compacte (padding 8 × 12, sans titre en gras). */
  compact?: boolean;
}

/** Bandeau (remplace Alert) : rayon 12, ton mélangé à --card (§2.4). role="alert" pour error. */
export function Banner({ tone, title, children, action, onClose, compact, mt, mb, className, style }: BannerProps) {
  const g = FEEDBACK_GLYPH[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('ui-banner', className)}
      data-tone={tone}
      data-compact={compact || undefined}
      style={marginStyle({ mt, mb }, style)}
    >
      <span className="ui-banner__glyph">
        <StatusGlyph kind={g.kind} tone={g.tone} size={16} />
      </span>
      <div className="ui-banner__content">
        {title && <div className="ui-banner__title">{title}</div>}
        {children != null && children !== false && <div className="ui-banner__text">{children}</div>}
      </div>
      {action && <div className="ui-banner__action">{action}</div>}
      {onClose && (
        <IconButton label="Fermer" size="sm" className="ui-banner__close" onClick={onClose}>
          <IconClose size={14} />
        </IconButton>
      )}
    </div>
  );
}

export interface SpinnerProps {
  /** Défaut 16. */
  size?: number;
  /** Défaut « Chargement ». */
  label?: string;
}

export function Spinner({ size = 16, label = 'Chargement' }: SpinnerProps) {
  // Trait de 2 px rendus quelle que soit la taille.
  const sw = (2 * 24) / size;
  const r = 12 - sw / 2;
  return (
    <span role="status" aria-label={label} className="ui-spinner" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={sw} aria-hidden>
        <circle className="ui-spinner__track" cx="12" cy="12" r={r} />
        <path className="ui-spinner__arc" d={`M12 ${12 - r}a${r} ${r} 0 0 1 ${r} ${r}`} strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Spinner centré dans un bloc (remplace <Center><Loader/></Center>). */
export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="ui-loading-block">
      <Spinner label={label} />
    </div>
  );
}

export interface SkeletonProps extends BaseProps {
  /** Défaut 10. */
  height?: number;
  /** Défaut 100 %. */
  width?: number | string;
  /** Défaut 5. */
  radius?: number;
}

/** Barre de chargement scintillante (--fill → --fill-pressed). */
export function Skeleton({ height = 10, width = '100%', radius = 5, mt, mb, className, style }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx('ui-skeleton', className)}
      style={marginStyle({ mt, mb }, { height, width, borderRadius: radius, ...style })}
    />
  );
}

/** N lignes de squelette de tableau (40 px). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ui-skeleton-rows" role="status" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-skeleton-row">
          <Skeleton />
        </div>
      ))}
    </div>
  );
}

export interface EmptyStateProps extends BaseProps {
  /** Icône 40 px tertiaire (défaut IconTimeline). */
  icon?: ReactNode;
  /** Titre 17/600. */
  title: ReactNode;
  /** Texte secondaire. */
  children?: ReactNode;
  /** Bouton 16 px sous le texte. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action, mt, mb, className, style }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)} style={marginStyle({ mt, mb }, style)}>
      <span className="ui-empty__icon" aria-hidden>
        {icon ?? <IconTimeline size={40} stroke={2.4} />}
      </span>
      <h3 className="ui-empty__title">{title}</h3>
      {children != null && children !== false && <div className="ui-empty__text">{children}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
