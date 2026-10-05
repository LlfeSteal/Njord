import { lazy, Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';

// Un chunk par onglet (chargé à la demande).
const PlanModule = lazy(() => import('./pages/plan'));
const RealiseModule = lazy(() => import('./pages/realise'));
const AnalyseModule = lazy(() => import('./pages/analyse'));
const ReferentielsModule = lazy(() => import('./pages/referentiels'));
const ParametresModule = lazy(() => import('./pages/parametres'));

const fallback = (
  <Center py="xl">
    <Loader />
  </Center>
);

// Chaque module gère ses sous-routes (ex. /plan/:versionId) via <Routes> relatives.
export default function App() {
  return (
    <Suspense fallback={fallback}>
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
    </Suspense>
  );
}
