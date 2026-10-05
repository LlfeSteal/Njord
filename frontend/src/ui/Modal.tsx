// Dialogues : Modal (feuille centrée), Sheet (panneau latéral). Sur <dialog> natif (showModal).
// CONTRAT FIGÉ (props) — implémentation : agent Kit 2. Styles dans Modal.css.
// Échap et clic sur le fond appellent onClose (sauf `dismissable={false}`) ; focus rendu au déclencheur.
// Focus initial : comportement natif du dialog, ou l'élément marqué `data-autofocus` s'il existe.
import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './Button';
import { IconClose } from './Icons';
import './Modal.css';

export interface ModalProps {
  opened: boolean;
  onClose: () => void;
  /** Titre 15/600 (une ligne, ellipse). */
  title?: ReactNode;
  /** Sous-titre 12 px secondaire. */
  subtitle?: ReactNode;
  /** sm 440 · md 560 (défaut) · lg 800 · xl min(1100, 100vw − 32). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Actions en pied, alignées à droite, 8 px d'écart. */
  footer?: ReactNode;
  /** false : Échap / fond / croix désactivés (opération en cours). Défaut true. */
  dismissable?: boolean;
  children?: ReactNode;
}

interface DialogProps extends Omit<ModalProps, 'size'> {
  variant: 'modal' | 'sheet';
  size?: ModalProps['size'];
  style?: CSSProperties;
}

/** Socle commun : ouverture pilotée par `opened`, fermeture par Échap / fond / croix. */
function Dialog({ variant, opened, onClose, title, subtitle, size, footer, dismissable = true, style, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Dernières props, lues par les gestionnaires natifs.
  const latest = useRef({ opened, onClose, dismissable });
  useEffect(() => {
    latest.current = { opened, onClose, dismissable };
  });
  // Le fond n'est « cliqué » que si l'appui et le relâchement y ont eu lieu (pas un glisser depuis le contenu).
  const downOnBackdrop = useRef(false);

  // Effet de mise en page : fermeture dans le même rendu que le démontage du contenu (pas de cadre vide).
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !opened) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (d.open) d.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [opened]);

  // Fermeture native imprévue (ex. Échap répété contournant `cancel`) : on resynchronise.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onNativeClose = () => {
      const { opened: o, onClose: close, dismissable: dis } = latest.current;
      if (!o) return;
      if (dis) close();
      else if (d.isConnected && !d.open) d.showModal();
    };
    d.addEventListener('close', onNativeClose);
    return () => d.removeEventListener('close', onNativeClose);
  }, []);

  const isBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={ref}
      className={variant === 'sheet' ? 'ui-dialog ui-sheet' : 'ui-dialog'}
      data-size={size}
      aria-labelledby={title ? titleId : undefined}
      style={style}
      onCancel={(e) => {
        // L'état reste piloté par `opened` : on ne laisse jamais le navigateur fermer seul.
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && dismissable && isBackdrop(e)) onClose();
        downOnBackdrop.current = false;
      }}
    >
      {opened && (
        <>
          <header className="ui-dialog__header">
            <div className="ui-dialog__titles">
              {title && (
                <h2 id={titleId} className="ui-dialog__title">
                  {title}
                </h2>
              )}
              {subtitle && <p className="ui-dialog__subtitle">{subtitle}</p>}
            </div>
            <IconButton label="Fermer" disabled={!dismissable} onClick={onClose}>
              <IconClose size={15} />
            </IconButton>
          </header>
          <div className="ui-dialog__body">{children}</div>
          {footer && <footer className="ui-dialog__footer">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

export function Modal({ size = 'md', ...props }: ModalProps) {
  return <Dialog variant="modal" size={size} {...props} />;
}

export interface SheetProps extends Omit<ModalProps, 'size'> {
  /** Défaut 480. */
  width?: number;
}

/** Panneau latéral droit, pleine hauteur (remplace Drawer). */
export function Sheet({ width = 480, ...props }: SheetProps) {
  return <Dialog variant="sheet" style={{ width }} {...props} />;
}
