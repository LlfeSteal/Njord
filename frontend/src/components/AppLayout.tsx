// Coquille : barre d'outils collante translucide (icône, titre, navigation, apparence) + contenu.
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, SegmentedControl, useAppearance, type Appearance } from '../ui';
import { IconAuto, IconMoon, IconSun, IconTimeline } from '../ui/Icons';
import './AppLayout.css';

type TabKey = 'plan' | 'realise' | 'analyse' | 'referentiels' | 'parametres';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'plan', label: 'Plan de charge' },
  { value: 'realise', label: 'Réalisé' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'referentiels', label: 'Référentiels' },
  { value: 'parametres', label: 'Paramètres' },
];

const APPEARANCES: { value: Appearance; label: string; icon: typeof IconSun }[] = [
  { value: 'auto', label: 'Automatique', icon: IconAuto },
  { value: 'light', label: 'Clair', icon: IconSun },
  { value: 'dark', label: 'Sombre', icon: IconMoon },
];

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { appearance, setAppearance } = useAppearance();
  const segment = location.pathname.split('/')[1];
  const current: TabKey = TABS.some((t) => t.value === segment) ? (segment as TabKey) : 'plan';
  const CurrentIcon = APPEARANCES.find((a) => a.value === appearance)?.icon ?? IconAuto;

  return (
    <div className="app">
      <header className="app-toolbar">
        <div className="app-brand">
          <span className="app-icon" aria-hidden>
            <IconTimeline size={18} stroke={2.4} />
          </span>
          <div className="app-brand-text">
            <span className="app-title">Njord</span>
            <span className="app-subtitle">Analyse des imputations</span>
          </div>
        </div>
        <nav className="app-nav" aria-label="Modules">
          <SegmentedControl
            aria-label="Modules"
            size="lg"
            equal={false}
            value={current}
            onChange={(v) => navigate('/' + v)}
            data={TABS}
          />
        </nav>
        <div className="app-actions">
          <Menu
            placement="bottom-end"
            target={(p) => (
              <button {...p} type="button" className="app-appearance" aria-label="Apparence" title="Apparence">
                <CurrentIcon size={16} />
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
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
