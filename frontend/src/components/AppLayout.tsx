// Coquille : barre latérale façon macOS (Pilotage · Données · Réglages) + page courante.
import { Outlet, useLocation } from 'react-router-dom';
import { AppShell, Menu, Sidebar, useAppearance, type Appearance } from '../ui';
import {
  IconAuto,
  IconCalendar,
  IconFileSpreadsheet,
  IconMoon,
  IconSliders,
  IconSun,
  IconTimeline,
  IconUser,
  IconUsers,
  IconGauge,
  IconInbox,
  IconChartBar,
  IconEuro,
  IconTrend,
  IconGrid,
  IconDiff,
} from '../ui/Icons';
import { useAnalyse } from '../pages/pilotage/shared/context';
import './AppLayout.css';

const APPEARANCES: { value: Appearance; label: string; icon: typeof IconSun }[] = [
  { value: 'auto', label: 'Automatique', icon: IconAuto },
  { value: 'light', label: 'Clair', icon: IconSun },
  { value: 'dark', label: 'Sombre', icon: IconMoon },
];

export default function AppLayout() {
  const { appearance, setAppearance } = useAppearance();
  const { result } = useAnalyse();
  const { pathname } = useLocation();
  // /plan/timeline a sa propre entrée : « Plan de charge » n'y est pas surligné en plus.
  const onTimeline = pathname === '/plan/timeline' || pathname.startsWith('/plan/timeline/');
  const aTraiter = result.data?.anomalies?.filter((a) => a.statut === 'a_traiter').length ?? 0;
  const CurrentIcon = APPEARANCES.find((a) => a.value === appearance)?.icon ?? IconAuto;

  const sidebar = (
    <Sidebar
      aria-label="Navigation principale"
      header={
        <div className="app-brand">
          <span className="app-icon" aria-hidden>
            <IconTimeline size={16} stroke={2.4} />
          </span>
          <span className="app-title">Njord</span>
        </div>
      }
      sections={[
        {
          title: 'Pilotage',
          items: [
            { to: '/', end: true, label: "Vue d'ensemble", icon: <IconGauge size={16} /> },
            { to: '/anomalies', label: 'Anomalies', icon: <IconInbox size={16} />, badge: aTraiter },
            { to: '/ecarts', label: 'Écarts', icon: <IconChartBar size={16} /> },
            { to: '/budget', label: 'Budget', icon: <IconEuro size={16} /> },
            { to: '/previsions', label: 'Prévisions', icon: <IconTrend size={16} /> },
            { to: '/capacite', label: 'Capacité', icon: <IconGrid size={16} /> },
            { to: '/derive', label: 'Dérive du plan', icon: <IconDiff size={16} /> },
          ],
        },
        {
          title: 'Données',
          items: [
            { to: '/plan', end: onTimeline, label: 'Plan de charge', icon: <IconCalendar size={16} /> },
            { to: '/plan/timeline', label: 'Timeline du plan', icon: <IconTimeline size={16} /> },
            { to: '/realise', label: 'Réalisé', icon: <IconFileSpreadsheet size={16} /> },
            { to: '/provisions', label: 'Provisions', icon: <IconEuro size={16} /> },
            { to: '/personnes', label: 'Personnes', icon: <IconUser size={16} /> },
            { to: '/squads', label: 'Squads', icon: <IconUsers size={16} /> },
          ],
        },
        { items: [{ to: '/reglages', label: 'Réglages', icon: <IconSliders size={16} /> }] },
      ]}
      footer={
        <Menu
          placement="top-start"
          target={(p) => (
            <button {...p} type="button" className="app-appearance" aria-label="Apparence" title="Apparence">
              <CurrentIcon size={15} />
              <span>Apparence</span>
            </button>
          )}
          items={[
            { type: 'header', label: 'Apparence' },
            ...APPEARANCES.map((a) => ({
              label: a.label,
              icon: <a.icon size={15} />,
              checked: appearance === a.value,
              onSelect: () => setAppearance(a.value),
            })),
          ]}
        />
      }
    />
  );

  return (
    <AppShell sidebar={sidebar}>
      <Outlet />
    </AppShell>
  );
}
