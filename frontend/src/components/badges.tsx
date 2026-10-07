// Statuts partagés : statut de version, statut de parsing, flag d'analyse, inactif.
// Tags sobres (glyphe dont la forme porte le sens + libellé) — cf. docs/STYLE.md §8.
import { StatusGlyph, Tag, Tooltip, type GlyphKind } from '../ui';
import type { Flag, ParsingStatut, VersionStatut } from '../api/types';

const STATUT: Record<VersionStatut, { label: string; glyph: GlyphKind }> = {
  active: { label: 'Active', glyph: 'dot' },
  archivee: { label: 'Archivée', glyph: 'dot' },
  purgee: { label: 'Purgée', glyph: 'ring' },
};

export function StatusBadge({ statut }: { statut: VersionStatut }) {
  const s = STATUT[statut];
  return (
    <Tag tone={statut} glyph={s.glyph} strike={statut === 'purgee'}>
      {s.label}
    </Tag>
  );
}

export function ParsingBadge({ statut, motif }: { statut: ParsingStatut; motif?: string }) {
  if (statut === 'ok') return null;
  const tag =
    statut === 'warn' ? (
      <Tag tone="warning" glyph="warning">
        warn
      </Tag>
    ) : (
      <Tag tone="danger" glyph="danger" strike>
        drop
      </Tag>
    );
  return motif ? <Tooltip label={motif}>{tag}</Tooltip> : tag;
}

/** Libellé et glyphe de chaque flag ; la couleur vient du token --flag-<flag> (via `tone`). */
export const FLAG_META: Record<Flag, { label: string; glyph: GlyphKind }> = {
  absence: { label: 'Absence totale', glyph: 'none' },
  hors_plan: { label: 'Hors plan', glyph: 'warning' },
  erreur_ct: { label: 'Erreur de CT', glyph: 'swap' },
  sur_imputation: { label: 'Sur-imputation', glyph: 'danger' },
  sous_imputation: { label: 'Sous-imputation', glyph: 'attention' },
  conforme: { label: 'Conforme', glyph: 'success' },
};

/** Glyphe seul d'un flag (15 px), avec libellé accessible. */
export function FlagGlyph({ flag, size }: { flag: Flag; size?: number }) {
  const m = FLAG_META[flag];
  return <StatusGlyph kind={m.glyph} tone={flag} size={size} label={m.label} />;
}

export function FlagBadge({ flag, compact = false }: { flag: Flag; compact?: boolean }) {
  const m = FLAG_META[flag];
  if (compact) return <FlagGlyph flag={flag} />;
  return (
    <Tag tone={flag} glyph={m.glyph}>
      {m.label}
    </Tag>
  );
}

export function InactiveBadge() {
  return (
    <Tag tone="neutral" glyph="ring" title="Personne inactive dans le référentiel">
      inactif
    </Tag>
  );
}
