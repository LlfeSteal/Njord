// Texte : Text, Title, Code.
import type { HTMLAttributes, ReactNode } from 'react';
import { cx, marginStyle, type BaseProps } from './types';
import './Typography.css';

/** Tailles du guide (§3) : xs 11 · sm 12 · md 13 (défaut) · lg 15 · xl 17 · kpi 28. */
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'kpi';
/** Couleurs de texte : neutres + tons sémantiques + tons de flag. */
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'conforme'
  | 'hors_plan'
  | 'sur_imputation'
  | 'sous_imputation'
  | 'absence';

export interface TextProps extends BaseProps, Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  size?: TextSize;
  tone?: TextTone;
  weight?: 400 | 500 | 600;
  align?: 'left' | 'center' | 'right';
  /** Chiffres tabulaires (comptes, heures, montants). */
  tabular?: boolean;
  mono?: boolean;
  /** Une ligne avec ellipse. */
  truncate?: boolean;
  /** Coupe à N lignes avec ellipse. */
  lineClamp?: number;
  /** Texte barré. */
  strike?: boolean;
  /** Élément rendu (défaut p ; span pour de l'inline). */
  as?: 'p' | 'span' | 'div' | 'label' | 'strong' | 'small';
  children?: ReactNode;
}

export function Text({
  size,
  tone,
  weight,
  align,
  tabular,
  mono,
  truncate,
  lineClamp,
  strike,
  as: As = 'p',
  mt,
  mb,
  className,
  style,
  children,
  ...rest
}: TextProps) {
  return (
    <As
      {...rest}
      className={cx('ui-text', className)}
      data-size={size}
      data-tone={tone}
      data-weight={weight}
      data-align={align}
      data-tabular={tabular || undefined}
      data-mono={mono || undefined}
      data-truncate={truncate || undefined}
      data-strike={strike || undefined}
      data-clamp={lineClamp ? true : undefined}
      style={marginStyle({ mt, mb }, lineClamp ? { WebkitLineClamp: lineClamp, ...style } : style)}
    >
      {children}
    </As>
  );
}

export interface TitleProps extends BaseProps, Omit<HTMLAttributes<HTMLHeadingElement>, 'style' | 'className'> {
  /** 1–2 : 17/600 (titre de page) · 3 : 15/600 (section, dialogue) · 4 : 13/600. */
  order?: 1 | 2 | 3 | 4;
  children?: ReactNode;
}

export function Title({ order = 2, mt, mb, className, style, children, ...rest }: TitleProps) {
  const H = `h${order}` as const;
  return (
    <H {...rest} className={cx('ui-title', className)} data-order={order} style={marginStyle({ mt, mb }, style)}>
      {children}
    </H>
  );
}

export interface CodeProps extends BaseProps {
  /** Bloc (pre) plutôt qu'inline. */
  block?: boolean;
  children?: ReactNode;
}

export function Code({ block, mt, mb, className, style, children }: CodeProps) {
  if (block)
    return (
      <pre className={cx('ui-code ui-code--block', className)} style={marginStyle({ mt, mb }, style)}>
        <code>{children}</code>
      </pre>
    );
  return (
    <code className={cx('ui-code', className)} style={style}>
      {children}
    </code>
  );
}
