// Liste des imports du réalisé : cycle de vie délégué à VersionsPanel (import, archivage, purge).
import { useNavigate } from 'react-router-dom';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';
import { fmtEur } from '../../lib/format';

const EXTRA_COLUMNS: VersionColumn[] = [
  { header: 'Montant total', align: 'right', render: (v) => fmtEur(v.montant_total_eur) },
];

export default function RealiseList() {
  const navigate = useNavigate();
  return (
    <VersionsPanel
      kind="realise"
      title="Imports du réalisé"
      back={{ to: '/realise', label: 'Réalisé' }}
      onOpen={(v) => navigate(v.statut === 'active' ? '/realise' : `/realise/${v.id}`)}
      extraColumns={EXTRA_COLUMNS}
      emptyHelp="Importez un extrait du réalisé (.xlsx). L'import actif est celui que le pilotage utilise par défaut."
    />
  );
}
