// Onglet Personnes : recherche, liste, ouverture de la fiche (panneau latéral).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  EmptyState,
  Group,
  Link,
  Pagination,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  Spinner,
  Stack,
  Table,
  Text,
  useDebouncedValue,
} from '../../ui';
import { IconUser } from '../../ui/Icons';
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
    <Stack gap={8}>
      <Group justify="between" gap={8}>
        <Group gap={8} wrap={false}>
          <SearchField
            aria-label="Rechercher une personne"
            placeholder="Nom, alias, matricule…"
            value={search}
            onChange={setSearch}
            width={320}
          />
          {q.isFetching && !q.isLoading && <Spinner label="Recherche en cours" />}
        </Group>
        <SegmentedControl<StatutFilter>
          aria-label="Filtrer par statut"
          equal={false}
          value={statut}
          onChange={setStatut}
          data={[
            { value: 'all', label: 'Toutes' },
            { value: 'brouillon', label: 'Brouillons', count: nbBrouillons },
            { value: 'validee', label: 'Validées' },
          ]}
        />
      </Group>

      <ErrorAlert error={q.error} />
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : pageRows.length === 0 ? (
        <EmptyState icon={<IconUser size={40} />} title="Aucune personne">
          {debounced || statut !== 'all' ? 'Aucune personne ne correspond à la recherche.' : undefined}
        </EmptyState>
      ) : (
        <>
          <Text size="sm" tone="secondary" tabular>
            {rows.length} personne{rows.length > 1 ? 's' : ''}
          </Text>
          <Table striped hover minWidth={760}>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Statut</th>
                <th>Squad</th>
                <th>Matricules</th>
                <th data-align="right">Alias</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => (
                <tr key={p.id} data-clickable onClick={() => setOpen(p.id)}>
                  <td>
                    {/* Le lien ouvre la fiche au clavier ; on évite le double déclenchement par la ligne. */}
                    <span onClick={(e) => e.stopPropagation()}>
                      <Link onClick={() => setOpen(p.id)}>{p.display_name}</Link>
                    </span>
                  </td>
                  <td>
                    <PersonneStatutBadge statut={p.statut} />
                  </td>
                  <td>
                    {squads.label(p.squad_id) || (
                      <Text as="span" tone="secondary">
                        —
                      </Text>
                    )}
                  </td>
                  <td>
                    <MatriculesList matricules={p.matricules} />
                  </td>
                  <td data-align="right">{p.alias?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {totalPages > 1 && (
            <Group justify="end">
              <Pagination page={Math.min(page, totalPages)} total={totalPages} onChange={setPage} />
            </Group>
          )}
        </>
      )}

      <PersonneDrawer personneId={openId} onClose={() => setOpen(null)} onSwitch={(id) => setOpen(id)} />
    </Stack>
  );
}
