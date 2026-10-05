import { ApiError } from '../api/client';
import { Banner } from '../ui';

/** Affiche une erreur d'API (message métier) ou générique. */
export default function ErrorAlert({ error, title = 'Erreur' }: { error: unknown; title?: string }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <Banner tone="error" title={title}>
      {msg}
    </Banner>
  );
}
