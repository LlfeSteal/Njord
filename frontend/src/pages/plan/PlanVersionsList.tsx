// Liste des versions de plan de charge (§7.2) — cycle de vie géré par VersionsPanel.
import { useNavigate } from 'react-router-dom';
import { Stack, Text } from '../../ui';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';

const LAYOUT_LABEL: Record<string, string> = { A: 'A', B: 'B', mixte: 'mixte' };

const layoutColumn: VersionColumn = {
  header: 'Layout',
  render: (v) =>
    v.layout ? (
      LAYOUT_LABEL[v.layout] ?? v.layout
    ) : (
      <Text as="span" tone="secondary">
        —
      </Text>
    ),
};

export default function PlanVersionsList() {
  const navigate = useNavigate();
  return (
    <Stack gap={8}>
      <VersionsPanel
        kind="plan"
        title="Plans de charge"
        onOpen={(v) => navigate(v.id)}
        extraColumns={[layoutColumn]}
      />
      <Text size="sm" tone="secondary">
        Une seule version est active à la fois : c'est elle que l'onglet Analyse utilise par défaut. Importer un
        nouveau plan propose d'archiver l'actif. Les versions archivées restent consultables et exportables ; la purge
        (définitive) n'est possible qu'après le délai fixé dans les Paramètres.
      </Text>
    </Stack>
  );
}
