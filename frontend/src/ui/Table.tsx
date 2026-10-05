// Tableaux : Table (natif), SortHeader, Pagination.
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Table.css.
//
// Usage : <Table striped hover><thead><tr><th>…</th></tr></thead><tbody>…</tbody></Table>
// Cellules natives (<th>, <td>). Conventions de classes / attributs (stylés par Table.css) :
//   <th|td data-align="right">      → aligné à droite + chiffres tabulaires (colonnes numériques)
//   <td data-mono>                  → police monospace (codes, matricules, CT)
//   <td data-nowrap>                → pas de retour à la ligne
//   <td data-actions>               → cellule d'actions en fin de ligne (boutons icône, 4 px)
//   <tr data-clickable>             → curseur pointeur + survol
//   <tr data-muted>                 → texte secondaire (version archivée…)
//   <tr data-strike>                → tertiaire barré (version purgée…)
//   <tr data-selected>              → teinte bleue 14 %
//   <tr data-emphasis>              → graisse 600 (version active, ligne de total)
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconSelector } from './Icons';
import { VisuallyHidden } from './Layout';
import { cx, marginStyle, type BaseProps } from './types';
import './Table.css';

export interface TableProps extends BaseProps {
  /** Lignes alternées --card / --row-alt. */
  striped?: boolean;
  /** Survol --row-hover. */
  hover?: boolean;
  /** Lignes 28 px au lieu de 36. */
  compact?: boolean;
  /** Largeur minimale avant défilement horizontal. */
  minWidth?: number;
  /** Hauteur max : défilement vertical + en-tête collant. */
  maxHeight?: number | string;
  /** Envelopper dans une Card (défaut true). */
  card?: boolean;
  /** Légende accessible. */
  caption?: string;
  children: ReactNode;
}

export function Table({
  striped,
  hover,
  compact,
  minWidth,
  maxHeight,
  card = true,
  caption,
  mt,
  mb,
  className,
  style,
  children,
}: TableProps) {
  return (
    <div
      className={cx('ui-table-wrap', className)}
      data-card={card || undefined}
      style={marginStyle({ mt, mb }, style)}
    >
      <div className="ui-table-scroll" data-scroll-y={maxHeight != null || undefined} style={{ maxHeight }}>
        <table
          className="ui-table"
          data-striped={striped || undefined}
          data-hover={hover || undefined}
          data-compact={compact || undefined}
          style={{ minWidth }}
        >
          {caption && (
            <caption className="ui-table__caption">
              <VisuallyHidden>{caption}</VisuallyHidden>
            </caption>
          )}
          {children}
        </table>
      </div>
    </div>
  );
}

export type SortDir = 'asc' | 'desc';

export interface SortHeaderProps {
  /** Colonne actuellement triée. */
  active: boolean;
  dir: SortDir;
  onSort: () => void;
  align?: 'left' | 'right';
  children: ReactNode;
}

/** <th> triable : libellé + chevron 12 px (haut/bas si actif, sélecteur pâle sinon), aria-sort. */
export function SortHeader({ active, dir, onSort, align, children }: SortHeaderProps) {
  const Chevron = dir === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} data-align={align} data-sort>
      <button type="button" className="ui-sort" data-active={active || undefined} onClick={onSort}>
        <span className="ui-sort__label">{children}</span>
        {active ? <Chevron size={12} stroke={2.2} /> : <IconSelector size={12} stroke={2} className="ui-sort__idle" />}
      </button>
    </th>
  );
}

export interface PaginationProps extends BaseProps {
  /** Page courante (1-based). */
  page: number;
  /** Nombre total de pages. */
  total: number;
  onChange: (page: number) => void;
  /** Texte secondaire à gauche, ex. « 1–50 sur 1 234 lignes ». */
  summary?: ReactNode;
}

/** ‹ Page n / N › (boutons icône) ; rien si total ≤ 1 et pas de summary. */
export function Pagination({ page, total, onChange, summary, mt, mb, className, style }: PaginationProps) {
  if (total <= 1 && !summary) return null;
  return (
    <nav className={cx('ui-pagination', className)} aria-label="Pagination" style={marginStyle({ mt, mb }, style)}>
      <div className="ui-pagination__summary">{summary}</div>
      {total > 1 && (
        <div className="ui-pagination__pager">
          <IconButton label="Page précédente" disabled={page <= 1} onClick={() => onChange(page - 1)}>
            <IconChevronLeft size={15} />
          </IconButton>
          <span className="ui-pagination__page" aria-current="page">
            Page {page} / {total}
          </span>
          <IconButton label="Page suivante" disabled={page >= total} onClick={() => onChange(page + 1)}>
            <IconChevronRight size={15} />
          </IconButton>
        </div>
      )}
    </nav>
  );
}
