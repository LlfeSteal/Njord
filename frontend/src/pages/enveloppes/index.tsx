// Page « Enveloppes » (/enveloppes, DECISIONS n° 18 et 27) : enveloppes par CT saisies dans l'interface.
// Tableau hiérarchique : une ligne de groupe par libellé de catégorie (Σ montants), puis « Hors catégorie », puis
// « Sans enveloppe » (CT connus des sources sans enveloppe). Clic sur un CT → inspecteur éditable (?ct=<code>) ;
// « Nouvelle enveloppe » → inspecteur en création (CT saisi).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  EmptyState,
  Group,
  Page,
  PageToolbar,
  SearchField,
  SkeletonRows,
  Spinner,
  Table,
  useDebouncedValue,
} from '../../ui';
import { IconChevronRight, IconEuro, IconPlus } from '../../ui/Icons';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtPeriod } from '../../lib/format';
import EnveloppeInspector from './EnveloppeInspector';
import { fmtMontant, groupByCategorie, nEnveloppes, norm, useEnveloppes, type EnveloppeGroup } from './hooks';
import { SourcePills } from './shared';
import './enveloppes.css';

const COLS = 5;

/** Sous-titre : « N enveloppes · Σ montant ». */
function summaryLine(cts: { enveloppe: { montant: number } | null }[]) {
  const withEnv = cts.filter((r) => r.enveloppe != null);
  if (withEnv.length === 0) return 'Aucune enveloppe';
  const total = withEnv.reduce((s, r) => s + (r.enveloppe?.montant ?? 0), 0);
  return `${nEnveloppes(withEnv.length)} · ${fmtMontant(total)}`;
}

export default function EnveloppesPage() {
  const [sp, setSp] = useSearchParams();
  const openCt = sp.get('ct');
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(norm(search.trim()), 200);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);

  const q = useEnveloppes();
  const all = useMemo(() => q.data?.cts ?? [], [q.data]);

  const matching = useMemo(
    () =>
      debounced
        ? all.filter(
            (r) =>
              norm(r.ct).includes(debounced) ||
              norm(r.ct_libelle).includes(debounced) ||
              norm(r.categorie_libelle).includes(debounced),
          )
        : all,
    [all, debounced],
  );
  // Tout CT a une enveloppe (DECISIONS n° 28) : plus de filtre Avec / Sans enveloppe.
  const groups = useMemo(() => groupByCategorie(matching), [matching]);

  const setOpen = (ct: string | null) => {
    setCreating(false);
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (ct) n.set('ct', ct);
      else n.delete('ct');
      return n;
    });
  };

  const startCreate = () => {
    setOpen(null);
    setCreating(true);
  };

  const onRowKey = (e: KeyboardEvent, ct: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(ct);
    }
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // Arrivée avec ?ct= (lien « Voir l'enveloppe ») : la ligne est amenée dans la vue une fois la liste chargée.
  const tableRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !openCt || !q.data) return;
    scrolled.current = true;
    const tr = tableRef.current?.querySelector<HTMLElement>(`tr[data-ct="${CSS.escape(openCt)}"]`);
    tr?.scrollIntoView({ block: 'center' });
  }, [openCt, q.data]);

  const toolbar = (
    <PageToolbar
      title="Enveloppes"
      subtitle={q.data ? summaryLine(all) : undefined}
      actions={
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={startCreate}>
          Nouvelle enveloppe
        </Button>
      }
      bottom={
        <Group gap={8} wrap={false}>
          <SearchField
            aria-label="Rechercher un CT"
            placeholder="CT, libellé ou catégorie…"
            value={search}
            onChange={setSearch}
            width={280}
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
        title="Aucune enveloppe"
        action={
          <Button variant="primary" icon={<IconPlus size={15} />} onClick={startCreate}>
            Nouvelle enveloppe
          </Button>
        }
      >
        Créez l'enveloppe d'un CT : sa période et son montant en font le budget, groupé par catégorie. Les CT du plan de
        charge, du réalisé et des provisions apparaissent aussi ici.
      </EmptyState>
    ) : (
      <EmptyState icon={<IconEuro size={40} />} title="Aucun CT">
        Aucun CT ne correspond à la recherche ou au filtre.
      </EmptyState>
    );

  return (
    <Page
      toolbar={toolbar}
      inspector={
        <EnveloppeInspector
          key={creating ? '__creation' : (openCt ?? '')}
          ct={openCt}
          creating={creating}
          onClose={() => setOpen(null)}
          onOpen={(ct) => {
            // Après une création : la nouvelle ligne est amenée dans la vue.
            scrolled.current = false;
            setOpen(ct);
          }}
        />
      }
    >
      <ErrorAlert error={q.error} />
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.error && !q.data ? null : groups.length === 0 ? (
        empty
      ) : (
        <div ref={tableRef}>
          <Table hover minWidth={760}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>CT</th>
                <th>Libellé</th>
                <th style={{ width: 200 }}>Sources</th>
                <th style={{ width: 210 }}>Période</th>
                <th data-align="right" style={{ width: 140 }}>
                  Montant
                </th>
              </tr>
            </thead>
            {groups.map((g) => {
              const open = !collapsed.has(g.key);
              return (
                <tbody key={g.key}>
                  <GroupRow group={g} open={open} onToggle={() => toggle(g.key)} />
                  {open &&
                    g.rows.map((r) => {
                      const e = r.enveloppe;
                      return (
                        <tr
                          key={r.ct}
                          data-ct={r.ct}
                          data-clickable
                          data-selected={r.ct === openCt || undefined}
                          tabIndex={0}
                          onClick={() => setOpen(r.ct)}
                          onKeyDown={(ev) => onRowKey(ev, r.ct)}
                        >
                          <td data-mono data-nowrap className="env-indent">
                            {r.ct}
                          </td>
                          <td
                            className={r.ct_libelle ? 'env-ellipsis' : 'env-ellipsis env-muted'}
                            title={r.ct_libelle || undefined}
                          >
                            {r.ct_libelle || '—'}
                          </td>
                          <td data-nowrap>
                            <SourcePills sources={r.sources} />
                          </td>
                          <td data-nowrap className={e ? undefined : 'env-muted'}>
                            {e ? fmtPeriod(e.date_debut, e.date_fin) : '—'}
                          </td>
                          <td data-align="right" data-nowrap className={e ? undefined : 'env-muted'}>
                            {e ? fmtMontant(e.montant) : 'Sans enveloppe'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              );
            })}
          </Table>
        </div>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ Ligne de groupe

function GroupRow({ group: g, open, onToggle }: { group: EnveloppeGroup; open: boolean; onToggle: () => void }) {
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    onToggle();
  };
  const n = g.rows.length;
  return (
    <tr className="env-group" onClick={onClick}>
      <td colSpan={COLS - 1}>
        <div className="env-group__head">
          <button
            type="button"
            className="env-group__toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Replier' : 'Déplier'} ${g.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <IconChevronRight size={12} stroke={2.2} />
          </button>
          <span className="env-group__label" title={g.label}>
            {g.label}
          </span>
          {g.code && <span className="env-code">{g.code}</span>}
          <span className="env-muted env-group__count">{n} CT</span>
        </div>
      </td>
      <td data-align="right" data-nowrap className="env-group__sum">
        {g.kind === 'sans_enveloppe' ? '' : fmtMontant(g.montant)}
      </td>
    </tr>
  );
}
