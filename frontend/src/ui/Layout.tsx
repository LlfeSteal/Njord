// Primitives de mise en page : Stack, Group, Grid, Card, Divider, VisuallyHidden.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx, marginStyle, type BaseProps, type Space } from './types';
import './Layout.css';

type DivAttrs = Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className'>;
type Align = 'start' | 'center' | 'end' | 'baseline' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between';

const JUSTIFY: Record<Justify, CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
};
const ALIGN: Record<Align, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  baseline: 'baseline',
  stretch: 'stretch',
};

export interface StackProps extends BaseProps, DivAttrs {
  /** Défaut 12. */
  gap?: Space;
  align?: Align;
  children?: ReactNode;
}

/** Colonne flex. */
export function Stack({ gap = 12, align, mt, mb, className, style, children, ...rest }: StackProps) {
  return (
    <div
      {...rest}
      className={cx('ui-stack', className)}
      style={marginStyle({ mt, mb }, { gap, alignItems: align && ALIGN[align], ...style })}
    >
      {children}
    </div>
  );
}

export interface GroupProps extends BaseProps, DivAttrs {
  /** Défaut 8. */
  gap?: Space;
  /** Défaut 'center'. */
  align?: Align;
  /** Défaut 'start'. */
  justify?: Justify;
  /** Retour à la ligne (défaut true). */
  wrap?: boolean;
  /** Prend toute la largeur disponible et les enfants `grow` se partagent l'espace. */
  grow?: boolean;
  children?: ReactNode;
}

/** Ligne flex. */
export function Group({
  gap = 8,
  align = 'center',
  justify = 'start',
  wrap = true,
  grow,
  mt,
  mb,
  className,
  style,
  children,
  ...rest
}: GroupProps) {
  return (
    <div
      {...rest}
      className={cx('ui-group', grow && 'ui-group--grow', className)}
      style={marginStyle(
        { mt, mb },
        {
          gap,
          alignItems: ALIGN[align],
          justifyContent: JUSTIFY[justify],
          flexWrap: wrap ? 'wrap' : 'nowrap',
          ...style,
        },
      )}
    >
      {children}
    </div>
  );
}

/** Colonnes responsives : nombre fixe ou par point de rupture (xs 576, sm 768, md 992, lg 1200 px). */
export type Cols = number | { base: number; xs?: number; sm?: number; md?: number; lg?: number };

export interface GridProps extends BaseProps, DivAttrs {
  cols: Cols;
  /** Défaut 12. */
  gap?: Space;
  /** Espacement vertical si différent de `gap`. */
  rowGap?: Space;
  children?: ReactNode;
}

/** Grille à colonnes égales (remplace SimpleGrid). */
export function Grid({ cols, gap = 12, rowGap, mt, mb, className, style, children, ...rest }: GridProps) {
  const c = typeof cols === 'number' ? { base: cols } : cols;
  const xs = c.xs ?? c.base;
  const sm = c.sm ?? xs;
  const md = c.md ?? sm;
  const lg = c.lg ?? md;
  const vars = {
    '--cols-base': c.base,
    '--cols-xs': xs,
    '--cols-sm': sm,
    '--cols-md': md,
    '--cols-lg': lg,
    columnGap: gap,
    rowGap: rowGap ?? gap,
  } as CSSProperties;
  return (
    <div {...rest} className={cx('ui-grid', className)} style={marginStyle({ mt, mb }, { ...vars, ...style })}>
      {children}
    </div>
  );
}

export interface CardProps extends BaseProps, DivAttrs {
  /** Défaut 16. */
  padding?: 0 | 12 | 16 | 24;
  /** Élément rendu (défaut div). */
  as?: 'div' | 'section' | 'article';
  children?: ReactNode;
}

/** Carte : fond --card, rayon 12, --shadow (remplace Paper / Card). */
export function Card({ padding = 16, as: As = 'div', mt, mb, className, style, children, ...rest }: CardProps) {
  return (
    <As {...rest} className={cx('ui-card', className)} style={marginStyle({ mt, mb }, { padding, ...style })}>
      {children}
    </As>
  );
}

export interface DividerProps extends BaseProps {
  /** Libellé centré dans le filet. */
  label?: ReactNode;
  vertical?: boolean;
}

/** Filet 0,5 px. */
export function Divider({ label, vertical, mt, mb, className, style }: DividerProps) {
  if (vertical) return <span role="separator" aria-orientation="vertical" className={cx('ui-divider-v', className)} style={style} />;
  if (label)
    return (
      <div role="separator" className={cx('ui-divider ui-divider--label', className)} style={marginStyle({ mt, mb }, style)}>
        <span>{label}</span>
      </div>
    );
  return <hr className={cx('ui-divider', className)} style={marginStyle({ mt, mb }, style)} />;
}

/** Contenu lisible uniquement par les technologies d'assistance. */
export function VisuallyHidden({ children }: { children?: ReactNode }) {
  return <span className="ui-visually-hidden">{children}</span>;
}
