// Petits composants partagés des référentiels (réutilisés par l'onglet Plan de charge).
import type { ReactNode } from 'react';
import { Table, Tag, Text } from '../../ui';
import type { AliasSource, Personne } from '../../api/types';

const ALIAS_SOURCE: Record<AliasSource, { label: string; title: string }> = {
  import: { label: 'import', title: "Créé automatiquement à l'import" },
  manuel: { label: 'manuel', title: 'Saisi manuellement' },
  confirme: { label: 'confirmé', title: "Confirmé depuis l'onglet Analyse" },
};

/** Origine d'un alias : simple mention secondaire (pas un statut). */
export function AliasSourceBadge({ source }: { source: AliasSource }) {
  const m = ALIAS_SOURCE[source] ?? { label: source, title: source };
  return (
    <Text as="span" size="sm" tone="secondary" title={m.title}>
      {m.label}
    </Text>
  );
}

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

export function MatriculesList({ matricules }: { matricules: string[] }) {
  if (!matricules?.length) return <Text as="span" tone="secondary">—</Text>;
  return (
    <Text as="span" mono>
      {matricules.join(', ')}
    </Text>
  );
}

/** Table compacte des alias (lecture seule) ; `actions` optionnel par alias. */
export function AliasTable({
  personne,
  actions,
}: {
  personne: Personne;
  actions?: (a: Personne['alias'][number]) => ReactNode;
}) {
  if (!personne.alias?.length) return <Text tone="secondary">Aucun alias.</Text>;
  return (
    <Table compact card={false}>
      <tbody>
        {personne.alias.map((a) => (
          <tr key={a.id}>
            <td>{a.alias}</td>
            <td style={{ width: 90 }}>
              <AliasSourceBadge source={a.source} />
            </td>
            {actions && (
              <td data-actions style={{ width: 40 }}>
                {actions(a)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
