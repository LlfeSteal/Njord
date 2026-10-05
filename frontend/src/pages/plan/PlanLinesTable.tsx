// Table des lignes d'une version de plan (tri cliquable, badges inactif / warn / drop).
import type { CSSProperties } from 'react';
import { ActionIcon, Group, Table, Text, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector, IconUserPlus } from '@tabler/icons-react';
import type { PlanLine } from '../../api/types';
import { InactiveBadge, ParsingBadge } from '../../components/badges';
import { fmtDate, fmtEur, fmtHours, fmtPct } from '../../lib/format';
import type { SortKey, SortOrder } from './useLineFilters';

const KIND_LABEL: Record<PlanLine['ressource_kind'], string> = {
  internal: 'interne',
  external: 'externe',
  unknown: 'inconnue',
};

const nowrap: CSSProperties = { whiteSpace: 'nowrap' };
const right: CSSProperties = { textAlign: 'right', whiteSpace: 'nowrap' };

interface Props {
  items: PlanLine[];
  sort: SortKey;
  order: SortOrder;
  onSort: (k: SortKey) => void;
  squadName: (id: string | null) => string;
  onAlias: (l: PlanLine) => void;
  dimmed?: boolean;
}

function Th({
  label,
  sortKey,
  sort,
  order,
  onSort,
  alignRight,
}: {
  label: string;
  sortKey?: SortKey;
  sort: SortKey;
  order: SortOrder;
  onSort: (k: SortKey) => void;
  alignRight?: boolean;
}) {
  const style = alignRight ? right : nowrap;
  if (!sortKey) return <Table.Th style={style}>{label}</Table.Th>;
  const active = sort === sortKey;
  const Icon = active ? (order === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
  return (
    <Table.Th style={style} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <UnstyledButton
        onClick={() => onSort(sortKey)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, fontSize: 'inherit' }}
        title={`Trier par ${label.toLowerCase()}`}
      >
        {label}
        <Icon size={14} stroke={1.5} style={{ opacity: active ? 1 : 0.5 }} />
      </UnstyledButton>
    </Table.Th>
  );
}

export default function PlanLinesTable({ items, sort, order, onSort, squadName, onAlias, dimmed }: Props) {
  const th = { sort, order, onSort };
  return (
    <Table.ScrollContainer minWidth={1350}>
      <Table striped highlightOnHover verticalSpacing="xs" fz="sm" style={{ opacity: dimmed ? 0.6 : 1 }}>
        <Table.Thead>
          <Table.Tr>
            <Th label="N°" sortKey="row_num" {...th} />
            <Th label="CT" sortKey="ct" {...th} />
            <Th label="Ressource" sortKey="ressource" {...th} />
            <Th label="Libellé" {...th} />
            <Th label="Squad / groupe" {...th} />
            <Th label="Ligne de coût" {...th} />
            <Th label="Charge totale" sortKey="charge_totale" alignRight {...th} />
            <Th label="PPS" sortKey="pps" alignRight {...th} />
            <Th label="%" alignRight {...th} />
            <Th label="Unité" {...th} />
            <Th label="Dates" sortKey="date_debut" {...th} />
            <Th label="Statut" {...th} />
            <Table.Th>
              <VisuallyHidden>Actions</VisuallyHidden>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={13}>
                <Text c="dimmed" ta="center" py="md">
                  Aucune ligne ne correspond aux filtres.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {items.map((l) => {
            const dropped = l.statut_parsing === 'drop';
            const squad = squadName(l.squad_id);
            return (
              <Table.Tr
                key={l.id}
                style={dropped ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}
              >
                <Table.Td style={{ color: 'var(--mantine-color-dimmed)' }}>{l.row_num}</Table.Td>
                <Table.Td style={{ ...nowrap, fontFamily: 'monospace' }}>{l.ct}</Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" ff="monospace" style={nowrap}>
                      {l.ressource}
                    </Text>
                    {l.inactive && <InactiveBadge />}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {KIND_LABEL[l.ressource_kind] ?? l.ressource_kind}
                  </Text>
                </Table.Td>
                <Table.Td>{l.libelle || '—'}</Table.Td>
                <Table.Td>
                  {squad || (l.groupe ? '' : '—')}
                  {l.groupe && l.groupe !== squad && (
                    <Text size="xs" c="dimmed">
                      {l.groupe}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{l.ligne_cout}</Text>
                </Table.Td>
                <Table.Td style={right}>{fmtHours(l.charge_totale)}</Table.Td>
                <Table.Td style={right}>{fmtEur(l.pps)}</Table.Td>
                <Table.Td style={right}>{fmtPct(l.pourcentage)}</Table.Td>
                <Table.Td style={{ ...nowrap, fontFamily: 'monospace' }}>{l.unite || '—'}</Table.Td>
                <Table.Td style={nowrap}>
                  {fmtDate(l.date_debut)} → {fmtDate(l.date_fin)}
                </Table.Td>
                <Table.Td>
                  {l.statut_parsing === 'ok' ? (
                    <Text size="xs" c="dimmed">
                      ok
                    </Text>
                  ) : (
                    <ParsingBadge statut={l.statut_parsing} motif={l.motif_rejet || undefined} />
                  )}
                </Table.Td>
                <Table.Td style={{ textDecoration: 'none' }}>
                  <Tooltip
                    label={
                      l.personne_id
                        ? 'Créer un alias personne'
                        : 'Ressource non rattachée à une fiche personne'
                    }
                    withArrow
                  >
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Créer un alias personne (ligne ${l.row_num})`}
                      data-disabled={!l.personne_id || undefined}
                      aria-disabled={!l.personne_id}
                      onClick={() => l.personne_id && onAlias(l)}
                    >
                      <IconUserPlus size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

