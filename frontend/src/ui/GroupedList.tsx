// Listes insérées façon Réglages macOS : GroupedList, ListRow.
// CONTRAT FIGÉ (props). Styles dans GroupedList.css.
import { useId, type ReactNode } from 'react';
import { IconChevronRight } from './Icons';
import { cx, marginStyle, type BaseProps } from './types';
import './GroupedList.css';

export interface GroupedListProps extends BaseProps {
  /** Intitulé au-dessus du groupe (13/600). */
  title?: ReactNode;
  /** Note 12 px secondaire sous le groupe. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Groupe : --card, rayon 10, lignes séparées par des filets 0,5 px en retrait. */
export function GroupedList({ title, footer, children, mt, mb, className, style }: GroupedListProps) {
  const id = useId();
  return (
    <section
      className={cx('ui-grouped', className)}
      aria-labelledby={title ? id : undefined}
      style={marginStyle({ mt, mb }, style)}
    >
      {title && (
        <h3 id={id} className="ui-grouped__title">
          {title}
        </h3>
      )}
      <div className="ui-grouped__list">{children}</div>
      {footer && <div className="ui-grouped__footer">{footer}</div>}
    </section>
  );
}

export interface ListRowProps {
  /** Libellé principal 13 px. */
  label: ReactNode;
  /** Aide 12 px secondaire sous le libellé. */
  description?: ReactNode;
  /** Icône / glyphe 16 px à gauche. */
  icon?: ReactNode;
  /** Valeur en lecture seule à droite (secondaire). */
  value?: ReactNode;
  /** Contrôle à droite (champ compact, interrupteur, pop-up) ; prioritaire sur value.
   *  Ignoré si `onClick` (pas d'élément interactif dans un bouton). */
  control?: ReactNode;
  /** Ligne cliquable : chevron à droite, survol. */
  onClick?: () => void;
  /** Ligne sélectionnée (liste maître-détail). */
  selected?: boolean;
  /** Ton de la ligne (texte du libellé). */
  tone?: 'danger' | 'accent';
  /** Lie le libellé au contrôle (htmlFor). */
  htmlFor?: string;
}

/** Ligne de 44 px min : [icône] libellé (+ description) … valeur / contrôle [chevron]. */
export function ListRow({ label, description, icon, value, control, onClick, selected, tone, htmlFor }: ListRowProps) {
  const clickable = onClick != null;
  // Le <label> n'a de sens que pour un contrôle (et jamais dans un bouton).
  const Label = htmlFor && !clickable ? 'label' : 'span';
  const trailing =
    control != null && !clickable ? (
      <span className="ui-list-row__control">{control}</span>
    ) : value != null && value !== '' ? (
      <span className="ui-list-row__value">{value}</span>
    ) : null;

  const content = (
    <>
      {icon && <span className="ui-list-row__icon">{icon}</span>}
      <span className="ui-list-row__text">
        <Label className="ui-list-row__label" htmlFor={Label === 'label' ? htmlFor : undefined} data-tone={tone}>
          {label}
        </Label>
        {description && <span className="ui-list-row__desc">{description}</span>}
      </span>
      {trailing}
      {clickable && <IconChevronRight size={13} stroke={2.2} className="ui-list-row__chevron" />}
    </>
  );

  const attrs = {
    className: 'ui-list-row',
    'data-icon': icon ? true : undefined,
    'data-selected': selected || undefined,
  };

  if (clickable)
    return (
      <button type="button" {...attrs} data-clickable aria-current={selected || undefined} onClick={onClick}>
        {content}
      </button>
    );
  return <div {...attrs}>{content}</div>;
}
