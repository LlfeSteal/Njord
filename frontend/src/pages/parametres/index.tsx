// Module Paramètres — monté sur /parametres/* : paramètres métier (index) et journal d'audit (/parametres/audit).
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { SegmentedControl, Stack, Title } from '../../ui';
import { IconHistory, IconSliders } from '../../ui/Icons';
import SettingsForm from './SettingsForm';
import AuditLog from './AuditLog';

type Tab = 'settings' | 'audit';

export default function ParametresModule() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab: Tab = /\/audit\/?$/.test(pathname) ? 'audit' : 'settings';
  return (
    <Stack gap={12}>
      <Title order={2}>Paramètres</Title>
      <SegmentedControl<Tab>
        aria-label="Sections des paramètres"
        equal={false}
        value={tab}
        onChange={(v) => navigate(v === 'audit' ? '/parametres/audit' : '/parametres')}
        data={[
          { value: 'settings', label: 'Paramètres métier', icon: <IconSliders size={15} /> },
          { value: 'audit', label: "Journal d'audit", icon: <IconHistory size={15} /> },
        ]}
        style={{ alignSelf: 'flex-start' }}
      />
      <Routes>
        <Route index element={<SettingsForm />} />
        <Route path="audit" element={<AuditLog />} />
      </Routes>
    </Stack>
  );
}
