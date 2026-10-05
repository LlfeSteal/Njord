// Icônes au trait (§9) : viewBox 24, trait 1.8, bouts ronds, currentColor, aria-hidden.
// Dessin dans l'esprit SF Symbols / Lucide : peu de tracés, lisibles à 14–16 px.
import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
  /** Défaut 16. */
  size?: number;
  /** Épaisseur du trait (défaut 1.8). */
  stroke?: number;
  className?: string;
  style?: CSSProperties;
  /** Si fourni, l'icône devient porteuse de sens : role="img" + aria-label + title. */
  label?: string;
}

/** Gabarit commun : enveloppe SVG ; `children` = tracés dans un viewBox 24 × 24. */
export function SvgIcon({ size = 16, stroke = 1.8, className, style, label, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {label && <title>{label}</title>}
      {children}
    </svg>
  );
}

// ------------------------------------------------------------------ Navigation

export function IconChevronRight(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </SvgIcon>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </SvgIcon>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M5.5 9 12 15.5 18.5 9" />
    </SvgIcon>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M5.5 15 12 8.5l6.5 6.5" />
    </SvgIcon>
  );
}

/** Chevrons haut/bas (tri inactif, pop-up). */
export function IconSelector(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
      <path d="m7.5 14.5 4.5 4.5 4.5-4.5" />
    </SvgIcon>
  );
}

export function IconArrowLeft(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M19 12H5" />
      <path d="m11 5-7 7 7 7" />
    </SvgIcon>
  );
}

export function IconExternalLink(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </SvgIcon>
  );
}

export function IconCornerDownRight(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M5 4v7a4 4 0 0 0 4 4h11" />
      <path d="m15 10 5 5-5 5" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Champs et dialogues

export function IconSearch(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </SvgIcon>
  );
}

/** Cercle plein (tertiaire) avec croix couleur carte — bouton « effacer » des champs. */
export function IconClear(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="m8.75 8.75 6.5 6.5M15.25 8.75l-6.5 6.5" strokeWidth={2.2} style={{ stroke: 'var(--card)' }} />
    </SvgIcon>
  );
}

export function IconClose(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </SvgIcon>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Édition et cycle de vie

export function IconPlus(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M12 5v14M5 12h14" />
    </SvgIcon>
  );
}

export function IconPencil(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4Z" />
      <path d="m14.5 6.5 3 3" />
    </SvgIcon>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
      <path d="M6 6.5 7 19a2 2 0 0 0 2 1.5h6a2 2 0 0 0 2-1.5l1-12.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </SvgIcon>
  );
}

export function IconArchive(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" />
      <path d="M10 12.5h4" />
    </SvgIcon>
  );
}

/** Désarchiver : boîte avec flèche montante. */
export function IconRestore(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <path d="M5 8.5V18a2 2 0 0 0 2 2h2M19 8.5V18a2 2 0 0 1-2 2h-2" />
      <path d="m9 15 3-3 3 3M12 12v8" />
    </SvgIcon>
  );
}

export function IconUndo(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </SvgIcon>
  );
}

/** Fusion (alias) : deux branches qui se rejoignent. */
export function IconMerge(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5V20" />
      <path d="M6 9a9 9 0 0 0 9.5 9" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Fichiers

/** Import : flèche qui entre dans un plateau. */
export function IconImport(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M8 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3" />
    </SvgIcon>
  );
}

export function IconUpload(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M20 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </SvgIcon>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M20 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </SvgIcon>
  );
}

export function IconSave(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 4v4h7V4" />
      <path d="M7.5 20v-6h9v6" />
    </SvgIcon>
  );
}

export function IconFileSpreadsheet(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 12.5h7v5h-7ZM8.5 15h7M12 12.5v5" />
    </SvgIcon>
  );
}

export function IconEye(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Filtres, réglages

/** Entonnoir barré d'une croix : réinitialiser les filtres. */
export function IconFilterOff(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M13 5H4l6.5 7.5V19l3 1.5v-8l1-1.2" />
      <path d="m16.5 4.5 4.5 4.5M21 4.5 16.5 9" />
    </SvgIcon>
  );
}

export function IconColumns(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9.2 4v16M14.8 4v16" />
    </SvgIcon>
  );
}

export function IconSliders(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <path d="M15 4v4M9 10v4M17 16v4" />
    </SvgIcon>
  );
}

/** Historique : horloge dans une flèche anti-horaire. */
export function IconHistory(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M3.5 12A8.5 8.5 0 1 0 6 6" />
      <path d="M3.5 3.5V8H8" />
      <path d="M12 7.5V12l3 2" />
    </SvgIcon>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5" />
      <path d="M4 4v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.5l1.7-2" />
      <path d="M20 20v-4.5h-4.5" />
    </SvgIcon>
  );
}

export function IconCalendar(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Personnes

export function IconUser(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </SvgIcon>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4" />
      <path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
    </SvgIcon>
  );
}

export function IconUserPlus(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20a6.5 6.5 0 0 1 13 0" />
      <path d="M19 8v6M16 11h6" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Information

export function IconInfo(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.1" strokeWidth={(p.stroke ?? 1.8) + 0.6} />
    </SvgIcon>
  );
}

/** Triangle au trait (bannières). */
export function IconWarning(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M10.3 4.2 2.9 17.5a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5" />
      <path d="M12 17.3v.1" strokeWidth={(p.stroke ?? 1.8) + 0.6} />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Apparence

export function IconSun(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </SvgIcon>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z" />
    </SvgIcon>
  );
}

/** Cercle à moitié plein (Automatique). */
export function IconAuto(p: IconProps) {
  return (
    <SvgIcon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
    </SvgIcon>
  );
}

// ------------------------------------------------------------------ Marque

/** Trois traits horizontaux décalés (trait 2.4) — icône d'app, états vides. */
export function IconTimeline({ stroke = 2.4, ...p }: IconProps) {
  return (
    <SvgIcon {...p} stroke={stroke}>
      <path d="M4 6.5h10M8 12h12M6 17.5h8" />
    </SvgIcon>
  );
}
