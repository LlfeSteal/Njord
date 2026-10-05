// Module Plan de charge — monté sur /plan/* (voir docs/ARCHITECTURE.md).
import { Navigate, Route, Routes } from 'react-router-dom';
import PlanVersionDetail from './PlanVersionDetail';
import PlanVersionsList from './PlanVersionsList';

export default function PlanModule() {
  return (
    <Routes>
      <Route index element={<PlanVersionsList />} />
      <Route path=":versionId" element={<PlanVersionDetail />} />
      <Route path="*" element={<Navigate to="/plan" replace />} />
    </Routes>
  );
}
