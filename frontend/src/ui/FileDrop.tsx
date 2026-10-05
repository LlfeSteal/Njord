// Zone de dépôt de fichier (remplace Dropzone). Styles dans FileDrop.css.
// Un seul fichier ; extension vérifiée sans tenir compte de la casse ; taille bornée par maxSize.
import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Spinner } from './Feedback';
import { IconImport } from './Icons';
import { cx, marginStyle, type BaseProps } from './types';
import './FileDrop.css';

export interface FileDropProps extends BaseProps {
  /** Appelé avec le fichier accepté (un seul). */
  onFile: (file: File) => void;
  /** Appelé avec un motif lisible (« Format non accepté : .csv », « Fichier trop volumineux (max 20 Mo) »). */
  onReject?: (reason: string) => void;
  /** Extensions acceptées, ex. ['.xlsx']. */
  accept: string[];
  /** Taille max en octets. */
  maxSize?: number;
  disabled?: boolean;
  /** Affiche un Spinner et désactive la zone. */
  loading?: boolean;
  /** Contenu personnalisé ; défaut : icône import + « Déposer un fichier ou cliquer pour choisir » + extensions. */
  children?: ReactNode;
}

/** Taille lisible en français : « 20 Mo », « 1,5 Mo », « 500 Ko ». */
function formatSize(bytes: number): string {
  const mo = bytes / (1024 * 1024);
  if (mo >= 1) return `${Number(mo.toFixed(1)).toLocaleString('fr-FR')} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('fr-FR')} Ko`;
}

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

/** Zone en pointillés, cliquable et accessible au clavier (Entrée/Espace ouvre le sélecteur). */
export function FileDrop({ onFile, onReject, accept, maxSize, disabled, loading, children, mt, mb, className, style }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const off = disabled || loading;
  const accepted = accept.map((a) => a.toLowerCase());

  const take = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      onReject?.('Un seul fichier à la fois');
      return;
    }
    const file = files[0];
    const ext = extension(file.name);
    if (accepted.length && !accepted.includes(ext)) {
      onReject?.(`Format non accepté : ${ext || 'sans extension'} (attendu : ${accept.join(', ')})`);
      return;
    }
    if (maxSize != null && file.size > maxSize) {
      onReject?.(`Fichier trop volumineux (max ${formatSize(maxSize)})`);
      return;
    }
    onFile(file);
  };

  const open = () => {
    if (!off) inputRef.current?.click();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (off || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Ignore les passages d'un enfant à l'autre.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (!off) take(e.dataTransfer.files);
  };

  return (
    <div
      role="button"
      tabIndex={off ? -1 : 0}
      aria-disabled={off || undefined}
      aria-busy={loading || undefined}
      className={cx('ui-filedrop', className)}
      data-over={over || undefined}
      data-disabled={disabled || undefined}
      data-loading={loading || undefined}
      style={marginStyle({ mt, mb }, style)}
      onClick={open}
      onKeyDown={onKeyDown}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        hidden
        tabIndex={-1}
        disabled={off}
        onChange={(e) => {
          take(e.target.files);
          // Permet de choisir à nouveau le même fichier.
          e.target.value = '';
        }}
      />
      {/* En chargement, le contenu reste en place (masqué) pour garder la hauteur. */}
      <div className="ui-filedrop__content">
        {children ?? (
          <>
            <IconImport size={40} className="ui-filedrop__icon" />
            <span className="ui-filedrop__title">Déposer un fichier ou cliquer pour choisir</span>
            <span className="ui-filedrop__hint">
              {accept.join(', ')}
              {maxSize != null && ` · ${formatSize(maxSize)} max`}
            </span>
          </>
        )}
      </div>
      {loading && (
        <span className="ui-filedrop__spinner">
          <Spinner size={24} />
        </span>
      )}
    </div>
  );
}
