// Barre d'outils commune des Réglages : titre + bascule Paramètres / Journal.
import { useLocation, useNavigate } from 'react-router-dom';
import { PageToolbar, SegmentedControl, type PageToolbarProps } from '../../ui';

type Tab = 'settings' | 'journal';

export default function ReglagesToolbar(props: Omit<PageToolbarProps, 'title' | 'bottom'>) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab: Tab = /\/journal\/?$/.test(pathname) ? 'journal' : 'settings';
  return (
    <PageToolbar
      {...props}
      title="Réglages"
      bottom={
        <SegmentedControl<Tab>
          aria-label="Sections des réglages"
          value={tab}
          onChange={(v) => navigate(v === 'journal' ? '/reglages/journal' : '/reglages')}
          data={[
            { value: 'settings', label: 'Paramètres' },
            { value: 'journal', label: 'Journal' },
          ]}
        />
      }
    />
  );
}
