// Inspecteur d'une ligne de provisions : toutes ses colonnes (rattachement, montant, dates, contrôle).
import { Inspector, InspectorSection, KeyValue, Tag, Text, type KeyValueItem } from '../../ui';
import type { ProvisionLine } from '../../api/types';
import { fmtDate, fmtEur, fmtNumber } from '../../lib/format';
import { ProvisionGlyph } from './ProvisionLinesTable';

const or = (v: string | null | undefined) => (v ? v : '—');

export default function ProvisionLineInspector({ line: l, onClose }: { line: ProvisionLine | null; onClose: () => void }) {
  if (!l) return null;

  const rattachement: KeyValueItem[] = [
    { label: 'CT', value: or(l.ct), mono: true },
    { label: 'Groupe', value: or(l.groupe) },
    { label: 'Libellé', value: or(l.libelle) },
  ];

  const depense: KeyValueItem[] = [
    { label: 'Montant', value: fmtEur(l.montant, true), numeric: true },
    { label: 'Unité', value: or(l.unite), mono: true },
    { label: 'Ligne de coût', value: or(l.ligne_cout) },
    { label: 'Type de dépense', value: or(l.type_depense) },
    { label: 'Début', value: fmtDate(l.date_debut), numeric: true },
    { label: 'Fin', value: fmtDate(l.date_fin), numeric: true },
  ];

  const tone = l.statut_parsing === 'warn' ? 'warning' : l.statut_parsing === 'drop' ? 'danger' : undefined;
  const controle: KeyValueItem[] = [
    {
      label: 'Statut',
      value:
        l.statut_parsing === 'ok' ? (
          <Tag tone="success" glyph="success">
            OK
          </Tag>
        ) : l.statut_parsing === 'warn' ? (
          <Tag tone="warning" glyph="warning">
            À vérifier
          </Tag>
        ) : (
          <Tag tone="danger" glyph="danger">
            Rejetée
          </Tag>
        ),
    },
    { label: 'Ligne du fichier', value: fmtNumber(l.row_num), numeric: true },
  ];

  return (
    <Inspector
      opened
      onClose={onClose}
      title={l.libelle || l.ct || 'Provision'}
      subtitle={l.ct}
      accessory={<ProvisionGlyph line={l} />}
    >
      <InspectorSection title="Rattachement">
        <KeyValue items={rattachement} />
      </InspectorSection>
      <InspectorSection title="Provision">
        <KeyValue items={depense} />
        <Text size="sm" tone="secondary" mt={8}>
          Dates informatives : la provision s'ajoute à la charge max du CT quelle que soit sa date.
        </Text>
      </InspectorSection>
      <InspectorSection title="Contrôle">
        <KeyValue items={controle} />
        {tone && l.motif_rejet && (
          <Text size="sm" tone={tone} mt={8}>
            {l.motif_rejet}
          </Text>
        )}
      </InspectorSection>
    </Inspector>
  );
}
