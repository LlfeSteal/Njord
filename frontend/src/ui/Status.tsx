// Statuts : StatusGlyph, Tag, Pill.
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Status.css.
import type { ReactNode } from 'react';
import { IconClose } from './Icons';
import { cx, marginStyle, type BaseProps, type FlagTone, type GlyphKind, type Tone } from './types';
import './Status.css';

/** Ton d'un glyphe/tag : ton sémantique, ton de flag, ou statut de version. */
export type StatusTone = Tone | FlagTone | 'active' | 'archivee' | 'purgee';

export interface StatusGlyphProps {
  /** Forme (§9) — porte le sens indépendamment de la couleur. */
  kind: GlyphKind;
  tone: StatusTone;
  /** Défaut 15 (tableaux) ; 12 dans les bulles. */
  size?: number;
  /** Si fourni : role="img" + aria-label + title ; sinon décoratif. */
  label?: string;
}

// Marque blanche : barre de « ! » (2,4) et point, ou coche.
const BAR = { stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round' } as const;

/** Point d'exclamation blanc : barre de y1 à y2, point en dotY. */
function Exclamation({ y1, y2, dotY }: { y1: number; y2: number; dotY: number }) {
  return (
    <>
      <line x1="12" y1={y1} x2="12" y2={y2} {...BAR} />
      <circle cx="12" cy={dotY} r="1.35" fill="#fff" />
    </>
  );
}

/** Tracés du glyphe dans un viewBox 24 × 24 ; `size` sert aux formes de taille fixe en px. */
function shape(kind: GlyphKind, size: number): ReactNode {
  // Unités viewBox par pixel rendu (point et anneau font 8 px quelle que soit la taille).
  const u = 24 / size;
  switch (kind) {
    case 'warning':
      return (
        <>
          <path d="M12 3.6 21.3 19.6H2.7Z" fill="currentColor" stroke="currentColor" strokeWidth="2.8" strokeLinejoin="round" />
          <Exclamation y1={9.4} y2={13.8} dotY={17} />
        </>
      );
    case 'danger':
      return (
        <>
          <path
            d="M8.1 2.6h7.8l5.5 5.5v7.8l-5.5 5.5H8.1l-5.5-5.5V8.1Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <Exclamation y1={7.2} y2={12.8} dotY={16.6} />
        </>
      );
    case 'attention':
      return (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <Exclamation y1={7.2} y2={12.8} dotY={16.6} />
        </>
      );
    case 'success':
      return (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M7.4 12.4l3.1 3.1 6.1-6.6" fill="none" {...BAR} strokeWidth={2.3} strokeLinejoin="round" />
        </>
      );
    case 'info':
      return (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <circle cx="12" cy="7.4" r="1.4" fill="#fff" />
          <line x1="12" y1="11" x2="12" y2="16.8" {...BAR} />
        </>
      );
    case 'none':
      return (
        <>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      );
    case 'dot':
      return <circle cx="12" cy="12" r={Math.min(12, 4 * u)} fill="currentColor" />;
    case 'ring':
      return <circle cx="12" cy="12" r={Math.min(11, 3.25 * u)} fill="none" stroke="currentColor" strokeWidth={1.5 * u} />;
  }
}

/** Forme pleine colorée avec marque blanche (!, ✓, i), ou point / anneau / cercle barré. */
export function StatusGlyph({ kind, tone, size = 15, label }: StatusGlyphProps) {
  return (
    <svg
      className="ui-glyph"
      data-tone={tone}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {label && <title>{label}</title>}
      {shape(kind, size)}
    </svg>
  );
}

export interface TagProps extends BaseProps {
  tone: StatusTone;
  /** Défaut 'dot'. */
  glyph?: GlyphKind;
  /** Libellé barré (version purgée). */
  strike?: boolean;
  /** Bulle d'aide native. */
  title?: string;
  /** Sans libellé : glyphe seul (le libellé passe en aria-label/title). */
  children?: ReactNode;
}

/** Statut sobre : glyphe coloré + libellé en --text 13 px. Pas de fond, pas de contour (§8). */
export function Tag({ tone, glyph = 'dot', strike, title, mt, mb, className, style, children }: TagProps) {
  const hasLabel = children != null && children !== false && children !== '';
  return (
    <span
      className={cx('ui-tag', className)}
      data-strike={strike || undefined}
      title={title}
      style={marginStyle({ mt, mb }, style)}
    >
      <StatusGlyph kind={glyph} tone={tone} size={12} label={hasLabel ? undefined : title} />
      {hasLabel && <span className="ui-tag__label">{children}</span>}
    </span>
  );
}

export interface PillProps extends BaseProps {
  /** Icône 12 px avant le texte. */
  icon?: ReactNode;
  /** accent : texte bleu sur teinte bleue (filtre actif, sélection). */
  tone?: 'neutral' | 'accent';
  title?: string;
  /** Rend la pastille supprimable (bouton ✕). */
  onRemove?: () => void;
  children: ReactNode;
}

/** Pastille 18 px, --fill, 11/600 tabulaire secondaire (compteurs, valeurs saisies). */
export function Pill({ icon, tone = 'neutral', title, onRemove, mt, mb, className, style, children }: PillProps) {
  return (
    <span className={cx('ui-pill', className)} data-tone={tone} title={title} style={marginStyle({ mt, mb }, style)}>
      {icon && <span className="ui-pill__icon">{icon}</span>}
      <span className="ui-pill__label">{children}</span>
      {onRemove && (
        <button type="button" className="ui-pill__remove" aria-label="Retirer" title="Retirer" onClick={onRemove}>
          <IconClose size={10} stroke={2.4} />
        </button>
      )}
    </span>
  );
}
