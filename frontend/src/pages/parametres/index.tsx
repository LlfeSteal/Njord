// Module Réglages — monté sur /reglages/* : paramètres métier (index) et journal d'audit (/reglages/journal).
import { Route, Routes } from 'react-router-dom';
import SettingsForm from './SettingsForm';
import AuditLog from './AuditLog';

export default function ParametresModule() {
  return (
    <Routes>
      <Route index element={<SettingsForm />} />
      <Route path="journal" element={<AuditLog />} />
    </Routes>
  );
}
