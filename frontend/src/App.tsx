import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { LoadingBlock } from './ui';

// Un chunk par onglet (chargé à la demande).
const PlanModule = lazy(() => import('./pages/plan'));
const RealiseModule = lazy(() => import('./pages/realise'));
const AnalyseModule = lazy(() => import('./pages/analyse'));
const ReferentielsModule = lazy(() => import('./pages/referentiels'));
const ParametresModule = lazy(() => import('./pages/parametres'));

// Chaque module gère ses sous-routes (ex. /plan/:versionId) via <Routes> relatives.
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/plan" replace />} />
        <Route path="/plan/*" element={<Lazy><PlanModule /></Lazy>} />
        <Route path="/realise/*" element={<Lazy><RealiseModule /></Lazy>} />
        <Route path="/analyse/*" element={<Lazy><AnalyseModule /></Lazy>} />
        <Route path="/referentiels/*" element={<Lazy><ReferentielsModule /></Lazy>} />
        <Route path="/parametres/*" element={<Lazy><ParametresModule /></Lazy>} />
        <Route path="*" element={<Navigate to="/plan" replace />} />
      </Route>
    </Routes>
  );
}

// Suspense sous la coquille : la barre d'outils reste affichée pendant le chargement d'un onglet.
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingBlock />}>{children}</Suspense>;
}
