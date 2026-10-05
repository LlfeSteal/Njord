// Notifications éphémères : toast() + <Toaster/> (remplace @mantine/notifications).
// CONTRAT FIGÉ (API) — implémentation : agent Kit 2. Styles dans Toast.css.
// <Toaster/> est monté une fois dans main.tsx ; toast() peut être appelé de n'importe où (hors React aussi).
/* eslint-disable react-refresh/only-export-components -- API impérative (toast) et composant dans le même module */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';
import { IconClose } from './Icons';
import { StatusGlyph, type StatusTone } from './Status';
import type { GlyphKind } from './types';
import './Toast.css';

export interface ToastOptions {
  /** success (✓ vert) · error (octogone rouge) · warning (triangle orange) · info (i bleu). */
  tone: 'success' | 'error' | 'warning' | 'info';
  title: ReactNode;
  message?: ReactNode;
  /** ms ; défaut 4000 (error : 8000). 0 = jusqu'à fermeture. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

/** Nombre maximal de notifications affichées (les plus anciennes partent). */
const MAX_TOASTS = 5;

const GLYPH: Record<ToastOptions['tone'], { kind: GlyphKind; tone: StatusTone }> = {
  error: { kind: 'danger', tone: 'danger' },
  warning: { kind: 'warning', tone: 'warning' },
  info: { kind: 'info', tone: 'accent' },
  success: { kind: 'success', tone: 'success' },
};

// Store module : liste immuable + abonnés (utilisable hors React).
let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => items;

/** Affiche une notification ; renvoie son id. */
export function toast(opts: ToastOptions): string {
  const id = `toast-${++counter}`;
  items = [...items, { ...opts, id }].slice(-MAX_TOASTS);
  emit();
  return id;
}

/** Ferme une notification. */
export function dismissToast(id: string): void {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Une notification : auto-fermeture, en pause au survol et au focus. */
function ToastCard({ item }: { item: ToastItem }) {
  const duration = item.duration ?? (item.tone === 'error' ? 8000 : 4000);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(duration);
  const paused = hovered || focused;
  const g = GLYPH[item.tone];

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const start = Date.now();
    const timer = window.setTimeout(() => dismissToast(item.id), remaining.current);
    const left = remaining;
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - start));
    };
  }, [duration, paused, item.id]);

  return (
    <div
      className="ui-toast"
      data-tone={item.tone}
      role={item.tone === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="ui-toast__glyph">
        <StatusGlyph kind={g.kind} tone={g.tone} size={16} />
      </span>
      <div className="ui-toast__content">
        <div className="ui-toast__title">{item.title}</div>
        {item.message != null && item.message !== false && <div className="ui-toast__message">{item.message}</div>}
      </div>
      <IconButton label="Fermer" size="sm" className="ui-toast__close" onClick={() => dismissToast(item.id)}>
        <IconClose size={12} />
      </IconButton>
    </div>
  );
}

/** Pile de notifications en bas à droite (matériau, rayon 10, z 40, aria-live). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return createPortal(
    <section className="ui-toaster" aria-label="Notifications" aria-live="polite">
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </section>,
    document.body,
  );
}
