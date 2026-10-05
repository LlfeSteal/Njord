// Module Réalisé — monté sur /realise/* (voir docs/ARCHITECTURE.md).
// /realise = import courant (actif), /realise/:id = import de l'historique, /realise/versions = gestion des imports.
import { Navigate, Route, Routes } from 'react-router-dom';
import CurrentVersion from '../../components/lifecycle/CurrentVersion';
import RealiseDetail from './RealiseDetail';
import RealiseList from './RealiseList';

export default function RealiseModule() {
  return (
    <Routes>
      <Route
        index
        element={
          <CurrentVersion
            kind="realise"
            title="Réalisé"
            emptyHelp="Importez un extrait du réalisé (.xlsx). L'import actif est celui que le pilotage utilise par défaut."
          >
            {(id) => <RealiseDetail versionId={id} />}
          </CurrentVersion>
        }
      />
      <Route path="versions" element={<RealiseList />} />
      <Route path=":versionId" element={<RealiseDetail />} />
      <Route path="*" element={<Navigate to="/realise" replace />} />
    </Routes>
  );
}
