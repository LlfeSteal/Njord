// Module Paramètres — monté sur /parametres/* : paramètres métier (index) et journal d'audit (/parametres/audit).
import { Stack, Tabs, Title } from '@mantine/core';
import { IconAdjustments, IconHistory } from '@tabler/icons-react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import SettingsForm from './SettingsForm';
import AuditLog from './AuditLog';

export default function ParametresModule() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = /\/audit\/?$/.test(pathname) ? 'audit' : 'settings';
  return (
    <Stack gap="md">
      <Title order={3}>Paramètres</Title>
      <Tabs
        value={tab}
        onChange={(v) => navigate(v === 'audit' ? '/parametres/audit' : '/parametres')}
        variant="outline"
      >
        <Tabs.List>
          <Tabs.Tab value="settings" leftSection={<IconAdjustments size={16} />}>
            Paramètres métier
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={16} />}>
            Journal d'audit
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Routes>
        <Route index element={<SettingsForm />} />
        <Route path="audit" element={<AuditLog />} />
      </Routes>
    </Stack>
  );
}
