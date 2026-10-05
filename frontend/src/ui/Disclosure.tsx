// Dépliables et étapes : Collapse, Disclosure, Steps.
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Disclosure.css.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconChevronRight } from './Icons';
import { VisuallyHidden } from './Layout';
import { cx, marginStyle, type BaseProps } from './types';
import './Disclosure.css';

export interface CollapseProps {
  opened: boolean;
  children: ReactNode;
}

/** Durée de la transition de hauteur (Disclosure.css). */
const COLLAPSE_MS = 200;

/** fermé (démonté) → entrée (monté, 0fr) → dépliage (1fr) → ouvert (débordement visible) → repli. */
type Phase = 'closed' | 'enter' | 'expanding' | 'open' | 'closing';

/** Affiche/masque son contenu avec une transition de hauteur 0,2 s. */
export function Collapse({ opened, children }: CollapseProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(opened ? 'open' : 'closed');
  const prev = useRef(opened);

  useEffect(() => {
    if (prev.current === opened) return;
    prev.current = opened;
    let raf = 0;
    let timer = 0;
    if (opened) {
      setPhase('enter');
      // Deux images : le contenu est monté à 0fr avant de déclencher la transition.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          setPhase('expanding');
          timer = window.setTimeout(() => setPhase('open'), COLLAPSE_MS);
        });
      });
    } else {
      setPhase('closing');
      timer = window.setTimeout(() => setPhase('closed'), COLLAPSE_MS);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [opened]);

  // Contenu en cours de repli : hors de l'ordre de tabulation et de l'arbre d'accessibilité.
  useLayoutEffect(() => {
    if (ref.current) ref.current.inert = !opened;
  }, [opened]);

  return (
    <div
      ref={ref}
      className="ui-collapse"
      data-expanded={phase === 'expanding' || phase === 'open' || undefined}
      data-settled={phase === 'open' || undefined}
      aria-hidden={!opened || undefined}
    >
      <div className="ui-collapse__inner">{phase !== 'closed' && children}</div>
    </div>
  );
}

export interface DisclosureProps extends BaseProps {
  /** Ligne de résumé (13/600) précédée d'un chevron qui pivote. */
  summary: ReactNode;
  /** Élément à droite du résumé (compteur, action). */
  aside?: ReactNode;
  defaultOpen?: boolean;
  /** Mode contrôlé (optionnel). */
  opened?: boolean;
  onToggle?: (opened: boolean) => void;
  children: ReactNode;
}

/** Section dépliable sur <details> (remplace Accordion) ; empiler plusieurs = filets entre elles. */
export function Disclosure({
  summary,
  aside,
  defaultOpen = false,
  opened,
  onToggle,
  mt,
  mb,
  className,
  style,
  children,
}: DisclosureProps) {
  const controlled = opened !== undefined;
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = controlled ? opened : inner;

  const onSummaryClick = (e: MouseEvent<HTMLElement>) => {
    // Un contrôle placé dans `aside` garde son propre comportement.
    const control = (e.target as Element).closest('button, a, input, select, textarea, label, [role="button"]');
    if (control && control !== e.currentTarget) return;
    // L'état est piloté par React : on remplace la bascule native.
    e.preventDefault();
    if (!controlled) setInner(!isOpen);
    onToggle?.(!isOpen);
  };

  return (
    <details
      className={cx('ui-disclosure', className)}
      open={isOpen}
      style={marginStyle({ mt, mb }, style)}
      onToggle={(e) => {
        // Ouverture native hors clic (recherche dans la page…) : on resynchronise l'état.
        const o = e.currentTarget.open;
        if (o === isOpen) return;
        if (!controlled) setInner(o);
        onToggle?.(o);
      }}
    >
      <summary className="ui-disclosure__summary" onClick={onSummaryClick}>
        <IconChevronRight size={14} stroke={2} className="ui-disclosure__chevron" />
        <span className="ui-disclosure__label">{summary}</span>
        {aside && <span className="ui-disclosure__aside">{aside}</span>}
      </summary>
      <div className="ui-disclosure__content">{children}</div>
    </details>
  );
}

export interface StepsProps extends BaseProps {
  /** Index (0-based) de l'étape courante ; = steps.length quand tout est terminé. */
  active: number;
  steps: { label: string; description?: string }[];
}

/** Indicateur d'étapes horizontal (remplace Stepper ; le contenu est rendu par l'appelant). */
export function Steps({ active, steps, mt, mb, className, style }: StepsProps) {
  return (
    <ol className={cx('ui-steps', className)} style={marginStyle({ mt, mb }, style)}>
      {steps.map((s, i) => {
        const state = i < active ? 'done' : i === active ? 'current' : 'upcoming';
        return (
          <li key={s.label} className="ui-steps__item" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ui-steps__dot" aria-hidden>
              {state === 'done' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="ui-steps__text">
              <span className="ui-steps__label">
                {s.label}
                {state === 'done' && <VisuallyHidden> (terminée)</VisuallyHidden>}
              </span>
              {s.description && <span className="ui-steps__description">{s.description}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
