// Actions : Button, IconButton, Link.
// Button et IconButton transmettent leur ref (déclencheurs de Popover / Menu). Styles dans Button.css.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Spinner } from './Feedback';
import { cx, marginStyle, type BaseProps } from './types';
import './Button.css';

export interface ButtonProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className'> {
  /** default : fond --fill · primary : bleu plein · plain : texte bleu sans fond. */
  variant?: 'default' | 'primary' | 'plain';
  /** Action destructive : texte rouge (default/plain) ou fond rouge (primary). */
  destructive?: boolean;
  /** md 28 px (défaut) · sm 24 px. */
  size?: 'sm' | 'md';
  /** Icône avant le libellé (ex. <IconPlus />, 15 px conseillé). */
  icon?: ReactNode;
  /** Icône après le libellé. */
  iconRight?: ReactNode;
  /** Remplace l'icône par un Spinner et désactive le bouton. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Si fourni, rend un <Link> react-router stylé en bouton. */
  to?: string;
  children?: ReactNode;
}

/** Bouton (type="button" par défaut). Bascule : passer `aria-pressed`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    to,
    variant = 'default',
    destructive,
    size = 'md',
    icon,
    iconRight,
    loading,
    fullWidth,
    mt,
    mb,
    className,
    style,
    type = 'button',
    disabled,
    ...rest
  },
  ref,
) {
  const off = disabled || loading;
  const attrs = {
    className: cx('ui-btn', className),
    'data-variant': variant,
    'data-size': size,
    'data-destructive': destructive || undefined,
    'data-full': fullWidth || undefined,
    'data-loading': loading || undefined,
    'data-overlay': (loading && !icon) || undefined,
    'data-icon-only': !children || undefined,
    style: marginStyle({ mt, mb }, style),
  };
  // Pendant le chargement : le spinner prend la place de l'icône ; sans icône, il se superpose
  // au libellé masqué pour que la largeur ne bouge pas.
  const content = (
    <>
      {loading && icon ? <Spinner size={14} /> : icon}
      {children != null && children !== false && <span className="ui-btn__label">{children}</span>}
      {iconRight}
      {loading && !icon && (
        <span className="ui-btn__overlay">
          <Spinner size={14} />
        </span>
      )}
    </>
  );

  if (to) {
    // Les attributs propres aux boutons (type, form…) n'ont pas de sens sur un lien.
    const anchorRest = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <RouterLink
        {...anchorRest}
        {...attrs}
        ref={ref as unknown as Ref<HTMLAnchorElement>}
        to={to}
        aria-disabled={off || undefined}
        tabIndex={off ? -1 : anchorRest.tabIndex}
        onClick={(e) => {
          if (off) e.preventDefault();
          else anchorRest.onClick?.(e);
        }}
      >
        {content}
      </RouterLink>
    );
  }

  return (
    <button ref={ref} type={type} {...rest} {...attrs} disabled={off} aria-busy={loading || undefined}>
      {content}
    </button>
  );
});

export interface IconButtonProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'className' | 'children'> {
  /** Obligatoire : aria-label ET bulle d'aide native (title). */
  label: string;
  /** L'icône (ex. <IconTrash />). */
  children: ReactNode;
  /** plain (défaut) : pas de fond avant survol · filled : fond --fill. */
  variant?: 'plain' | 'filled';
  destructive?: boolean;
  /** md 28 px (défaut) · sm 24 px. */
  size?: 'sm' | 'md';
  loading?: boolean;
}

/** Bouton carré à icône seule ; le libellé sert d'aria-label et de bulle d'aide. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, variant = 'plain', destructive, size = 'md', loading, mt, mb, className, style, type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      aria-label={rest['aria-label'] ?? label}
      // Désactivé, le bouton est souvent enveloppé d'un Tooltip : pas de seconde bulle native.
      title={disabled ? undefined : label}
      className={cx('ui-icon-btn', className)}
      data-variant={variant}
      data-size={size}
      data-destructive={destructive || undefined}
      style={marginStyle({ mt, mb }, style)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner size={14} /> : children}
    </button>
  );
});

export interface LinkProps extends BaseProps {
  /** Route interne (react-router). */
  to?: string;
  /** URL externe (ouverte dans un nouvel onglet). */
  href?: string;
  /** Sans `to` ni `href` : rendu comme <button> stylé en lien. Reçoit l'événement (stopPropagation). */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  size?: 'xs' | 'sm' | 'md';
  mono?: boolean;
  title?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

/** Lien bleu (texte), interne, externe ou action. Transmet sa ref à l'élément rendu. */
export const Link = forwardRef<HTMLButtonElement, LinkProps>(function Link(
  { to, href, onClick, size, mono, title, mt, mb, className, style, children, ...rest },
  ref,
) {
  const attrs = {
    className: cx('ui-link', className),
    'data-size': size,
    'data-mono': mono || undefined,
    style: marginStyle({ mt, mb }, style),
    title,
    'aria-label': rest['aria-label'],
  };
  const anchorRef = ref as unknown as Ref<HTMLAnchorElement>;
  if (to)
    return (
      <RouterLink {...attrs} ref={anchorRef} to={to} onClick={onClick}>
        {children}
      </RouterLink>
    );
  if (href)
    return (
      <a {...attrs} ref={anchorRef} href={href} target="_blank" rel="noreferrer" onClick={onClick}>
        {children}
      </a>
    );
  return (
    <button {...attrs} ref={ref} type="button" onClick={onClick}>
      {children}
    </button>
  );
});
