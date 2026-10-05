// Types partagés du kit UI (CONTRAT FIGÉ — cf. docs/STYLE.md).
import type { CSSProperties } from 'react';

/** Échelle d'espacement du guide (px). Correspondance Mantine : xs→4, sm→8, md→12, lg→16, xl→24. */
export type Space = 0 | 2 | 4 | 6 | 8 | 12 | 16 | 24 | 32 | 48 | 64;

/** Marges externes communes aux primitives de mise en page et de texte. */
export interface MarginProps {
  mt?: Space;
  mb?: Space;
}

export interface BaseProps extends MarginProps {
  className?: string;
  style?: CSSProperties;
}

/** Tons sémantiques → tokens (§2.3). Jamais de couleur littérale dans les pages. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'attention';

/** Ton des flags et statuts métier (mappés dans les CSS sur --flag-* / --statut-*). */
export type FlagTone = 'conforme' | 'hors_plan' | 'sur_imputation' | 'sous_imputation' | 'absence';

/** Formes de glyphe de statut (§9) — la forme porte le sens. */
export type GlyphKind = 'warning' | 'danger' | 'attention' | 'success' | 'none' | 'info' | 'dot' | 'ring';

/** Option d'un Select / MultiSelect / SegmentedControl. */
export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** Ligne secondaire dans le menu. */
  description?: string;
  /** Intitulé de section (les options consécutives de même groupe sont regroupées). */
  group?: string;
  disabled?: boolean;
}

/** Convertit une valeur d'espacement en style inline. */
export function marginStyle({ mt, mb }: MarginProps, style?: CSSProperties): CSSProperties | undefined {
  if (mt == null && mb == null) return style;
  return { marginTop: mt, marginBottom: mb, ...style };
}

/** Concatène des classes en ignorant les valeurs vides. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
