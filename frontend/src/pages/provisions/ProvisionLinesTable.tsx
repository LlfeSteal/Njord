// Table des lignes d'une version de provisions : une ligne par cellule, anomalies teintées avec glyphe
// de tête, total en pied. Le détail complet d'une ligne s'ouvre dans l'inspecteur (clic sur la ligne).
import { SortHeader, StatusGlyph, Table, Text, Tooltip, VisuallyHidden } from '../../ui';
import type { ProvisionLine } from '../../api/types';
import { fmtDate, fmtEur } from '../../lib/format';
import { plural } from '../../components/lifecycle/lifecycleUtils';
import type { SortKey, SortOrder } from './useProvisionFilters';

interface Props {
  items: ProvisionLine[];
  total: number;
  totals: { montant: number };
  sort: SortKey;
  order: SortOrder;
  onSort: (k: SortKey) => void;
  onSelect: (l: ProvisionLine) => void;
  selectedId: number | null;
  dimmed?: boolean;
}

const COLS = 6; // glyphe + 5 colonnes

/** Glyphe de tête d'une ligne en anomalie ; motif en bulle d'aide. */
export function ProvisionGlyph({ line: l, size }: { line: ProvisionLine; size?: number }) {
  if (l.statut_parsing === 'ok') return null;
  const warn = l.statut_parsing === 'warn';
  const label = l.motif_rejet || (warn ? 'Ligne à vérifier' : 'Ligne rejetée');
  return <StatusGlyph kind={warn ? 'warning' : 'danger'} tone={warn ? 'warning' : 'danger'} size={size} label={label} />;
}

/** Texte tronqué sur une ligne, complet en bulle. */
function Ellipsis({ value }: { value: string }) {
  if (!value) return <>—</>;
  return (
    <Tooltip label={value} maxWidth={420} delay={300}>
      <span className="provisions-table__ellipsis">{value}</span>
    </Tooltip>
  );
}

export default function ProvisionLinesTable({
  items,
  total,
  totals,
  sort,
  order,
  onSort,
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
    <Table striped className="provisions-table" minWidth={760} style={dimmed ? { opacity: 0.6 } : undefined}>
      <thead>
        <tr>
          <th data-glyph>
            <VisuallyHidden>Contrôle</VisuallyHidden>
          </th>
          {sh('ct', 'CT')}
          <th>Libellé</th>
          <th>Ligne de coût</th>
          {sh('date_debut', 'Date')}
          {sh('montant', 'Montant', 'right')}
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
                <ProvisionGlyph line={l} />
              </td>
              <td data-mono data-nowrap>
                {l.ct ? (
                  <Tooltip label={l.groupe} disabled={!l.groupe} maxWidth={420} delay={300}>
                    <span>{l.ct}</span>
                  </Tooltip>
                ) : (
                  '—'
                )}
              </td>
              <td className="provisions-table__libelle">
                <Ellipsis value={l.libelle} />
              </td>
              <td className="provisions-table__ligne">
                <Ellipsis value={l.ligne_cout} />
              </td>
              <td data-nowrap>{fmtDate(l.date_debut)}</td>
              <td data-align="right" data-nowrap>
                {fmtEur(l.montant)}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={COLS - 1} data-nowrap>
            Total · {plural(total, 'ligne')}
          </td>
          <td data-align="right" data-nowrap>
            {fmtEur(totals.montant)}
          </td>
        </tr>
      </tfoot>
    </Table>
  );
}
