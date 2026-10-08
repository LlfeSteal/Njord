// Liste des versions de provisions : cycle de vie délégué à VersionsPanel (import, archivage, purge).
import { useNavigate } from 'react-router-dom';
import VersionsPanel, { type VersionColumn } from '../../components/VersionsPanel';
import { fmtEur } from '../../lib/format';
import { PROVISIONS_HELP } from './help';

const EXTRA_COLUMNS: VersionColumn[] = [
  { header: 'Montant', align: 'right', render: (v) => fmtEur(v.montant_total_eur) },
];

export default function ProvisionsList() {
  const navigate = useNavigate();
  return (
    <VersionsPanel
      kind="provision"
      title="Versions des provisions"
      back={{ to: '/provisions', label: 'Provisions' }}
      onOpen={(v) => navigate(v.statut === 'active' ? '/provisions' : `/provisions/${v.id}`)}
      extraColumns={EXTRA_COLUMNS}
      emptyHelp={PROVISIONS_HELP}
    />
  );
}
