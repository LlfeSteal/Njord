// Liste des imports du réalisé : cycle de vie délégué à VersionsPanel (import, archivage, purge).
import { useNavigate } from 'react-router-dom';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';
import { Text } from '../../ui';
import { fmtEur } from '../../lib/format';

const EXTRA_COLUMNS: VersionColumn[] = [
  {
    header: 'Montant total',
    render: (v) => (
      <Text as="span" align="right" tabular style={{ display: 'block', whiteSpace: 'nowrap' }}>
        {fmtEur(v.montant_total_eur)}
      </Text>
    ),
  },
];

export default function RealiseList() {
  const navigate = useNavigate();
  return (
    <VersionsPanel
      kind="realise"
      title="Imports du réalisé"
      onOpen={(v) => navigate(`/realise/${v.id}`)}
      extraColumns={EXTRA_COLUMNS}
    />
  );
}
