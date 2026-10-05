// Modale de purge : rappelle les conditions (archivée depuis ≥ N jours, cf. settings.purge_delai_jours),
// exige la saisie exacte de l'intitulé, appelle versionsApi.purge et affiche le refus 409 éventuel.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
import type { Kind, Version } from '../api/types';

export interface PurgeModalProps {
  kind: Kind;
  version: Version | null; // null = fermée
  onClose: () => void;
  onPurged?: (v: Version) => void;
}

export default function PurgeModal(_props: PurgeModalProps) {
  return null;
}
