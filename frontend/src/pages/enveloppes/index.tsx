// Page « Enveloppes » (/enveloppes) : période d'utilisation et montant de l'enveloppe de chaque CT (DECISIONS n° 18).
// Liste filtrable ; l'enveloppe se saisit dans l'inspecteur (?ct=<code>).
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
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
import { IconEuro } from '../../ui/Icons';
import type { EnveloppeCT } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtPeriod } from '../../lib/format';
import EnveloppeInspector from './EnveloppeInspector';
import { fmtMontant, norm, useEnveloppes } from './hooks';
import { SourcePills } from './shared';
import './enveloppes.css';

const PAGE_SIZE = 50;
type ConfigFilter = 'all' | 'todo' | 'done';

export default function EnveloppesPage() {
  const [sp, setSp] = useSearchParams();
  const openCt = sp.get('ct');
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(norm(search.trim()), 200);
  const [filter, setFilter] = useState<ConfigFilter>('all');
  const [page, setPage] = useState(1);

  const q = useEnveloppes();
  const all = useMemo(() => q.data ?? [], [q.data]);

  const matching = useMemo(
    () => (debounced ? all.filter((r) => norm(r.ct).includes(debounced) || norm(r.ct_libelle).includes(debounced)) : all),
    [all, debounced],
  );
  const rows = useMemo(
    () =>
      matching.filter((r) => filter === 'all' || (filter === 'todo' ? r.enveloppe == null : r.enveloppe != null)),
    [matching, filter],
  );
  useEffect(() => setPage(1), [debounced, filter]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const countTodo = (list: EnveloppeCT[]) => list.filter((r) => r.enveloppe == null).length;
  const nbTodo = countTodo(matching);

  const subtitle = useMemo(() => {
    if (!q.data) return undefined;
    const total = q.data.reduce((s, r) => s + (r.enveloppe?.montant ?? 0), 0);
    return `${q.data.length} CT · ${countTodo(q.data)} à configurer · ${fmtMontant(total)} d'enveloppes`;
  }, [q.data]);

  const setOpen = (ct: string | null) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (ct) n.set('ct', ct);
      else n.delete('ct');
      return n;
    });

  const onRowKey = (e: KeyboardEvent, ct: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(ct);
    }
  };

  const toolbar = (
    <PageToolbar
      title="Enveloppes"
      subtitle={subtitle}
      bottom={
        <Group gap={8} wrap={false}>
          <SearchField
            aria-label="Rechercher un CT"
            placeholder="CT ou libellé…"
            value={search}
            onChange={setSearch}
            width={280}
          />
          <SegmentedControl<ConfigFilter>
            aria-label="Filtrer par configuration"
            equal={false}
            value={filter}
            onChange={setFilter}
            data={[
              { value: 'all', label: 'Tous' },
              { value: 'todo', label: 'À configurer', count: nbTodo },
              { value: 'done', label: 'Configurés' },
            ]}
          />
          {q.isFetching && !q.isLoading && <Spinner size={12} label="Actualisation" />}
        </Group>
      }
    />
  );

  const empty =
    all.length === 0 ? (
      <EmptyState
        icon={<IconEuro size={40} />}
        title="Aucun CT"
        action={
          <Group gap={8}>
            <Button to="/plan">Plan de charge</Button>
            <Button to="/realise">Réalisé</Button>
            <Button to="/provisions">Provisions</Button>
          </Group>
        }
      >
        Importez un plan de charge, un réalisé ou des provisions : leurs CT apparaîtront ici.
      </EmptyState>
    ) : (
      <EmptyState icon={<IconEuro size={40} />} title="Aucun CT">
        Aucun CT ne correspond à la recherche.
      </EmptyState>
    );

  return (
    <Page toolbar={toolbar} inspector={<EnveloppeInspector key={openCt ?? ''} ct={openCt} onClose={() => setOpen(null)} />}>
      <ErrorAlert error={q.error} />
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.error && !q.data ? null : pageRows.length === 0 ? (
        empty
      ) : (
        <>
          <Table hover minWidth={720}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>CT</th>
                <th>Libellé</th>
                <th style={{ width: 200 }}>Sources</th>
                <th style={{ width: 210 }}>Période</th>
                <th data-align="right" style={{ width: 130 }}>
                  Enveloppe
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const e = r.enveloppe;
                return (
                  <tr
                    key={r.ct}
                    data-clickable
                    data-selected={r.ct === openCt || undefined}
                    tabIndex={0}
                    onClick={() => setOpen(r.ct)}
                    onKeyDown={(ev) => onRowKey(ev, r.ct)}
                  >
                    <td data-mono data-nowrap>
                      {r.ct}
                    </td>
                    <td className={r.ct_libelle ? 'env-ellipsis' : 'env-ellipsis env-muted'} title={r.ct_libelle || undefined}>
                      {r.ct_libelle || '—'}
                    </td>
                    <td data-nowrap>
                      <SourcePills sources={r.sources} />
                    </td>
                    <td data-nowrap className={e ? undefined : 'env-muted'}>
                      {e ? fmtPeriod(e.date_debut, e.date_fin) : '—'}
                    </td>
                    <td data-align="right" data-nowrap className={e ? undefined : 'env-muted'}>
                      {e ? fmtMontant(e.montant) : 'À configurer'}
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
            summary={totalPages > 1 ? `${rows.length} CT` : undefined}
          />
        </>
      )}
    </Page>
  );
}
