import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import PlanModule from './pages/plan';
import RealiseModule from './pages/realise';
import AnalyseModule from './pages/analyse';
import ReferentielsModule from './pages/referentiels';
import ParametresModule from './pages/parametres';

// Chaque module gère ses sous-routes (ex. /plan/:versionId) via <Routes> relatives.
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/plan" replace />} />
        <Route path="/plan/*" element={<PlanModule />} />
        <Route path="/realise/*" element={<RealiseModule />} />
        <Route path="/analyse/*" element={<AnalyseModule />} />
        <Route path="/referentiels/*" element={<ReferentielsModule />} />
        <Route path="/parametres/*" element={<ParametresModule />} />
        <Route path="*" element={<Navigate to="/plan" replace />} />
      </Route>
    </Routes>
  );
}
