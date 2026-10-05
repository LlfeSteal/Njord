// Coquille d'application façon macOS : AppShell (barre latérale + contenu) et Sidebar.
// CONTRAT FIGÉ (props). Styles dans Shell.css.
// Barre latérale 220 px en matériau translucide ; sous 900 px elle se replie (bouton dans PageToolbar).
import { useEffect, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { IconButton } from './Button';
import { IconSidebar } from './Icons';
import { Pill } from './Status';
import './Shell.css';

// ------------------------------------------------------------------ État du panneau (écrans étroits)

/** Point de rupture sous lequel la barre latérale devient un panneau superposé (cf. Shell.css). */
const NARROW_QUERY = '(max-width: 899.98px)';
const SIDEBAR_ID = 'ui-sidebar';

// Store module partagé : AppShell et toutes les bascules (une par barre d'outils) voient la même valeur.
let sidebarOpen = false;
/** Bascule qui a ouvert le panneau : le focus y revient à la fermeture par Échap. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function setSidebarOpen(v: boolean) {
  if (v === sidebarOpen) return;
  sidebarOpen = v;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getOpen = () => sidebarOpen;

function useSidebarOpen() {
  return useSyncExternalStore(subscribe, getOpen, getOpen);
}

// ------------------------------------------------------------------ Sidebar

export interface SidebarItem {
  to: string;
  label: string;
  /** Icône 16 px (ui/Icons). */
  icon: ReactNode;
  /** Compteur à droite (ex. anomalies à traiter) ; masqué si 0 ou absent. */
  badge?: number;
  /** Correspondance exacte de l'URL (NavLink end) — pour « / ». */
  end?: boolean;
}

export interface SidebarSection {
  /** Intitulé 11/600 secondaire (ex. « Pilotage », « Données ») ; absent = pas d'en-tête. */
  title?: string;
  items: SidebarItem[];
}

export interface SidebarProps {
  /** En-tête : icône d'app + nom. */
  header: ReactNode;
  sections: SidebarSection[];
  /** Section collée en bas (Réglages, apparence). */
  footer?: ReactNode;
  'aria-label'?: string;
}

/** Liste source : éléments 28 px, rayon 6, actif = --accent-tint + texte --accent (icône comprise). */
export function Sidebar({ header, sections, footer, ...rest }: SidebarProps) {
  return (
    <nav className="ui-sidebar" aria-label={rest['aria-label'] ?? 'Navigation'}>
      <div className="ui-sidebar__header">{header}</div>
      {sections.map((s, i) => (
        <div key={s.title ?? i} className="ui-sidebar__section" role={s.title ? 'group' : undefined} aria-label={s.title}>
          {s.title && (
            <div className="ui-sidebar__title" aria-hidden>
              {s.title}
            </div>
          )}
          {s.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className="ui-sidebar__item">
              <span className="ui-sidebar__icon">{it.icon}</span>
              <span className="ui-sidebar__label">{it.label}</span>
              {it.badge ? <Pill className="ui-sidebar__badge">{it.badge}</Pill> : null}
            </NavLink>
          ))}
        </div>
      ))}
      {footer && <div className="ui-sidebar__footer">{footer}</div>}
    </nav>
  );
}

// ------------------------------------------------------------------ AppShell

export interface AppShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

/**
 * Grille barre latérale | contenu. La barre latérale est collante (pleine hauteur, défile seule) ;
 * le contenu reste dans le flux : c'est le document qui défile (barres d'outils collantes).
 * Sous 900 px : panneau superposé, fermé au clic sur un lien, sur le fond ou par Échap.
 */
export function AppShell({ sidebar, children }: AppShellProps) {
  const open = useSidebarOpen();

  // Retour en écran large : le panneau superposé n'a plus lieu d'être.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => {
      if (!mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Panneau ouvert : focus sur le premier lien ; Échap ferme et rend le focus à la bascule.
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLElement>(`#${SIDEBAR_ID} a, #${SIDEBAR_ID} button`)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Un menu ou un dialogue au-dessus traite Échap lui-même.
      if (document.querySelector('.ui-popover, dialog[open]')) return;
      e.preventDefault();
      setSidebarOpen(false);
      if (opener?.isConnected) opener.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const onSidebarClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('a[href]')) setSidebarOpen(false);
  };

  return (
    <div className="ui-shell" data-sidebar-open={open || undefined}>
      <aside id={SIDEBAR_ID} className="ui-shell__sidebar" onClick={onSidebarClick}>
        {sidebar}
      </aside>
      <div className="ui-shell__backdrop" aria-hidden onClick={() => setSidebarOpen(false)} />
      <div className="ui-shell__content">{children}</div>
    </div>
  );
}

/** Bascule de la barre latérale (écrans étroits) — intégrée à PageToolbar ; masquée dès 900 px. */
export function SidebarToggle() {
  const open = useSidebarOpen();
  return (
    <IconButton
      label="Barre latérale"
      className="ui-sidebar-toggle"
      aria-expanded={open}
      aria-controls={SIDEBAR_ID}
      onClick={(e) => {
        opener = e.currentTarget;
        setSidebarOpen(!open);
      }}
    >
      <IconSidebar size={16} />
    </IconButton>
  );
}
