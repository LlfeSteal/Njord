// Liste des versions d'un kind (plan | realise) avec cycle de vie complet.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Auto-suffisant : charge versionsApi.list, bouton « Importer » (ouvre ImportWizard),
// toggle « afficher purgées », tri actives en tête / archivées grisées,
// actions en ligne : consulter (onOpen), archiver / réactiver, purger (PurgeModal).
import type { ReactNode } from 'react';
import type { Kind, Version } from '../api/types';

export interface VersionColumn {
  header: string;
  render: (v: Version) => ReactNode;
}

export interface VersionsPanelProps {
  kind: Kind;
  title: string;
  /** Clic sur « consulter » ou sur la ligne. */
  onOpen: (v: Version) => void;
  /** Colonnes ajoutées après les colonnes communes (ex. layout pour le plan, montant total pour le réalisé). */
  extraColumns?: VersionColumn[];
}

export default function VersionsPanel(_props: VersionsPanelProps) {
  return null;
}
