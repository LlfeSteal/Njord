// Badges partagés : statut de version, statut de parsing, flag d'analyse, inactif.
import { Badge, Tooltip } from '@mantine/core';
import type { Flag, ParsingStatut, VersionStatut } from '../api/types';

const STATUT: Record<VersionStatut, { label: string; color: string }> = {
  active: { label: 'Active', color: 'green' },
  archivee: { label: 'Archivée', color: 'gray' },
  purgee: { label: 'Purgée', color: 'red' },
};

export function StatusBadge({ statut }: { statut: VersionStatut }) {
  const s = STATUT[statut];
  return (
    <Badge color={s.color} variant="light">
      {s.label}
    </Badge>
  );
}

export function ParsingBadge({ statut, motif }: { statut: ParsingStatut; motif?: string }) {
  if (statut === 'ok') return null;
  const badge =
    statut === 'warn' ? (
      <Badge color="yellow" variant="light">
        warn
      </Badge>
    ) : (
      <Badge color="red" variant="light" style={{ textDecoration: 'line-through' }}>
        drop
      </Badge>
    );
  return motif ? (
    <Tooltip label={motif} multiline maw={360} withArrow>
      {badge}
    </Tooltip>
  ) : (
    badge
  );
}

export const FLAG_META: Record<Flag, { emoji: string; label: string; color: string }> = {
  absence: { emoji: '⚫', label: 'Absence totale', color: 'dark' },
  hors_plan: { emoji: '🟠', label: 'Hors plan', color: 'orange' },
  sur_imputation: { emoji: '🔴', label: 'Sur-imputation', color: 'red' },
  sous_imputation: { emoji: '🟣', label: 'Sous-imputation', color: 'grape' },
  conforme: { emoji: '🟢', label: 'Conforme', color: 'green' },
};

export function FlagBadge({ flag, compact = false }: { flag: Flag; compact?: boolean }) {
  const m = FLAG_META[flag];
  return (
    <Badge color={m.color} variant="light" leftSection={m.emoji}>
      {compact ? null : m.label}
    </Badge>
  );
}

export function InactiveBadge() {
  return (
    <Badge color="gray" variant="outline" size="sm">
      [inactif]
    </Badge>
  );
}
