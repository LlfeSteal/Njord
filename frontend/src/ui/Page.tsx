// Gabarit de page : Page (contenu + inspecteur), PageToolbar, Inspector, KeyValue.
// CONTRAT FIGÉ (props). Styles dans Page.css.
import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton, Link } from './Button';
import { IconChevronLeft, IconClose, IconMore } from './Icons';
import { Sheet } from './Modal';
import { Menu, type MenuEntry } from './Popover';
import { SidebarToggle } from './Shell';
import './Page.css';

// ------------------------------------------------------------------ PageToolbar

export interface PageToolbarProps {
  title: ReactNode;
  /** Une ligne 12 px secondaire sous le titre (contexte, compte). */
  subtitle?: ReactNode;
  /** Lien de retour (page de détail) : chevron + libellé, au-dessus du titre. */
  back?: { to: string; label: string };
  /** Élément après le titre (statut). */
  accessory?: ReactNode;
  /** Actions à droite (1 action principale au plus + contrôles compacts). */
  actions?: ReactNode;
  /** Menu « ⋯ » à droite (exports, actions secondaires). */
  menu?: MenuEntry[];
  /** Ligne sous la barre : recherche + FilterButton + ActiveFilters, ou contrôle segmenté. */
  bottom?: ReactNode;
}

/** Barre d'outils collante en tête du contenu, matériau translucide, filet bas 0,5 px. */
export function PageToolbar({ title, subtitle, back, accessory, actions, menu, bottom }: PageToolbarProps) {
  const hasMenu = menu != null && menu.length > 0;
  return (
    <header className="ui-page-toolbar">
      <div className="ui-page-toolbar__main">
        <SidebarToggle />
        <div className="ui-page-toolbar__titles">
          {back && (
            <Link to={back.to} size="sm" className="ui-page-toolbar__back">
              <IconChevronLeft size={12} stroke={2.2} />
              {back.label}
            </Link>
          )}
          <div className="ui-page-toolbar__heading">
            <h1 className="ui-page-toolbar__title">{title}</h1>
            {accessory && <span className="ui-page-toolbar__accessory">{accessory}</span>}
          </div>
          {subtitle && <p className="ui-page-toolbar__subtitle">{subtitle}</p>}
        </div>
        {(actions || hasMenu) && (
          <div className="ui-page-toolbar__actions">
            {actions}
            {hasMenu && (
              <Menu
                placement="bottom-end"
                items={menu}
                target={(p) => (
                  <IconButton {...p} label="Plus d'actions">
                    <IconMore size={16} />
                  </IconButton>
                )}
              />
            )}
          </div>
        )}
      </div>
      {bottom && <div className="ui-page-toolbar__bottom">{bottom}</div>}
    </header>
  );
}

// ------------------------------------------------------------------ Page

export interface PageProps {
  toolbar: ReactNode;
  children: ReactNode;
  /** Inspecteur (panneau droit 360 px) — rendu tel quel, normalement un <Inspector>. */
  inspector?: ReactNode;
  /** Contenu pleine largeur sans marge max (tableaux larges). Défaut : max 1200 px centré. */
  wide?: boolean;
}

/**
 * Zone de page : barre d'outils, contenu (padding 16 × 24, gap 16) et inspecteur optionnel à droite.
 * La hauteur de la barre d'outils est mesurée et exposée en `--ui-toolbar-h` (inspecteur collant dessous).
 */
export function Page({ toolbar, children, inspector, wide }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const observed = useRef<{ el: Element; ro: ResizeObserver } | null>(null);

  // À chaque rendu : (ré)observe la barre d'outils si l'élément a changé. Écriture directe de la
  // variable CSS, sans rendu React supplémentaire.
  useLayoutEffect(() => {
    const page = ref.current;
    const bar = page?.querySelector(':scope > .ui-page-toolbar') ?? null;
    if (observed.current?.el === bar) return;
    observed.current?.ro.disconnect();
    observed.current = null;
    if (!page || !bar) {
      page?.style.removeProperty('--ui-toolbar-h');
      return;
    }
    const measure = () => page.style.setProperty('--ui-toolbar-h', `${bar.getBoundingClientRect().height}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    observed.current = { el: bar, ro };
  });
  useEffect(
    () => () => {
      observed.current?.ro.disconnect();
      observed.current = null;
    },
    [],
  );

  return (
    <div ref={ref} className="ui-page" data-wide={wide || undefined}>
      {toolbar}
      <div className="ui-page__body">
        <main className="ui-page__content">{children}</main>
        {inspector}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Inspector

/** Sous ce point de rupture, l'inspecteur passe en feuille latérale (cf. Page.css). */
const SHEET_QUERY = '(max-width: 1099.98px)';

let sheetQuery: MediaQueryList | null = null;
const sheetMq = () => (sheetQuery ??= window.matchMedia(SHEET_QUERY));

function subscribeSheetQuery(l: () => void) {
  const mq = sheetMq();
  mq.addEventListener('change', l);
  return () => mq.removeEventListener('change', l);
}
const getSheetQuery = () => sheetMq().matches;

export interface InspectorProps {
  /** Ouvert = visible ; fermé = démonté. */
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Élément avant le titre (glyphe de statut). */
  accessory?: ReactNode;
  /** Actions en pied (boutons), alignées à droite. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Panneau inspecteur droit (360 px, --card, filet gauche 0,5 px, défile seul). Échap ferme.
 * Sous 1100 px : feuille latérale (Sheet) au-dessus du contenu.
 */
export function Inspector({ opened, onClose, title, subtitle, accessory, footer, children }: InspectorProps) {
  const narrow = useSyncExternalStore(subscribeSheetQuery, getSheetQuery, () => false);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Échap ferme le panneau, sauf si un menu, un popover ou un dialogue ouvert l'a déjà traité.
  // (En feuille, c'est le <dialog> qui gère Échap.)
  useEffect(() => {
    if (!opened || narrow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.ui-popover, dialog[open]')) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opened, narrow]);

  if (narrow)
    return (
      <Sheet
        opened={opened}
        onClose={onClose}
        width={400}
        title={
          accessory ? (
            <span className="ui-inspector__sheet-title">
              {accessory}
              {title}
            </span>
          ) : (
            title
          )
        }
        subtitle={subtitle}
        footer={footer}
      >
        <div className="ui-inspector__sections">{children}</div>
      </Sheet>
    );

  if (!opened) return null;
  return (
    <aside className="ui-inspector" aria-labelledby={titleId}>
      <header className="ui-inspector__header">
        {accessory && <span className="ui-inspector__accessory">{accessory}</span>}
        <div className="ui-inspector__titles">
          <h2 id={titleId} className="ui-inspector__title">
            {title}
          </h2>
          {subtitle && <p className="ui-inspector__subtitle">{subtitle}</p>}
        </div>
        <IconButton label="Fermer l'inspecteur" onClick={onClose}>
          <IconClose size={15} />
        </IconButton>
      </header>
      <div className="ui-inspector__body ui-inspector__sections">{children}</div>
      {footer && <footer className="ui-inspector__footer">{footer}</footer>}
    </aside>
  );
}

export interface InspectorSectionProps {
  /** Intitulé 11/600 majuscule secondaire. */
  title?: ReactNode;
  children: ReactNode;
}

export function InspectorSection({ title, children }: InspectorSectionProps) {
  const id = useId();
  return (
    <section className="ui-inspector-section" aria-labelledby={title ? id : undefined}>
      {title && (
        <h3 id={id} className="ui-inspector-section__title">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ KeyValue

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  /** Valeur numérique : alignée à droite, tabulaire. */
  numeric?: boolean;
}

/** Liste libellé (secondaire, gauche) / valeur (droite), lignes 28 px séparées par des filets. Valeur absente : « — ». */
export function KeyValue({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className="ui-kv">
      {items.map((it, i) => {
        const empty = it.value == null || it.value === '';
        return (
          <div key={i} className="ui-kv__row">
            <dt className="ui-kv__label">{it.label}</dt>
            <dd
              className="ui-kv__value"
              data-numeric={it.numeric || undefined}
              data-mono={it.mono || undefined}
              data-empty={empty || undefined}
            >
              {empty ? '—' : it.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
