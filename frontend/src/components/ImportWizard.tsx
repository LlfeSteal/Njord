// Assistant d'import en 2 temps (preview → confirmation), commun plan / réalisé.
// CONTRAT FIGÉ (props) — implémentation : agent « FE partagé ».
// Étapes : dépôt .xlsx (Dropzone) + intitulé optionnel + importeur optionnel → versionsApi.preview
// → affichage du bilan (ImportReport : totaux ok/warn/drop, période, layout & % inactifs &
//   nouvelles personnes/squads pour le plan, montant total pour le réalisé, motifs, issues)
// → si report.active_version : case « Archiver la version active « X » ? » (cochée par défaut)
// → versionsApi.commit → notification, invalidation ['versions'] et ['analyse'], onImported.
// Les erreurs bloquantes (422 : onglet introuvable, en-tête non conforme) s'affichent dans l'assistant.
import type { ImportResult, Kind } from '../api/types';

export interface ImportWizardProps {
  kind: Kind;
  opened: boolean;
  onClose: () => void;
  onImported?: (r: ImportResult) => void;
}

export default function ImportWizard(_props: ImportWizardProps) {
  return null;
}
