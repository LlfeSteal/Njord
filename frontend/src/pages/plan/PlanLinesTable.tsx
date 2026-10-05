// Table des lignes d'une version de plan (tri cliquable, statuts inactif / warn / drop).
import { Group, IconButton, SortHeader, Table, Text, Tooltip, VisuallyHidden } from '../../ui';
import { IconUserPlus } from '../../ui/Icons';
import type { PlanLine } from '../../api/types';
import { InactiveBadge, ParsingBadge } from '../../components/badges';
import { fmtDate, fmtEur, fmtHours, fmtPct } from '../../lib/format';
import type { SortKey, SortOrder } from './useLineFilters';

const KIND_LABEL: Record<PlanLine['ressource_kind'], string> = {
  internal: 'interne',
  external: 'externe',
  unknown: 'inconnue',
};

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
  if (!sortKey)
    return (
      <th data-nowrap data-align={alignRight ? 'right' : undefined}>
        {label}
      </th>
    );
  return (
    <SortHeader
      active={sort === sortKey}
      dir={order}
      onSort={() => onSort(sortKey)}
      align={alignRight ? 'right' : undefined}
    >
      {label}
    </SortHeader>
  );
}

function AliasAction({ line: l, onAlias }: { line: PlanLine; onAlias: (l: PlanLine) => void }) {
  if (l.personne_id)
    return (
      <IconButton label={`Créer un alias personne (ligne ${l.row_num})`} onClick={() => onAlias(l)}>
        <IconUserPlus size={15} />
      </IconButton>
    );
  // Bouton désactivé : la bulle explique pourquoi.
  return (
    <Tooltip label="Ressource non rattachée à une fiche personne">
      <IconButton label={`Créer un alias personne (ligne ${l.row_num})`} disabled>
        <IconUserPlus size={15} />
      </IconButton>
    </Tooltip>
  );
}

/** « NOM Prénom » extrait du libellé ; le libellé brut reste consultable en bulle d'aide. */
function NomPrenomCell({ line }: { line: PlanLine }) {
  const value = line.nom_prenom || '—';
  if (!line.libelle || line.libelle === line.nom_prenom) return <>{value}</>;
  return (
    <Tooltip label={`Libellé : ${line.libelle}`}>
      <span>{value}</span>
    </Tooltip>
  );
}

export default function PlanLinesTable({ items, sort, order, onSort, squadName, onAlias, dimmed }: Props) {
  const th = { sort, order, onSort };
  return (
    <Table striped hover minWidth={1350} style={dimmed ? { opacity: 0.6 } : undefined}>
      <thead>
        <tr>
          <Th label="N°" sortKey="row_num" {...th} />
          <Th label="CT" sortKey="ct" {...th} />
          <Th label="Ressource" sortKey="ressource" {...th} />
          <Th label="Nom Prénom" {...th} />
          <Th label="Squad / groupe" {...th} />
          <Th label="Ligne de coût" {...th} />
          <Th label="Charge totale" sortKey="charge_totale" alignRight {...th} />
          <Th label="PPS" sortKey="pps" alignRight {...th} />
          <Th label="%" alignRight {...th} />
          <Th label="Unité" {...th} />
          <Th label="Dates" sortKey="date_debut" {...th} />
          <Th label="Statut" {...th} />
          <th>
            <VisuallyHidden>Actions</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && (
          <tr>
            <td colSpan={13}>
              <Text tone="secondary" align="center" style={{ padding: '12px 0' }}>
                Aucune ligne ne correspond aux filtres.
              </Text>
            </td>
          </tr>
        )}
        {items.map((l) => {
          const dropped = l.statut_parsing === 'drop';
          const squad = squadName(l.squad_id);
          return (
            <tr key={l.id} data-strike={dropped || undefined}>
              <td>
                <Text as="span" tone="secondary" tabular>
                  {l.row_num}
                </Text>
              </td>
              <td data-mono data-nowrap>
                {l.ct}
              </td>
              <td>
                <Group gap={6} wrap={false}>
                  <Text as="span" mono style={{ whiteSpace: 'nowrap' }}>
                    {l.ressource}
                  </Text>
                  {l.inactive && <InactiveBadge />}
                </Group>
                <Text size="sm" tone="secondary">
                  {KIND_LABEL[l.ressource_kind] ?? l.ressource_kind}
                </Text>
              </td>
              <td>
                <NomPrenomCell line={l} />
              </td>
              <td>
                {squad || (l.groupe ? '' : '—')}
                {l.groupe && l.groupe !== squad && (
                  <Text size="sm" tone="secondary">
                    {l.groupe}
                  </Text>
                )}
              </td>
              <td>
                <Text size="sm">{l.ligne_cout}</Text>
              </td>
              <td data-align="right" data-nowrap>
                {fmtHours(l.charge_totale)}
              </td>
              <td data-align="right" data-nowrap>
                {fmtEur(l.pps)}
              </td>
              <td data-align="right" data-nowrap>
                {fmtPct(l.pourcentage)}
              </td>
              <td data-mono data-nowrap>
                {l.unite || '—'}
              </td>
              <td data-nowrap>
                {fmtDate(l.date_debut)} → {fmtDate(l.date_fin)}
              </td>
              <td>
                {l.statut_parsing === 'ok' ? (
                  <Text as="span" size="sm" tone="secondary">
                    ok
                  </Text>
                ) : (
                  <ParsingBadge statut={l.statut_parsing} motif={l.motif_rejet || undefined} />
                )}
              </td>
              <td data-actions>
                <AliasAction line={l} onAlias={onAlias} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
