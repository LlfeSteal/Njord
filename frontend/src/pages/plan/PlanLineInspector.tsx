// Inspecteur d'une ligne de plan : affectation, charge, contrôle du parsing, actions (alias, fiche).
import { Button, Inspector, InspectorSection, KeyValue, Tag, Text, Tooltip, type KeyValueItem } from '../../ui';
import { IconExternalLink, IconUserPlus } from '../../ui/Icons';
import type { PlanLine } from '../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtNumber, fmtPct } from '../../lib/format';
import { ParsingGlyph } from './PlanLinesTable';

const KIND_LABEL: Record<PlanLine['ressource_kind'], string> = {
  internal: 'interne',
  external: 'externe',
  unknown: 'type inconnu',
};

const or = (v: string | null | undefined) => (v ? v : '—');

interface Props {
  line: PlanLine | null;
  onClose: () => void;
  squadName: (id: string | null) => string;
  squadPath: (id: string | null) => string;
  onAlias: (l: PlanLine) => void;
}

export default function PlanLineInspector({ line: l, onClose, squadName, squadPath, onAlias }: Props) {
  if (!l) return null;

  const affectation: KeyValueItem[] = [
    {
      label: 'Ressource',
      value: (
        <>
          <Text as="span" mono>
            {l.ressource}
          </Text>{' '}
          <Text as="span" tone="secondary">
            · {KIND_LABEL[l.ressource_kind] ?? l.ressource_kind}
            {l.inactive ? ' · inactif' : ''}
          </Text>
        </>
      ),
    },
    { label: 'Squad', value: or(squadName(l.squad_id)) },
    { label: 'Groupe complet', value: or(l.groupe || squadPath(l.squad_id)) },
    { label: 'Libellé brut', value: or(l.libelle) },
    { label: "Type d'affectation", value: or(l.type_affectation) },
  ];

  const charge: KeyValueItem[] = [
    { label: 'Charge totale', value: fmtHours(l.charge_totale), numeric: true },
    { label: 'PPS', value: fmtEur(l.pps), numeric: true },
    { label: '%', value: fmtPct(l.pourcentage), numeric: true },
    { label: 'Unité', value: or(l.unite), mono: true },
    { label: 'Ligne de coût', value: or(l.ligne_cout) },
    { label: 'Début', value: fmtDate(l.date_debut), numeric: true },
    { label: 'Fin', value: fmtDate(l.date_fin), numeric: true },
    { label: 'Calcul de la durée', value: or(l.calcul_duree) },
    ...(l.quantite_affectee != null
      ? [{ label: 'Quantité affectée', value: fmtNumber(l.quantite_affectee), numeric: true }]
      : []),
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

  const footer = (
    <>
      {l.personne_id && (
        <Button variant="plain" iconRight={<IconExternalLink size={13} />} to={`/personnes?personne=${encodeURIComponent(l.personne_id)}`}>
          Voir la fiche
        </Button>
      )}
      {l.personne_id ? (
        <Button icon={<IconUserPlus size={15} />} onClick={() => onAlias(l)}>
          Créer un alias
        </Button>
      ) : (
        <Tooltip label="Ressource non rattachée à une fiche personne">
          <Button icon={<IconUserPlus size={15} />} disabled>
            Créer un alias
          </Button>
        </Tooltip>
      )}
    </>
  );

  return (
    <Inspector
      opened
      onClose={onClose}
      title={l.nom_prenom || l.ressource}
      subtitle={l.ct}
      accessory={<ParsingGlyph line={l} />}
      footer={footer}
    >
      <InspectorSection title="Affectation">
        <KeyValue items={affectation} />
      </InspectorSection>
      <InspectorSection title="Charge">
        <KeyValue items={charge} />
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
