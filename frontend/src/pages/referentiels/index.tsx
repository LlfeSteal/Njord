// Module Référentiels — monté sur /referentiels/* (voir docs/ARCHITECTURE.md).
// URL : ?tab=squads pour l'onglet Squads ; ?personne=<id> ouvre la fiche d'une personne.
import { useSearchParams } from 'react-router-dom';
import { Stack, Tabs, Text, Title } from '@mantine/core';
import { IconUsers, IconUsersGroup } from '@tabler/icons-react';
import PersonnesTab from './PersonnesTab';
import SquadsTab from './SquadsTab';

export default function ReferentielsModule() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'squads' ? 'squads' : 'personnes';

  return (
    <Stack gap="sm">
      <div>
        <Title order={2}>Référentiels</Title>
        <Text size="sm" c="dimmed">
          Personnes et squads alimentés à l'import du plan de charge, enrichissables manuellement. Ils servent au
          rapprochement entre plan de charge et réalisé.
        </Text>
      </div>
      <Tabs
        value={tab}
        keepMounted={false}
        onChange={(t) =>
          setSp(() => {
            const n = new URLSearchParams();
            if (t === 'squads') n.set('tab', 'squads');
            return n;
          })
        }
      >
        <Tabs.List>
          <Tabs.Tab value="personnes" leftSection={<IconUsers size={16} />}>
            Personnes
          </Tabs.Tab>
          <Tabs.Tab value="squads" leftSection={<IconUsersGroup size={16} />}>
            Squads
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="personnes" pt="md">
          <PersonnesTab />
        </Tabs.Panel>
        <Tabs.Panel value="squads" pt="md">
          <SquadsTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
