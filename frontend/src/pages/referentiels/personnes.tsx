// Page « Personnes » (/personnes) : liste filtrable ; la fiche s'ouvre dans l'inspecteur (?personne=<id>).
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  EmptyState,
  Group,
  Page,
  PageToolbar,
  Pagination,
  SearchField,
  SegmentedControl,
  SkeletonRows,
  Spinner,
  Table,
  useDebouncedValue,
} from '../../ui';
import { IconUser } from '../../ui/Icons';
import { referentielApi } from '../../api/client';
import ErrorAlert from '../../components/ErrorAlert';
import { qk } from '../../lib/queryKeys';
import { useSquadIndex } from './hooks';
import PersonneInspector from './PersonneInspector';
import { PersonneStatutBadge } from './shared';
import './referentiels.css';

const PAGE_SIZE = 50;
type StatutFilter = 'all' | 'brouillon' | 'validee';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export default function PersonnesPage() {
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
  // Liste complète (même requête que sans recherche) : compteurs du sous-titre.
  const all = useQuery({ queryKey: qk.personnes(''), queryFn: () => referentielApi.personnes() });

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((p) => statut === 'all' || p.statut === statut)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr')),
    [q.data, statut],
  );
  useEffect(() => setPage(1), [debounced, statut]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const nbBrouillons = (q.data ?? []).filter((p) => p.statut === 'brouillon').length;

  const total = all.data?.length;
  const totalBrouillons = all.data?.filter((p) => p.statut === 'brouillon').length ?? 0;
  const subtitle = total == null ? undefined : `${plural(total, 'personne')} · ${plural(totalBrouillons, 'brouillon')}`;

  const setOpen = (id: string | null) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (id) n.set('personne', id);
      else n.delete('personne');
      return n;
    });

  const onRowKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(id);
    }
  };

  const toolbar = (
    <PageToolbar
      title="Personnes"
      subtitle={subtitle}
      bottom={
        <Group gap={8} wrap={false}>
          <SearchField
            aria-label="Rechercher une personne"
            placeholder="Nom ou prénom…"
            value={search}
            onChange={setSearch}
            width={280}
          />
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
          {q.isFetching && !q.isLoading && <Spinner size={12} label="Recherche en cours" />}
        </Group>
      }
    />
  );

  return (
    <Page
      toolbar={toolbar}
      inspector={<PersonneInspector personneId={openId} onClose={() => setOpen(null)} />}
    >
      <ErrorAlert error={q.error} />
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : pageRows.length === 0 ? (
        <EmptyState icon={<IconUser size={40} />} title="Aucune personne">
          {debounced || statut !== 'all' ? 'Aucune personne ne correspond à la recherche.' : undefined}
        </EmptyState>
      ) : (
        <>
          <Table hover minWidth={640}>
            <thead>
              <tr>
                <th style={{ width: '45%' }}>Nom</th>
                <th style={{ width: 120 }}>Statut</th>
                <th>Squad</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => {
                const squadPath = squads.label(p.squad_id);
                return (
                  <tr
                    key={p.id}
                    data-clickable
                    data-selected={p.id === openId || undefined}
                    tabIndex={0}
                    onClick={() => setOpen(p.id)}
                    onKeyDown={(e) => onRowKey(e, p.id)}
                  >
                    <td className="ref-ellipsis ref-name" title={p.display_name}>
                      {p.display_name}
                    </td>
                    <td data-nowrap>
                      <PersonneStatutBadge statut={p.statut} />
                    </td>
                    <td className={squadPath ? 'ref-ellipsis' : 'ref-ellipsis ref-muted'} title={squadPath || undefined}>
                      {squads.name(p.squad_id) || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination
            page={current}
            total={totalPages}
            onChange={setPage}
            summary={totalPages > 1 ? `${rows.length} personnes` : undefined}
          />
        </>
      )}
    </Page>
  );
}
