// Sous-onglet Correspondances (§5) : rapprochement nom réalisé ↔ personne du plan, confirmation des alias fuzzy.
import { useMemo, useState } from 'react';
import { Alert, Anchor, Button, Group, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconInfoCircle, IconSearch } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AnalyseResult, Confidence, Correspondance } from '../../api/types';
import { FlagBadge } from '../../components/badges';
import { fmtHours } from '../../lib/format';
import { CONFIDENCE_META, ConfidenceBadge, SortTh, cmp, useSort } from './common';
import { analyseService } from './service';

type Key = 'nom_realise' | 'personne_nom' | 'confidence' | 'nb_ecritures' | 'heures';
const CONF_ORDER: Record<Confidence, number> = { fuzzy: 5, none: 4, alias: 3, matricule: 2, plan: 1 };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export default function CorrespondancesTab({ result }: { result: AnalyseResult }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | Confidence>('all');
  const [q, setQ] = useState('');
  const { sort, toggle } = useSort<Key>({ key: 'confidence', dir: 'desc' });
  const [pending, setPending] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: (c: Correspondance) => analyseService.confirmAlias(c.personne_id!, c.nom_realise),
    onMutate: (c) => setPending(c.nom_realise),
    onSuccess: (_p, c) => {
      notifications.show({
        color: 'green',
        title: 'Alias confirmé',
        message: `« ${c.nom_realise} » est désormais un alias de ${c.personne_nom}.`,
      });
      qc.invalidateQueries({ queryKey: ['analyse'] });
      qc.invalidateQueries({ queryKey: ['personnes'] });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: 'Confirmation impossible', message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => setPending(null),
  });

  const counts = useMemo(() => {
    const c: Partial<Record<Confidence, number>> = {};
    for (const x of result.correspondances) c[x.confidence] = (c[x.confidence] ?? 0) + 1;
    return c;
  }, [result.correspondances]);

  const rows = useMemo(() => {
    const nq = norm(q.trim());
    const list = result.correspondances.filter(
      (c) =>
        (filter === 'all' || c.confidence === filter) &&
        (!nq || norm(`${c.nom_realise} ${c.personne_nom} ${c.ressource}`).includes(nq)),
    );
    const val = (c: Correspondance): string | number => (sort.key === 'confidence' ? CONF_ORDER[c.confidence] : c[sort.key]);
    return list.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(val(a), val(b)) || b.heures - a.heures);
  }, [result.correspondances, filter, q, sort]);

  const segData = [
    { value: 'all', label: `Toutes (${result.correspondances.length})` },
    ...(['fuzzy', 'none', 'alias', 'matricule', 'plan'] as Confidence[])
      .filter((c) => counts[c])
      .map((c) => ({ value: c, label: `${CONFIDENCE_META[c].label.replace(' *', '')} (${counts[c]})` })),
  ];

  return (
    <Stack gap="md">
      {(counts.fuzzy ?? 0) > 0 && (
        <Alert color="yellow" variant="light" icon={<IconInfoCircle size={18} />}>
          {counts.fuzzy} correspondance{(counts.fuzzy ?? 0) > 1 ? 's' : ''} approximative{(counts.fuzzy ?? 0) > 1 ? 's' : ''} (nom
          normalisé). Confirmez-les pour alimenter les alias du référentiel Personne : elles seront ensuite rapprochées avec
          certitude.
        </Alert>
      )}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <SegmentedControl data={segData} value={filter} onChange={(v) => setFilter(v as 'all' | Confidence)} size="xs" />
        <TextInput
          placeholder="Rechercher un nom…"
          leftSection={<IconSearch size={14} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={{ base: '100%', sm: 260 }}
          aria-label="Rechercher une correspondance"
        />
      </Group>

      {rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Aucune correspondance.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={860}>
          <Table striped highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <Table.Thead>
              <Table.Tr>
                <SortTh k="nom_realise" sort={sort} onSort={toggle}>
                  Nom au réalisé
                </SortTh>
                <SortTh k="personne_nom" sort={sort} onSort={toggle}>
                  Personne / ressource rapprochée
                </SortTh>
                <SortTh k="confidence" sort={sort} onSort={toggle}>
                  Confiance
                </SortTh>
                <SortTh k="nb_ecritures" sort={sort} onSort={toggle} align="right">
                  Écritures
                </SortTh>
                <SortTh k="heures" sort={sort} onSort={toggle} align="right">
                  Heures
                </SortTh>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <Table.Tr key={`${c.nom_normalise}|${c.personne_id ?? ''}`}>
                  <Table.Td>
                    <Text size="sm">
                      {c.nom_realise || '—'}
                      {c.confidence === 'fuzzy' && (
                        <Text span c="yellow.8" fw={700} title="Correspondance approximative (nom normalisé)">
                          {' '}*
                        </Text>
                      )}
                    </Text>
                    {c.nom_normalise && (
                      <Text size="xs" c="dimmed" ff="monospace">
                        {c.nom_normalise}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {c.personne_id ? (
                      <>
                        <Text size="sm">{c.personne_nom}</Text>
                        {c.ressource && (
                          <Text size="xs" c="dimmed" ff="monospace">
                            {c.ressource}
                          </Text>
                        )}
                      </>
                    ) : (
                      <FlagBadge flag="hors_plan" />
                    )}
                  </Table.Td>
                  <Table.Td>
                    <ConfidenceBadge confidence={c.confidence} />
                  </Table.Td>
                  <Table.Td ta="right">{c.nb_ecritures}</Table.Td>
                  <Table.Td ta="right">{fmtHours(c.heures)}</Table.Td>
                  <Table.Td>
                    {c.confidence === 'fuzzy' && c.personne_id ? (
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconCheck size={14} />}
                        loading={pending === c.nom_realise}
                        disabled={confirm.isPending && pending !== c.nom_realise}
                        onClick={() => confirm.mutate(c)}
                      >
                        Confirmer cet alias
                      </Button>
                    ) : c.confidence === 'none' ? (
                      <Anchor component={Link} to="/referentiels" size="sm">
                        Créer un alias dans les référentiels
                      </Anchor>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
