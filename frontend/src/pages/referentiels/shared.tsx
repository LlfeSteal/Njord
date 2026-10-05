// Petits composants partagés des référentiels (réutilisés par l'onglet Plan de charge).
import type { ReactNode } from 'react';
import { Badge, Group, Table, Text } from '@mantine/core';
import type { AliasSource, Personne } from '../../api/types';

const ALIAS_SOURCE: Record<AliasSource, { label: string; color: string; title: string }> = {
  import: { label: 'import', color: 'gray', title: "Créé automatiquement à l'import" },
  manuel: { label: 'manuel', color: 'blue', title: 'Saisi manuellement' },
  confirme: { label: 'confirmé', color: 'teal', title: "Confirmé depuis l'onglet Analyse" },
};

export function AliasSourceBadge({ source }: { source: AliasSource }) {
  const m = ALIAS_SOURCE[source] ?? { label: source, color: 'gray', title: source };
  return (
    <Badge size="sm" variant="light" color={m.color} title={m.title}>
      {m.label}
    </Badge>
  );
}

export function PersonneStatutBadge({ statut }: { statut: Personne['statut'] }) {
  return statut === 'validee' ? (
    <Badge size="sm" variant="light" color="green">
      validée
    </Badge>
  ) : (
    <Badge size="sm" variant="light" color="orange">
      brouillon
    </Badge>
  );
}

export function MatriculesList({ matricules }: { matricules: string[] }) {
  if (!matricules?.length) return <Text size="sm" c="dimmed">—</Text>;
  return (
    <Group gap={4}>
      {matricules.map((m) => (
        <Badge key={m} size="sm" variant="outline" color="gray" style={{ textTransform: 'none', fontFamily: 'monospace' }}>
          {m}
        </Badge>
      ))}
    </Group>
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
  if (!personne.alias?.length) return <Text size="sm" c="dimmed">Aucun alias.</Text>;
  return (
    <Table withRowBorders={false} verticalSpacing={4} fz="sm">
      <Table.Tbody>
        {personne.alias.map((a) => (
          <Table.Tr key={a.id}>
            <Table.Td>{a.alias}</Table.Td>
            <Table.Td w={90}>
              <AliasSourceBadge source={a.source} />
            </Table.Td>
            {actions && <Table.Td w={40}>{actions(a)}</Table.Td>}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
