// Liste des imports du réalisé : cycle de vie délégué à VersionsPanel (import, archivage, purge).
import { Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';
import { fmtEur } from '../../lib/format';

const EXTRA_COLUMNS: VersionColumn[] = [
  {
    header: 'Montant total',
    render: (v) => (
      <Text size="sm" ta="right" c={(v.montant_total_eur ?? 0) < 0 ? 'red' : undefined} style={{ whiteSpace: 'nowrap' }}>
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
