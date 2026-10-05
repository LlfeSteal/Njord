// Liste des versions de plan de charge — cycle de vie géré par VersionsPanel.
import { useNavigate } from 'react-router-dom';
import VersionsPanel from '../../components/VersionsPanel';

export default function PlanVersionsList() {
  const navigate = useNavigate();
  return (
    <VersionsPanel
      kind="plan"
      title="Plan de charge"
      onOpen={(v) => navigate(v.id)}
      emptyHelp="Importez un plan de charge (.xlsx). Une seule version est active à la fois : c'est elle que le pilotage utilise par défaut."
    />
  );
}
