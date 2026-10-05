// Point d'entrée d'un module de données (/plan, /realise) : affiche la version courante
// (active, sinon la plus récente non purgée) ; sans aucune version, propose l'import.
import { useState, type ReactNode } from 'react';
import { Button, Card, EmptyState, LoadingBlock, Page, PageToolbar } from '../../ui';
import { IconImport } from '../../ui/Icons';
import type { Kind } from '../../api/types';
import ErrorAlert from '../ErrorAlert';
import ImportWizard from '../ImportWizard';
import { useCurrentVersion } from './useCurrentVersion';

export interface CurrentVersionProps {
  kind: Kind;
  /** Titre de la page vide (« Plan de charge », « Réalisé »). */
  title: string;
  /** Aide de l'état vide. */
  emptyHelp: ReactNode;
  children: (versionId: string) => ReactNode;
}

export default function CurrentVersion({ kind, title, emptyHelp, children }: CurrentVersionProps) {
  const { version, isLoading, error } = useCurrentVersion(kind);
  const [wizard, setWizard] = useState(false);

  if (isLoading) return <LoadingBlock />;
  if (version) return <>{children(version.id)}</>;
  return (
    <Page toolbar={<PageToolbar title={title} />}>
      <ErrorAlert error={error} title="Impossible de charger les versions" />
      {!error && (
        <Card>
          <EmptyState
            title="Aucune version importée"
            action={
              <Button variant="primary" icon={<IconImport size={15} />} onClick={() => setWizard(true)}>
                Importer un fichier
              </Button>
            }
          >
            {emptyHelp}
          </EmptyState>
        </Card>
      )}
      <ImportWizard kind={kind} opened={wizard} onClose={() => setWizard(false)} />
    </Page>
  );
}
