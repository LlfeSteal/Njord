// Filtres : FilterButton (popover de critères avec compteur) et ActiveFilters (pastilles).
// CONTRAT FIGÉ (props), sur le Popover du kit. Styles dans Filters.css.
import type { ReactNode } from 'react';
import { Button, Link } from './Button';
import { IconSliders } from './Icons';
import { Popover } from './Popover';
import { Pill } from './Status';
import './Filters.css';

export interface FilterButtonProps {
  /** Nombre de critères actifs : bouton teinté + compteur si > 0. */
  count: number;
  /** Formulaire de critères (Select, DateInput, Switch… étiquetés) ; une fonction reçoit `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Bouton « Réinitialiser » en pied du popover (affiché si count > 0). */
  onReset?: () => void;
  /** Largeur du popover (défaut 320). */
  width?: number;
  /** Libellé du bouton (défaut « Filtres »). */
  label?: string;
}

/** Bouton « Filtres » (icône IconSliders) ouvrant un popover ; critères empilés, 12 px d'écart. */
export function FilterButton({ count, children, onReset, width = 320, label = 'Filtres' }: FilterButtonProps) {
  const active = count > 0;
  return (
    <Popover
      width={width}
      padding={16}
      target={(p) => (
        <Button
          {...p}
          className="ui-filter-btn"
          data-active={active || undefined}
          aria-label={active ? `${label} (${count} actif${count > 1 ? 's' : ''})` : undefined}
          icon={<IconSliders size={15} />}
          iconRight={active ? <Pill tone="accent">{count}</Pill> : undefined}
        >
          {label}
        </Button>
      )}
    >
      {(close) => (
        <div className="ui-filters" role="group" aria-label={label}>
          <div className="ui-filters__body">{typeof children === 'function' ? children(close) : children}</div>
          {onReset && active && (
            <div className="ui-filters__footer">
              <Button variant="plain" size="sm" onClick={onReset}>
                Réinitialiser
              </Button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

export interface ActiveFilter {
  key: string;
  /** Ex. « CT : Y99F90001 ». */
  label: ReactNode;
  onRemove: () => void;
}

/** Pastilles des filtres actifs (Pill accent supprimable) + « Tout effacer » ; rien si vide. */
export function ActiveFilters({ items, onClearAll }: { items: ActiveFilter[]; onClearAll?: () => void }) {
  if (items.length === 0) return null;
  return (
    <div className="ui-active-filters" role="group" aria-label="Filtres actifs">
      {items.map((f) => (
        <Pill key={f.key} tone="accent" onRemove={f.onRemove}>
          {f.label}
        </Pill>
      ))}
      {onClearAll && (
        <Link size="sm" onClick={() => onClearAll()} className="ui-active-filters__clear">
          Tout effacer
        </Link>
      )}
    </div>
  );
}
