// Sélecteur de version dans le titre de la barre d'outils : « Plan démo ▾ » ouvre l'historique
// (versions non purgées, coche sur la version affichée), l'import et la gestion des versions.
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, type MenuEntry } from '../../ui';
import { IconChevronDown, IconImport, IconSliders } from '../../ui/Icons';
import type { Kind, Version } from '../../api/types';
import { useVersionHistory } from './useCurrentVersion';
import './VersionSwitcher.css';

const STATUT_LABEL: Record<Version['statut'], string> = { active: 'Active', archivee: 'Archivée', purgee: 'Purgée' };
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'short' });

export interface VersionSwitcherProps {
  kind: Kind;
  current: Version;
  /** Racine du module (« /plan », « /realise ») : la version active s'y affiche. */
  basePath: '/plan' | '/realise';
  onImport: () => void;
}

export default function VersionSwitcher({ kind, current, basePath, onImport }: VersionSwitcherProps) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const history = useVersionHistory(kind);
  const list = history.data ?? [];

  const go = (v: Version) => navigate({ pathname: v.statut === 'active' ? basePath : `${basePath}/${v.id}`, search });

  const items: MenuEntry[] = [
    { type: 'header', label: 'Historique' },
    ...list.map((v) => ({
      label: v.intitule,
      hint: `${fmtShort(v.importee_le)} · ${STATUT_LABEL[v.statut]}`,
      checked: v.id === current.id,
      onSelect: () => go(v),
    })),
    { type: 'separator' },
    { label: 'Importer un fichier…', icon: <IconImport size={15} />, onSelect: onImport },
    { label: 'Gérer les versions…', icon: <IconSliders size={15} />, onSelect: () => navigate(`${basePath}/versions`) },
  ];

  return (
    <Menu
      width={300}
      target={(p) => (
        <button {...p} type="button" className="version-switcher" title="Changer de version">
          <span className="version-switcher__label">{current.intitule}</span>
          <IconChevronDown size={12} stroke={2.2} />
        </button>
      )}
      items={items}
    />
  );
}
