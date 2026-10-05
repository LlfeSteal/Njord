// Table des lignes d'une version de plan : une ligne par cellule, anomalies teintées avec glyphe de tête,
// totaux en pied. Le détail complet d'une ligne s'ouvre dans l'inspecteur (clic sur la ligne).
import type { MouseEvent } from 'react';
import { IconButton, SortHeader, StatusGlyph, Table, Text, Tooltip, VisuallyHidden } from '../../ui';
import { IconUserPlus } from '../../ui/Icons';
import type { PlanLine } from '../../api/types';
import { InactiveBadge } from '../../components/badges';
import { fmtEur, fmtHours, fmtPct } from '../../lib/format';
import { fmtRange, plural } from '../../components/lifecycle/lifecycleUtils';
import type { SortKey, SortOrder } from './useLineFilters';
import './plan.css';

interface Props {
  items: PlanLine[];
  total: number;
  totals: { charge_totale: number; pps: number };
  sort: SortKey;
  order: SortOrder;
  onSort: (k: SortKey) => void;
  /** Nom de la squad la plus interne / chemin complet du groupe. */
  squadName: (id: string | null) => string;
  squadPath: (id: string | null) => string;
  onAlias: (l: PlanLine) => void;
  onSelect: (l: PlanLine) => void;
  selectedId: number | null;
  dimmed?: boolean;
}

const COLS = 9; // glyphe + 7 colonnes + actions

const stop = (e: MouseEvent) => e.stopPropagation();

/** Glyphe de tête d'une ligne en anomalie ; motif en bulle d'aide. */
export function ParsingGlyph({ line: l, size }: { line: PlanLine; size?: number }) {
  if (l.statut_parsing === 'ok') return null;
  const warn = l.statut_parsing === 'warn';
  const label = l.motif_rejet || (warn ? 'Ligne à vérifier' : 'Ligne rejetée');
  return <StatusGlyph kind={warn ? 'warning' : 'danger'} tone={warn ? 'warning' : 'danger'} size={size} label={label} />;
}

/** Ressource sur une ligne : « CODE (NOM Prénom) » + mention inactif. */
export function RessourceLabel({ line: l }: { line: PlanLine }) {
  return (
    <span className="plan-res">
      <span className="plan-res__code">{l.ressource}</span>
      {l.nom_prenom && <span className="plan-res__name"> ({l.nom_prenom})</span>}
      {l.inactive && (
        <span className="plan-res__inactive">
          <InactiveBadge />
        </span>
      )}
    </span>
  );
}

function AliasAction({ line: l, onAlias }: { line: PlanLine; onAlias: (l: PlanLine) => void }) {
  if (l.personne_id)
    return (
      <IconButton label="Créer un alias personne" onClick={() => onAlias(l)}>
        <IconUserPlus size={15} />
      </IconButton>
    );
  // Bouton désactivé : la bulle explique pourquoi.
  return (
    <Tooltip label="Ressource non rattachée à une fiche personne">
      <IconButton label="Créer un alias personne" disabled>
        <IconUserPlus size={15} />
      </IconButton>
    </Tooltip>
  );
}

export default function PlanLinesTable({
  items,
  total,
  totals,
  sort,
  order,
  onSort,
  squadName,
  squadPath,
  onAlias,
  onSelect,
  selectedId,
  dimmed,
}: Props) {
  const sh = (k: SortKey, label: string, align?: 'right') => (
    <SortHeader active={sort === k} dir={order} onSort={() => onSort(k)} align={align}>
      {label}
    </SortHeader>
  );
  return (
    <Table striped className="plan-table" minWidth={900} style={dimmed ? { opacity: 0.6 } : undefined}>
      <thead>
        <tr>
          <th data-glyph>
            <VisuallyHidden>Contrôle</VisuallyHidden>
          </th>
          {sh('ct', 'CT')}
          {sh('ressource', 'Ressource')}
          <th>Squad</th>
          {sh('charge_totale', 'Charge', 'right')}
          {sh('pps', 'PPS', 'right')}
          <th data-align="right">%</th>
          {sh('date_debut', 'Dates')}
          <th>
            <VisuallyHidden>Actions</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && (
          <tr>
            <td colSpan={COLS}>
              <Text tone="secondary" align="center">
                Aucune ligne ne correspond aux filtres.
              </Text>
            </td>
          </tr>
        )}
        {items.map((l) => {
          const squad = squadName(l.squad_id) || l.groupe;
          const path = squadPath(l.squad_id) || l.groupe;
          const tone = l.statut_parsing === 'warn' ? 'warning' : l.statut_parsing === 'drop' ? 'danger' : undefined;
          return (
            <tr
              key={l.id}
              data-tone={tone}
              data-clickable
              data-selected={selectedId === l.id || undefined}
              onClick={() => onSelect(l)}
            >
              <td data-glyph>
                <ParsingGlyph line={l} />
              </td>
              <td data-mono data-nowrap>
                {l.ct}
              </td>
              <td data-nowrap>
                <RessourceLabel line={l} />
              </td>
              <td className="plan-table__squad">
                {squad ? (
                  <Tooltip label={path} disabled={!path || path === squad} delay={300}>
                    <span className="plan-table__ellipsis">{squad}</span>
                  </Tooltip>
                ) : (
                  '—'
                )}
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
              <td data-nowrap>{fmtRange(l.date_debut, l.date_fin)}</td>
              <td data-actions onClick={stop}>
                <AliasAction line={l} onAlias={onAlias} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} data-nowrap>
            Total · {plural(total, 'ligne')}
          </td>
          <td data-align="right" data-nowrap>
            {fmtHours(totals.charge_totale)}
          </td>
          <td data-align="right" data-nowrap>
            {fmtEur(totals.pps)}
          </td>
          <td colSpan={3} />
        </tr>
      </tfoot>
    </Table>
  );
}
