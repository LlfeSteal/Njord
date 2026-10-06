// Petits composants partagés des référentiels.
import { Tag } from '../../ui';
import type { Personne } from '../../api/types';

/** Statut de fiche : validée (point vert) ou brouillon (anneau orange, à traiter). */
export function PersonneStatutBadge({ statut }: { statut: Personne['statut'] }) {
  return statut === 'validee' ? (
    <Tag tone="success" glyph="dot">
      validée
    </Tag>
  ) : (
    <Tag tone="warning" glyph="ring">
      brouillon
    </Tag>
  );
}
