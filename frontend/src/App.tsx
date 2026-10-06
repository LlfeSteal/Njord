import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { LoadingBlock } from './ui';

// Un chunk par page (chargé à la demande).
// Pilotage
const OverviewPage = lazy(() => import('./pages/pilotage/overview'));
const AnomaliesPage = lazy(() => import('./pages/pilotage/anomalies'));
const EcartsPage = lazy(() => import('./pages/pilotage/ecarts'));
const BudgetPage = lazy(() => import('./pages/pilotage/budget'));
const PrevisionsPage = lazy(() => import('./pages/pilotage/previsions'));
const CapacitePage = lazy(() => import('./pages/pilotage/capacite'));
const DerivePage = lazy(() => import('./pages/pilotage/derive'));
// Données
const PlanModule = lazy(() => import('./pages/plan'));
const RealiseModule = lazy(() => import('./pages/realise'));
const PersonnesPage = lazy(() => import('./pages/referentiels/personnes'));
const SquadsPage = lazy(() => import('./pages/referentiels/squads'));
// Réglages
const ParametresModule = lazy(() => import('./pages/parametres'));

// Les modules Données gèrent leurs sous-routes (ex. /plan/:versionId) via <Routes> relatives.
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Lazy><OverviewPage /></Lazy>} />
        <Route path="/anomalies" element={<Lazy><AnomaliesPage /></Lazy>} />
        <Route path="/ecarts" element={<Lazy><EcartsPage /></Lazy>} />
        <Route path="/budget" element={<Lazy><BudgetPage /></Lazy>} />
        <Route path="/previsions" element={<Lazy><PrevisionsPage /></Lazy>} />
        <Route path="/capacite" element={<Lazy><CapacitePage /></Lazy>} />
        <Route path="/derive" element={<Lazy><DerivePage /></Lazy>} />
        <Route path="/plan/*" element={<Lazy><PlanModule /></Lazy>} />
        <Route path="/realise/*" element={<Lazy><RealiseModule /></Lazy>} />
        <Route path="/personnes/*" element={<Lazy><PersonnesPage /></Lazy>} />
        <Route path="/squads/*" element={<Lazy><SquadsPage /></Lazy>} />
        <Route path="/reglages/*" element={<Lazy><ParametresModule /></Lazy>} />
        {/* Anciennes adresses (query string conservée) */}
        <Route path="/analyse/*" element={<Navigate to="/" replace />} />
        <Route path="/referentiels/*" element={<Redirect to="/personnes" />} />
        <Route path="/parametres/audit" element={<Redirect to="/reglages/journal" />} />
        <Route path="/parametres/*" element={<Redirect to="/reglages" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// Suspense sous la coquille : la barre latérale reste affichée pendant le chargement d'une page.
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingBlock />}>{children}</Suspense>;
}

// Redirection qui garde la query string (ex. /referentiels?personne=… → /personnes?personne=…).
function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}
