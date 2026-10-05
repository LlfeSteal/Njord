// Superpositions ancrées : Popover, Menu (+ Floating, socle partagé avec Select).
// Positionnement : sous l'ancre (ou au-dessus si pas de place), dans un portail, z 20.
// Échap ferme et rend le focus au déclencheur ; clic extérieur ferme. Styles dans Popover.css.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from './Icons';
import { cx } from './types';
import './Popover.css';

/** Props à étaler sur l'élément déclencheur (bouton). */
export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog' | 'menu' | 'listbox';
}

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

// ------------------------------------------------------------------ Socle flottant

/** Pile des panneaux ouverts (du plus ancien au plus récent) : Échap et clic extérieur ne
 *  concernent que le plus haut, et un clic dans un panneau enfant ne ferme pas son parent. */
const stack: RefObject<HTMLDivElement>[] = [];

const GAP = 4;
const MARGIN = 8;

export interface FloatingProps {
  /** Élément d'ancrage (le déclencheur). */
  anchorRef: RefObject<HTMLElement>;
  /** Demande de fermeture ; le focus a déjà été rendu à l'ancre si `reason` vaut 'escape'. */
  onClose: (reason: 'escape' | 'outside') => void;
  placement?: Placement;
  /** Largeur fixe. */
  width?: number;
  /** Largeur minimale (défaut 190). */
  minWidth?: number;
  /** Au moins la largeur de l'ancre (pop-up buttons en formulaire). */
  matchAnchorWidth?: boolean;
  padding?: 0 | 5 | 12 | 16;
  role?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

/**
 * Panneau flottant ancré (usage interne du kit : Popover, Menu, Select).
 * Rendu dans un portail vers document.body — ou vers le <dialog> ouvert qui contient l'ancre,
 * sans quoi le panneau passerait sous la couche supérieure du dialogue modal.
 */
export function Floating({
  anchorRef,
  onClose,
  placement = 'bottom-start',
  width,
  minWidth = 190,
  matchAnchorWidth,
  padding = 12,
  role,
  className,
  onKeyDown,
  children,
  ...aria
}: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: 'top' | 'bottom'; anchorWidth: number } | null>(null);
  const [container] = useState<HTMLElement>(() => anchorRef.current?.closest('dialog') ?? document.body);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const el = ref.current;
    if (!anchor || !el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const [wantSide, align] = placement.split('-') as ['top' | 'bottom', 'start' | 'end'];
    const below = vh - a.bottom - GAP - MARGIN;
    const above = a.top - GAP - MARGIN;
    let side = wantSide;
    if (side === 'bottom' && h > below && above > below) side = 'top';
    else if (side === 'top' && h > above && below > above) side = 'bottom';
    let top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - h;
    top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));
    let left = align === 'start' ? a.left : a.right - w;
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
    setPos((p) =>
      p && p.top === top && p.left === left && p.side === side && p.anchorWidth === a.width
        ? p
        : { top, left, side, anchorWidth: a.width },
    );
  }, [anchorRef, placement]);

  // Placement initial avant le premier affichage, puis suivi du défilement et du redimensionnement.
  useLayoutEffect(() => {
    update();
    const el = ref.current;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    if (el) ro.observe(el);
    if (anchorRef.current) ro.observe(anchorRef.current);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [update, anchorRef]);

  // Empilement, focus initial, clic extérieur, Échap hors du panneau.
  useEffect(() => {
    stack.push(ref);
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const isTop = () => stack[stack.length - 1] === ref;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      // Clic dans un panneau ouvert après celui-ci (ex. Select dans un Popover) : on reste ouvert.
      const mine = stack.indexOf(ref);
      if (stack.slice(mine + 1).some((r) => r.current?.contains(t))) return;
      onCloseRef.current('outside');
    };
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTop()) return;
      e.preventDefault();
      anchorRef.current?.focus();
      onCloseRef.current('escape');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onDocKey);
      const i = stack.indexOf(ref);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [anchorRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      // Empêche aussi la fermeture du <dialog> parent.
      e.preventDefault();
      e.stopPropagation();
      anchorRef.current?.focus();
      onCloseRef.current('escape');
    }
  };

  const style: CSSProperties = {
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    width,
    minWidth: Math.max(minWidth, matchAnchorWidth && pos ? pos.anchorWidth : 0),
    padding,
  };

  return createPortal(
    <div
      {...aria}
      ref={ref}
      role={role}
      tabIndex={-1}
      className={cx('ui-popover', className)}
      data-side={pos?.side}
      data-align={placement.endsWith('end') ? 'end' : 'start'}
      data-ready={pos ? true : undefined}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    container,
  );
}

/** État ouvert/fermé (contrôlé ou non) et déclencheur d'un panneau flottant. */
function useDisclosure(opened: boolean | undefined, onOpenChange: ((v: boolean) => void) | undefined) {
  const [inner, setInner] = useState(false);
  const open = opened ?? inner;
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Ouverture au clavier (Entrée/Espace : event.detail === 0) → focus sur le premier élément.
  const viaKeyboard = useRef(false);
  const set = useCallback(
    (v: boolean) => {
      if (opened === undefined) setInner(v);
      onOpenChange?.(v);
    },
    [opened, onOpenChange],
  );
  const close = useCallback(() => {
    triggerRef.current?.focus();
    set(false);
  }, [set]);
  const toggle = (e?: MouseEvent) => {
    viaKeyboard.current = e?.detail === 0;
    set(!open);
  };
  return { open, set, close, toggle, triggerRef, viaKeyboard };
}

// ------------------------------------------------------------------ Popover

export interface PopoverProps {
  /** Rend le déclencheur : `target={(p) => <Button {...p}>Colonnes</Button>}`. */
  target: (props: TriggerProps) => ReactNode;
  /** Contenu ; une fonction reçoit `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Défaut 'bottom-start'. */
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  /** Largeur (défaut : au contenu, min 190). */
  width?: number;
  /** Mode contrôlé (optionnel). */
  opened?: boolean;
  onOpenChange?: (opened: boolean) => void;
  /** Padding interne (défaut 12 ; 5 pour une liste de type menu). */
  padding?: 0 | 5 | 12 | 16;
}

/** Fenêtre flottante (--menu-bg, rayon 10, ombre popover). */
export function Popover({ target, children, placement, width, opened, onOpenChange, padding = 12 }: PopoverProps) {
  const { open, set, close, toggle, triggerRef } = useDisclosure(opened, onOpenChange);
  return (
    <>
      {target({ ref: triggerRef, onClick: toggle, 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      {open && (
        <Floating anchorRef={triggerRef} onClose={() => set(false)} placement={placement} width={width} padding={padding} role="dialog">
          {typeof children === 'function' ? children(close) : children}
        </Floating>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Menu

export type MenuEntry =
  | {
      type?: 'item';
      label: ReactNode;
      icon?: ReactNode;
      onSelect: () => void;
      /** Coche à droite (sélection). */
      checked?: boolean;
      destructive?: boolean;
      disabled?: boolean;
      /** Texte secondaire à droite (raccourci, compte). */
      hint?: ReactNode;
    }
  | { type: 'separator' }
  | { type: 'header'; label: ReactNode };

export interface MenuProps {
  target: (props: TriggerProps) => ReactNode;
  items: MenuEntry[];
  /** Défaut 'bottom-start'. */
  placement?: PopoverProps['placement'];
  /** Défaut 190. */
  width?: number;
}

/** Éléments activables du menu, dans l'ordre. */
function menuItems(root: HTMLElement | null): HTMLButtonElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLButtonElement>('.ui-menu__item:not(:disabled)')) : [];
}

/** Menu macOS : éléments 28 px, survol bleu plein texte blanc, flèches haut/bas, Entrée valide. */
export function Menu({ target, items, placement, width = 190 }: MenuProps) {
  const { open, set, close, toggle, triggerRef, viaKeyboard } = useDisclosure(undefined, undefined);
  const listRef = useRef<HTMLDivElement>(null);

  // Ouvert au clavier : focus sur le premier élément ; à la souris : sur le menu lui-même.
  useEffect(() => {
    if (!open) return;
    if (viaKeyboard.current) menuItems(listRef.current)[0]?.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  }, [open, viaKeyboard]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems(listRef.current);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') {
      set(false);
      return;
    }
    if (next == null) return;
    e.preventDefault();
    list[next].focus();
  };

  return (
    <>
      {target({ ref: triggerRef, onClick: toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <Floating anchorRef={triggerRef} onClose={() => set(false)} placement={placement} minWidth={width} padding={5} onKeyDown={onKeyDown}>
          <div ref={listRef} role="menu" tabIndex={-1} className="ui-menu" onMouseLeave={() => listRef.current?.focus({ preventScroll: true })}>
            {items.map((it, i) => {
              if (it.type === 'separator') return <div key={i} role="separator" className="ui-menu__separator" />;
              if (it.type === 'header')
                return (
                  <div key={i} role="presentation" className="ui-menu__header">
                    {it.label}
                  </div>
                );
              const checkable = it.checked !== undefined;
              return (
                <button
                  key={i}
                  type="button"
                  role={checkable ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={checkable ? it.checked : undefined}
                  className="ui-menu__item"
                  data-destructive={it.destructive || undefined}
                  disabled={it.disabled}
                  tabIndex={-1}
                  onMouseMove={(e) => {
                    if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
                  }}
                  onClick={() => {
                    close();
                    it.onSelect();
                  }}
                >
                  {it.icon && <span className="ui-menu__icon">{it.icon}</span>}
                  <span className="ui-menu__label">{it.label}</span>
                  {it.hint != null && <span className="ui-menu__hint">{it.hint}</span>}
                  {checkable && <span className="ui-menu__check">{it.checked && <IconCheck size={13} stroke={2.2} />}</span>}
                </button>
              );
            })}
          </div>
        </Floating>
      )}
    </>
  );
}
