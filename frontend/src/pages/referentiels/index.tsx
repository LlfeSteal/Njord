// Module Référentiels — monté sur /referentiels/* (voir docs/ARCHITECTURE.md).
// URL : ?tab=squads pour l'onglet Squads ; ?personne=<id> ouvre la fiche d'une personne.
import { useSearchParams } from 'react-router-dom';
import { SegmentedControl, Stack, Text, Title } from '../../ui';
import { IconUser, IconUsers } from '../../ui/Icons';
import PersonnesTab from './PersonnesTab';
import SquadsTab from './SquadsTab';

type Tab = 'personnes' | 'squads';

export default function ReferentielsModule() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get('tab') === 'squads' ? 'squads' : 'personnes';

  return (
    <Stack gap={12}>
      <div>
        <Title order={2}>Référentiels</Title>
        <Text size="sm" tone="secondary" mt={2}>
          Personnes et squads alimentés à l'import du plan de charge, enrichissables manuellement. Ils servent au
          rapprochement entre plan de charge et réalisé.
        </Text>
      </div>
      <div>
        <SegmentedControl<Tab>
          aria-label="Référentiel"
          equal={false}
          value={tab}
          onChange={(t) =>
            setSp(() => {
              const n = new URLSearchParams();
              if (t === 'squads') n.set('tab', 'squads');
              return n;
            })
          }
          data={[
            { value: 'personnes', label: 'Personnes', icon: <IconUser size={15} /> },
            { value: 'squads', label: 'Squads', icon: <IconUsers size={15} /> },
          ]}
        />
      </div>
      {tab === 'personnes' ? <PersonnesTab /> : <SquadsTab />}
    </Stack>
  );
}
