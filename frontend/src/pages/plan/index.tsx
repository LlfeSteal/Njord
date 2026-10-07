// Module Plan de charge — monté sur /plan/* (voir docs/ARCHITECTURE.md).
// /plan = version courante (active), /plan/:id = version de l'historique, /plan/versions = gestion des versions,
// /plan/timeline = Gantt de la timeline des versions (DECISIONS n° 13) — routes statiques avant /plan/:versionId.
import { Navigate, Route, Routes } from 'react-router-dom';
import CurrentVersion from '../../components/lifecycle/CurrentVersion';
import PlanTimeline from './PlanTimeline';
import PlanVersionDetail from './PlanVersionDetail';
import PlanVersionsList from './PlanVersionsList';

export default function PlanModule() {
  return (
    <Routes>
      <Route
        index
        element={
          <CurrentVersion
            kind="plan"
            title="Plan de charge"
            emptyHelp="Importez un plan de charge (.xlsx). Une seule version est active à la fois : c'est elle que le pilotage utilise par défaut."
          >
            {(id) => <PlanVersionDetail versionId={id} />}
          </CurrentVersion>
        }
      />
      <Route path="versions" element={<PlanVersionsList />} />
      <Route path="timeline" element={<PlanTimeline />} />
      <Route path=":versionId" element={<PlanVersionDetail />} />
      <Route path="*" element={<Navigate to="/plan" replace />} />
    </Routes>
  );
}
