// Table des lignes d'une version de plan : une ligne par cellule, anomalies teintées avec glyphe de tête,
// totaux en pied. Le détail complet d'une ligne s'ouvre dans l'inspecteur (clic sur la ligne).
import { SortHeader, StatusGlyph, Table, Text, Tooltip, VisuallyHidden } from '../../ui';
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
  onSelect: (l: PlanLine) => void;
  selectedId: number | null;
  dimmed?: boolean;
}

const COLS = 8; // glyphe + 7 colonnes

/** Glyphe de tête d'une ligne en anomalie ; motif en bulle d'aide. */
export function ParsingGlyph({ line: l, size }: { line: PlanLine; size?: number }) {
  if (l.statut_parsing === 'ok') return null;
  const warn = l.statut_parsing === 'warn';
  const label = l.motif_rejet || (warn ? 'Ligne à vérifier' : 'Ligne rejetée');
  return <StatusGlyph kind={warn ? 'warning' : 'danger'} tone={warn ? 'warning' : 'danger'} size={size} label={label} />;
}

/** Ressource sur une ligne : « NOM Prénom » (l'identité), « Non nominative » sinon, + mention inactif. */
export function RessourceLabel({ line: l }: { line: PlanLine }) {
  return (
    <span className="plan-res">
      {l.nom_prenom ? (
        <span>{l.nom_prenom}</span>
      ) : (
        <span className="plan-res__none" title={l.libelle || undefined}>
          Non nominative
        </span>
      )}
      {l.inactive && (
        <span className="plan-res__inactive">
          <InactiveBadge />
        </span>
      )}
    </span>
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
          {sh('nom_prenom', 'Ressource')}
          <th>Squad</th>
          {sh('charge_totale', 'Charge', 'right')}
          {sh('pps', 'PPS', 'right')}
          <th data-align="right">%</th>
          {sh('date_debut', 'Dates')}
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
          <td colSpan={2} />
        </tr>
      </tfoot>
    </Table>
  );
}
