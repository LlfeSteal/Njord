import { AppShell, Group, Tabs, Text, Title } from '@mantine/core';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { value: 'plan', label: 'Plan de charge' },
  { value: 'realise', label: 'Réalisé' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'referentiels', label: 'Référentiels' },
  { value: 'parametres', label: 'Paramètres' },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = location.pathname.split('/')[1] || 'plan';
  return (
    <AppShell header={{ height: 100 }} padding="md">
      <AppShell.Header px="md">
        <Group h={52} gap="xs">
          <Title order={3}>Njord</Title>
          <Text c="dimmed" size="sm">
            Analyse des imputations
          </Text>
        </Group>
        <Tabs value={current} onChange={(v) => v && navigate('/' + v)}>
          <Tabs.List>
            {TABS.map((t) => (
              <Tabs.Tab key={t.value} value={t.value}>
                {t.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
