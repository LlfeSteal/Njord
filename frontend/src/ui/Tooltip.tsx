// Bulle d'aide en matériau translucide (§7).
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Tooltip.css.
// S'ouvre au survol (délai 400 ms) et au focus clavier ; Échap ferme ; aria-describedby sur l'enveloppe.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

export interface TooltipProps {
  /** Contenu de la bulle (texte ou riche). */
  label: ReactNode;
  /** Élément ancré. Enveloppé dans un <span> inline-flex (fonctionne aussi sur un bouton désactivé). */
  children: ReactNode;
  /** Défaut 320. */
  maxWidth?: number;
  /** Défaut 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  disabled?: boolean;
  /** Délai d'ouverture en ms (défaut 400). */
  delay?: number;
}

type Side = NonNullable<TooltipProps['placement']>;

const GAP = 6;
const MARGIN = 8;
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** Position de la bulle pour un côté donné (coordonnées viewport). */
function place(side: Side, a: DOMRect, w: number, h: number) {
  switch (side) {
    case 'top':
      return { left: a.left + a.width / 2 - w / 2, top: a.top - GAP - h };
    case 'bottom':
      return { left: a.left + a.width / 2 - w / 2, top: a.bottom + GAP };
    case 'left':
      return { left: a.left - GAP - w, top: a.top + a.height / 2 - h / 2 };
    case 'right':
      return { left: a.right + GAP, top: a.top + a.height / 2 - h / 2 };
  }
}

/** Vrai si la bulle déborde du viewport du côté où elle est placée. */
function overflows(side: Side, p: { left: number; top: number }, w: number, h: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === 'top') return p.top < MARGIN;
  if (side === 'bottom') return p.top + h > vh - MARGIN;
  if (side === 'left') return p.left < MARGIN;
  return p.left + w > vw - MARGIN;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

export function Tooltip({ label, children, maxWidth = 320, placement = 'top', disabled, delay = 400 }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const id = useId();
  const enabled = !disabled && label != null && label !== false && label !== '';
  const visible = open && enabled;

  const cancel = () => window.clearTimeout(timer.current);
  const show = (ms: number) => {
    cancel();
    if (ms <= 0) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), ms);
  };
  const hide = () => {
    cancel();
    setOpen(false);
  };

  useEffect(() => {
    const t = timer;
    return () => window.clearTimeout(t.current);
  }, []);

  // Positionnement avant affichage, avec retournement puis recadrage dans le viewport.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!visible || !anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const { width: w, height: h } = bubble.getBoundingClientRect();
    let side: Side = placement;
    let p = place(side, a, w, h);
    if (overflows(side, p, w, h)) {
      const q = place(OPPOSITE[side], a, w, h);
      if (!overflows(OPPOSITE[side], q, w, h)) {
        side = OPPOSITE[side];
        p = q;
      }
    }
    bubble.style.left = `${clamp(p.left, MARGIN, window.innerWidth - w - MARGIN)}px`;
    bubble.style.top = `${clamp(p.top, MARGIN, window.innerHeight - h - MARGIN)}px`;
    bubble.dataset.side = side;
    bubble.dataset.ready = '';
  }, [visible, placement, label]);

  // Échap ferme ; un défilement ou un redimensionnement aussi (la bulle ne suit pas l'ancre).
  useEffect(() => {
    if (!visible) return;
    const close = () => {
      window.clearTimeout(timer.current);
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onMove = close;
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [visible]);

  return (
    <span
      ref={anchorRef}
      className="ui-tooltip-anchor"
      style={{ display: 'inline-flex' }}
      aria-describedby={visible ? id : undefined}
      onPointerEnter={(e) => {
        if (enabled && e.pointerType !== 'touch') show(delay);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        // Focus clavier seulement : un clic n'ouvre pas la bulle immédiatement.
        if (enabled && e.target instanceof Element && e.target.matches(':focus-visible')) show(0);
      }}
      onBlur={hide}
    >
      {children}
      {visible &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-rich={typeof label === 'string' || typeof label === 'number' ? undefined : ''}
            style={{ maxWidth }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
