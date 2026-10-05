// Briques partagées des sous-onglets Analyse : palette graphique, en-têtes triables, cartes KPI, badges.
import { useState, type ReactNode } from 'react';
import { Badge, Card, Group, Stack, Table, Text, Tooltip, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { Confidence, Flag } from '../../api/types';

// ------------------------------------------------------------------ Palette graphique (skill dataviz)
// Catégoriel slots 1-2 (bleu/orange) validés clair & sombre ; « autre » en gris neutre ;
// flags = couleurs d'état fixes, toujours accompagnées de l'emoji + libellé.
export function useChartPalette() {
  const dark = useComputedColorScheme('light', { getInitialValueInEffect: false }) === 'dark';
  return {
    dark,
    series1: dark ? '#3987e5' : '#2a78d6',
    series2: dark ? '#d95926' : '#eb6834',
    other: '#898781',
    text: dark ? '#c3c2b7' : '#52514e',
    grid: dark ? '#2c2c2a' : '#e1e0d9',
    surface: dark ? '#242424' : '#ffffff',
    flag: {
      absence: dark ? '#c3c2b7' : '#52514e',
      hors_plan: '#ec835a',
      sur_imputation: '#d03b3b',
      sous_imputation: dark ? '#9085e9' : '#4a3aa7',
      conforme: '#0ca30c',
    } satisfies Record<Flag, string>,
  };
}

// ------------------------------------------------------------------ Tri
export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  return { sort, toggle, setSort };
}

export function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  align,
}: {
  k: K;
  sort: SortState<K>;
  onSort: (k: K) => void;
  children: ReactNode;
  align?: 'right';
}) {
  const active = sort.key === k;
  const Icon = !active ? IconSelector : sort.dir === 'asc' ? IconChevronUp : IconChevronDown;
  return (
    <Table.Th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ whiteSpace: 'nowrap', textAlign: align }}
    >
      <UnstyledButton onClick={() => onSort(k)} style={{ font: 'inherit', fontWeight: 600 }}>
        <Group gap={4} wrap="nowrap" justify={align === 'right' ? 'flex-end' : 'flex-start'}>
          {children}
          <Icon size={14} stroke={1.5} aria-hidden />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

// ------------------------------------------------------------------ Cartes KPI
export function StatCard({
  label,
  value,
  sub,
  children,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  accent?: string;
}) {
  return (
    <Card withBorder padding="md" radius="md" style={accent ? { borderLeft: `3px solid var(--mantine-color-${accent}-6)` } : undefined}>
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        <Text fz={28} fw={600} lh={1.15}>
          {value}
        </Text>
        {sub && (
          <Text size="xs" c="dimmed">
            {sub}
          </Text>
        )}
        {children}
      </Stack>
    </Card>
  );
}

// ------------------------------------------------------------------ Confiance de correspondance
export const CONFIDENCE_META: Record<Confidence, { label: string; color: string; hint: string }> = {
  matricule: { label: 'Matricule', color: 'green', hint: 'Correspondance directe par matricule' },
  alias: { label: 'Alias', color: 'blue', hint: 'Alias du référentiel Personne' },
  fuzzy: { label: 'Approximative *', color: 'yellow', hint: 'Correspondance approximative (nom normalisé) — à confirmer' },
  none: { label: 'Aucune', color: 'orange', hint: 'Écriture non rapprochée → 🟠 Hors plan' },
  plan: { label: 'Plan seul', color: 'gray', hint: 'Ressource présente au plan uniquement' },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const m = CONFIDENCE_META[confidence];
  return (
    <Tooltip label={m.hint} withArrow>
      <Badge color={m.color} variant="light">
        {m.label}
      </Badge>
    </Tooltip>
  );
}

/** Astérisque des correspondances approximatives. */
export function FuzzyMark() {
  return (
    <Tooltip label="Correspondance approximative (nom normalisé)" withArrow>
      <Text component="span" c="yellow.8" fw={700} aria-label="correspondance approximative (nom normalisé)" style={{ cursor: 'help' }}>
        *
      </Text>
    </Tooltip>
  );
}

export function CtCell({ ct, libelle }: { ct: string; libelle?: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm" ff="monospace">
        {ct}
      </Text>
      {libelle && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {libelle}
        </Text>
      )}
    </Stack>
  );
}

/** Couleur Mantine de l'écart signé (le signe « + / − » porte aussi l'information). */
export function ecartColor(flag: Flag, ecart: number): string | undefined {
  if (flag === 'sur_imputation') return 'red.7';
  if (flag === 'sous_imputation') return 'grape.7';
  if (ecart === 0) return 'dimmed';
  return undefined;
}

export const paginate = <T,>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size);
