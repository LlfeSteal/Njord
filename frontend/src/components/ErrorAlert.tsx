import { Alert } from '@mantine/core';
import { ApiError } from '../api/client';

/** Affiche une erreur d'API (message métier) ou générique. */
export default function ErrorAlert({ error, title = 'Erreur' }: { error: unknown; title?: string }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <Alert color="red" title={title} variant="light">
      {msg}
    </Alert>
  );
}
