// Onglet Personnes : recherche, liste, ouverture de la fiche (drawer).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Anchor,
  Center,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import ErrorAlert from '../../components/ErrorAlert';
import { qk } from '../../lib/queryKeys';
import { useSquadIndex } from './hooks';
import PersonneDrawer from './PersonneDrawer';
import { MatriculesList, PersonneStatutBadge } from './shared';

const PAGE_SIZE = 50;
type StatutFilter = 'all' | 'brouillon' | 'validee';

export default function PersonnesTab() {
  const [sp, setSp] = useSearchParams();
  const openId = sp.get('personne');
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [statut, setStatut] = useState<StatutFilter>('all');
  const [page, setPage] = useState(1);
  const squads = useSquadIndex();

  const q = useQuery({
    queryKey: qk.personnes(debounced),
    queryFn: () => referentielApi.personnes(debounced || undefined),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((p) => statut === 'all' || p.statut === statut)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr')),
    [q.data, statut],
  );
  useEffect(() => setPage(1), [debounced, statut]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((Math.min(page, totalPages) - 1) * PAGE_SIZE, Math.min(page, totalPages) * PAGE_SIZE);
  const nbBrouillons = (q.data ?? []).filter((p) => p.statut === 'brouillon').length;

  const setOpen = (id: string | null) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set('personne', id);
      else n.delete('personne');
      return n;
    });

  return (
    <>
      <Group justify="space-between" align="flex-end" mb="sm" wrap="wrap">
        <TextInput
          label="Rechercher"
          placeholder="Nom, alias, matricule…"
          leftSection={<IconSearch size={16} />}
          rightSection={q.isFetching ? <Loader size="xs" /> : undefined}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={{ base: '100%', sm: 320 }}
        />
        <SegmentedControl
          aria-label="Filtrer par statut"
          value={statut}
          onChange={(v) => setStatut(v as StatutFilter)}
          data={[
            { value: 'all', label: 'Toutes' },
            { value: 'brouillon', label: `Brouillons (${nbBrouillons})` },
            { value: 'validee', label: 'Validées' },
          ]}
        />
      </Group>

      <ErrorAlert error={q.error} />
      {q.isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          <Text size="xs" c="dimmed" mb={4}>
            {rows.length} personne{rows.length > 1 ? 's' : ''}
          </Text>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover verticalSpacing="xs" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nom</Table.Th>
                  <Table.Th>Statut</Table.Th>
                  <Table.Th>Squad</Table.Th>
                  <Table.Th>Matricules</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Alias</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text c="dimmed" ta="center" py="md">
                        Aucune personne.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {pageRows.map((p) => (
                  <Table.Tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
                    <Table.Td>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(p.id);
                        }}
                      >
                        {p.display_name}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <PersonneStatutBadge statut={p.statut} />
                    </Table.Td>
                    <Table.Td>{squads.label(p.squad_id) || <Text span c="dimmed">—</Text>}</Table.Td>
                    <Table.Td>
                      <MatriculesList matricules={p.matricules} />
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{p.alias?.length ?? 0}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {totalPages > 1 && (
            <Group justify="flex-end" mt="sm">
              <Pagination size="sm" total={totalPages} value={Math.min(page, totalPages)} onChange={setPage} />
            </Group>
          )}
        </>
      )}

      <PersonneDrawer personneId={openId} onClose={() => setOpen(null)} onSwitch={(id) => setOpen(id)} />
    </>
  );
}
