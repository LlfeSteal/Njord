// Module Réalisé — monté sur /realise/* (voir docs/ARCHITECTURE.md).
// index = liste des imports (VersionsPanel), :versionId = détail des écritures.
import { Route, Routes } from 'react-router-dom';
import RealiseList from './RealiseList';
import RealiseDetail from './RealiseDetail';

export default function RealiseModule() {
  return (
    <Routes>
      <Route index element={<RealiseList />} />
      <Route path=":versionId" element={<RealiseDetail />} />
    </Routes>
  );
}
