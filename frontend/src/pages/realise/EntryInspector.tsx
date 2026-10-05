// Inspecteur d'une écriture du réalisé : toutes ses colonnes, groupées (Imputation, Dépense, Contrôle).
import { Inspector, InspectorSection, KeyValue, StatusGlyph, Tag, Text, type KeyValueItem } from '../../ui';
import type { RealiseEntry } from '../../api/types';
import { fmtDate, fmtEur, fmtNumber } from '../../lib/format';
import { DETAIL_GROUPS, tgLabel } from './columns';

interface Props {
  entry: RealiseEntry | null;
  onClose: () => void;
  /** Masque les champs sensibles (nom, matricule, facture…). */
  maskSensitive: boolean;
}

/** Glyphe de statut d'une écriture en anomalie (motif en bulle). */
export function EntryGlyph({ entry: e, size }: { entry: RealiseEntry; size?: number }) {
  if (e.statut_parsing === 'ok') return null;
  const warn = e.statut_parsing === 'warn';
  const label = e.motif_rejet || (warn ? 'Écriture à vérifier' : 'Écriture rejetée');
  return <StatusGlyph kind={warn ? 'warning' : 'danger'} tone={warn ? 'warning' : 'danger'} size={size} label={label} />;
}

export default function EntryInspector({ entry: e, onClose, maskSensitive }: Props) {
  if (!e) return null;
  const tone = e.statut_parsing === 'warn' ? 'warning' : e.statut_parsing === 'drop' ? 'danger' : undefined;

  const controle: KeyValueItem[] = [
    {
      label: 'Statut',
      value:
        e.statut_parsing === 'ok' ? (
          <Tag tone="success" glyph="success">
            OK
          </Tag>
        ) : e.statut_parsing === 'warn' ? (
          <Tag tone="warning" glyph="warning">
            À vérifier
          </Tag>
        ) : (
          <Tag tone="danger" glyph="danger">
            Rejetée
          </Tag>
        ),
    },
    { label: 'Ligne du fichier', value: fmtNumber(e.row_num), numeric: true },
  ];

  return (
    <Inspector
      opened
      onClose={onClose}
      title={fmtEur(e.total_eur, true)}
      subtitle={[fmtDate(e.date_depense), e.tg, tgLabel(e)].filter(Boolean).join(' · ')}
      accessory={<EntryGlyph entry={e} />}
    >
      {DETAIL_GROUPS.map((g) => (
        <InspectorSection key={g.title} title={g.title}>
          <KeyValue
            items={g.fields
              .filter((f) => !(maskSensitive && f.sensitive))
              .map((f) => ({ label: f.label, value: f.value(e), mono: f.mono, numeric: f.numeric }))}
          />
        </InspectorSection>
      ))}
      <InspectorSection title="Contrôle">
        <KeyValue items={controle} />
        {tone && e.motif_rejet && (
          <Text size="sm" tone={tone} mt={8}>
            {e.motif_rejet}
          </Text>
        )}
      </InspectorSection>
    </Inspector>
  );
}
