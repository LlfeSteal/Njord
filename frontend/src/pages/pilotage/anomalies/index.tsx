// Page Pilotage « Anomalies » (/anomalies) : boîte de réception du contrôleur, façon Mail.
// Liste groupée par catégorie à gauche, lecture et traitement à droite (Inspector sur écran étroit).
// URL : ?vue= (a_traiter|traitees|ignorees|toutes), ?categorie=, ?gravite=, ?ct=, ?q=, ?key= (anomalie ouverte).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ActiveFilters,
  Button,
  EmptyState,
  FilterButton,
  Group,
  Inspector,
  Page,
  PageToolbar,
  SearchField,
  SegmentedControl,
  Select,
  Stack,
  StatusGlyph,
  type ActiveFilter,
} from '../../../ui';
import type { Anomalie, AnomalieCategorie } from '../../../api/types';
import ContextControl from '../shared/ContextControl';
import { useAnalyse } from '../shared/context';
import { AnalyseGate } from './AnalyseGate';
import { AnomalyActions, AnomalyBody, AnomalyHeader } from './AnomalyDetail';
import AnomalyList, { AnomalyGlyph, type AnomalyGroup } from './AnomalyList';
import { useFillHeight, useMediaQuery } from './hooks';
import {
  CATEGORIES,
  CATEGORIE_LABEL,
  GRAVITE_LABEL,
  VUES,
  anomalySubtitle,
  inVue,
  isAnalyseShown,
  norm,
  readVue,
  searchText,
  type Vue,
} from './meta';
import { useSuivi, type SuiviAction, type SuiviOverride, type SuiviVars } from './useSuivi';
import './anomalies.css';

type Patch = Partial<Record<'vue' | 'categorie' | 'gravite' | 'ct' | 'q' | 'key', string | null>>;

const GRAVITES = (['3', '2', '1'] as const).map((g) => ({ value: g, label: GRAVITE_LABEL[Number(g) as 1 | 2 | 3] }));

/** Champ de saisie ou menu : les raccourcis de la boîte ne s'y appliquent pas. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]:not(.anom-list)');

export default function AnomaliesPage() {
  const analyse = useAnalyse();
  const shown = isAnalyseShown(analyse);
  const narrow = useMediaQuery('(max-width: 1100px)');

  // ---------------------------------------------------------------- État d'URL
  const [sp, setSp] = useSearchParams();
  const vue = readVue(sp.get('vue'));
  const categorieRaw = sp.get('categorie');
  const categorie = CATEGORIES.includes(categorieRaw as AnomalieCategorie) ? (categorieRaw as AnomalieCategorie) : null;
  const graviteRaw = sp.get('gravite');
  const gravite = graviteRaw === '1' || graviteRaw === '2' || graviteRaw === '3' ? graviteRaw : null;
  const ct = sp.get('ct') || null;
  const q = sp.get('q') ?? '';
  const key = sp.get('key');
  const patch = useCallback(
    (p: Patch) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(p)) {
            if (v == null || v === '' || (k === 'vue' && v === 'a_traiter')) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );

  // ---------------------------------------------------------------- Données (+ statuts appliqués localement)
  const [overrides, setOverrides] = useState<Record<string, SuiviOverride>>({});
  const updatedAt = analyse.result.dataUpdatedAt;
  const raw = analyse.result.data?.anomalies;
  const anomalies = useMemo<Anomalie[]>(
    () =>
      (raw ?? []).map((a) => {
        const o = overrides[a.key];
        return o && o.at > updatedAt ? { ...a, statut: o.statut, suivi: o.suivi } : a;
      }),
    [raw, overrides, updatedAt],
  );

  const counts = useMemo(() => {
    let todo = 0;
    let done = 0;
    for (const a of anomalies) {
      if (a.statut === 'a_traiter') todo += 1;
      else if (a.statut === 'traitee') done += 1;
    }
    return { todo, done };
  }, [anomalies]);

  const ctOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of anomalies) if (a.ct) m.set(a.ct, a.ct_libelle ?? '');
    const opts = [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
      .map(([value, l]) => ({ value, label: l ? `${value} — ${l}` : value }));
    return ct && !m.has(ct) ? [{ value: ct, label: ct }, ...opts] : opts;
  }, [anomalies, ct]);

  const { groups, flat } = useMemo(() => {
    const nq = norm(q.trim());
    const visible = anomalies.filter(
      (a) =>
        inVue(a, vue) &&
        (!categorie || a.categorie === categorie) &&
        (!gravite || a.gravite === Number(gravite)) &&
        (!ct || a.ct === ct) &&
        (!nq || searchText(a).includes(nq)),
    );
    const g: AnomalyGroup[] = CATEGORIES.map((c) => ({ categorie: c, items: visible.filter((a) => a.categorie === c) })).filter(
      (x) => x.items.length > 0,
    );
    return { groups: g, flat: g.flatMap((x) => x.items) };
  }, [anomalies, vue, categorie, gravite, ct, q]);

  // Écran large : la première anomalie est ouverte par défaut, comme dans Mail.
  const selected = flat.find((a) => a.key === key) ?? (narrow ? undefined : flat[0]);
  const selectedKey = selected?.key ?? null;

  // ---------------------------------------------------------------- Traitement
  const [draft, setDraft] = useState({ key: '', text: '' });
  const comment = draft.key === selectedKey ? draft.text : '';

  // Valeurs courantes lues par les rappels asynchrones et les raccourcis (sans fermeture périmée).
  const latest = useRef({ selected, flat, vue, comment, patch, busy: false });

  const onApplied = useCallback((vars: SuiviVars, o: SuiviOverride) => {
    setOverrides((prev) => ({ ...prev, [vars.a.key]: o }));
    const cur = latest.current;
    // Sélection suivante seulement si l'utilisateur est resté sur l'anomalie traitée.
    if (vars.next !== undefined && (cur.selected?.key ?? null) === vars.a.key) cur.patch({ key: vars.next });
  }, []);
  const suivi = useSuivi(onApplied);
  const { mutate } = suivi;
  const pending = suivi.isPending ? suivi.variables.action : null;
  useEffect(() => {
    latest.current = { selected, flat, vue, comment, patch, busy: suivi.isPending };
  });

  const run = useCallback(
    (action: SuiviAction) => {
      const { selected: a, flat: list, vue: v, comment: text, busy } = latest.current;
      if (!a || busy) return;
      // Comme Mail : après traitement, on passe à l'anomalie suivante (ou précédente en fin de liste).
      const leaves = action !== 'rouvrir' || v !== 'toutes';
      const i = list.findIndex((x) => x.key === a.key);
      const next = leaves ? (list[i + 1] ?? list[i - 1])?.key ?? null : undefined;
      mutate({ a, action, commentaire: text, next });
    },
    [mutate],
  );

  // Raccourcis discrets : E traitée, I ignorée ; flèches quand rien n'a le focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const { selected: a, flat: list, patch: p } = latest.current;
      const k = e.key.toLowerCase();
      if ((k === 'e' || k === 'i') && a?.statut === 'a_traiter') {
        e.preventDefault();
        run(k === 'e' ? 'traitee' : 'ignoree');
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target === document.body && list.length) {
        e.preventDefault();
        const i = list.findIndex((x) => x.key === a?.key);
        const n = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
        p({ key: list[n].key });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  // ---------------------------------------------------------------- Filtres
  const filterCount = [categorie, gravite, ct].filter(Boolean).length;
  const active: ActiveFilter[] = [];
  if (categorie) active.push({ key: 'categorie', label: CATEGORIE_LABEL[categorie], onRemove: () => patch({ categorie: null }) });
  if (gravite)
    active.push({ key: 'gravite', label: `Gravité ${GRAVITE_LABEL[Number(gravite) as 1 | 2 | 3].toLowerCase()}`, onRemove: () => patch({ gravite: null }) });
  if (ct) active.push({ key: 'ct', label: `CT : ${ct}`, onRemove: () => patch({ ct: null }) });
  const clearFilters = () => patch({ categorie: null, gravite: null, ct: null, q: null });

  const bottom = (
    <Group gap={8}>
      <SegmentedControl<Vue> aria-label="Vue" equal={false} value={vue} onChange={(v) => patch({ vue: v, key: null })} data={VUES} />
      <SearchField value={q} onChange={(v) => patch({ q: v })} placeholder="Rechercher une anomalie" aria-label="Rechercher une anomalie" />
      <FilterButton count={filterCount} onReset={() => patch({ categorie: null, gravite: null, ct: null })}>
        <Stack gap={12}>
          <Select<AnomalieCategorie>
            label="Catégorie"
            placeholder="Toutes"
            data={CATEGORIES.map((c) => ({ value: c, label: CATEGORIE_LABEL[c] }))}
            value={categorie}
            onChange={(v) => patch({ categorie: v })}
            clearable
            width="100%"
          />
          <Select<'1' | '2' | '3'>
            label="Gravité"
            placeholder="Toutes"
            data={GRAVITES}
            value={gravite}
            onChange={(v) => patch({ gravite: v })}
            clearable
            width="100%"
          />
          <Select
            label="CT"
            placeholder="Tous"
            data={ctOptions}
            value={ct}
            onChange={(v) => patch({ ct: v })}
            searchable
            clearable
            menuWidth={290}
            nothingFound="Aucun CT"
            width="100%"
          />
        </Stack>
      </FilterButton>
      <ActiveFilters items={active} onClearAll={active.length > 1 ? () => patch({ categorie: null, gravite: null, ct: null }) : undefined} />
    </Group>
  );

  const toolbar = (
    <PageToolbar
      title="Anomalies"
      subtitle={shown ? `${counts.todo} à traiter · ${counts.done} traitée${counts.done > 1 ? 's' : ''}` : undefined}
      actions={<ContextControl analyse={analyse} />}
      bottom={shown ? bottom : undefined}
    />
  );

  // ---------------------------------------------------------------- Rendu
  const splitRef = useRef<HTMLDivElement>(null);
  const height = useFillHeight(splitRef, shown && !narrow && flat.length > 0);

  const actions = selected && (
    <AnomalyActions
      a={selected}
      comment={comment}
      onComment={(text) => setDraft({ key: selected.key, text })}
      onAction={run}
      pending={pending}
    />
  );

  let content;
  if (!shown) content = <AnalyseGate analyse={analyse} />;
  else if (flat.length === 0) content = <Empty vue={vue} filtered={filterCount > 0 || !!q.trim()} total={anomalies.length} onClear={clearFilters} />;
  else if (narrow)
    content = (
      <div className="anom-card" aria-busy={analyse.result.isPlaceholderData || undefined}>
        <AnomalyList groups={groups} flat={flat} selectedKey={selectedKey} onSelect={(k) => patch({ key: k })} dimDone={vue === 'toutes'} />
      </div>
    );
  else
    content = (
      <div ref={splitRef} className="anom-split" style={{ height }} aria-busy={analyse.result.isPlaceholderData || undefined}>
        <div className="anom-split__list">
          <AnomalyList groups={groups} flat={flat} selectedKey={selectedKey} onSelect={(k) => patch({ key: k })} dimDone={vue === 'toutes'} />
        </div>
        <section className="anom-split__detail" aria-label="Détail de l'anomalie">
          {selected && (
            <>
              <div className="anom-split__scroll">
                <div className="anom-split__read">
                  <AnomalyHeader a={selected} />
                  <AnomalyBody a={selected} />
                </div>
              </div>
              <div className="anom-split__footer">
                <div className="anom-split__read">{actions}</div>
              </div>
            </>
          )}
        </section>
      </div>
    );

  const inspector =
    shown && narrow ? (
      <Inspector
        opened={!!selected}
        onClose={() => patch({ key: null })}
        title={selected?.titre}
        subtitle={selected ? anomalySubtitle(selected) : undefined}
        accessory={selected ? <AnomalyGlyph a={selected} /> : undefined}
        footer={actions}
      >
        {selected && <AnomalyBody a={selected} />}
      </Inspector>
    ) : undefined;

  return (
    <Page toolbar={toolbar} inspector={inspector} wide>
      {content}
    </Page>
  );
}

function Empty({ vue, filtered, total, onClear }: { vue: Vue; filtered: boolean; total: number; onClear: () => void }) {
  if (filtered)
    return (
      <EmptyState title="Aucune anomalie ne correspond" action={<Button onClick={onClear}>Effacer les filtres</Button>}>
        Modifiez la recherche ou les filtres.
      </EmptyState>
    );
  if (vue === 'a_traiter')
    return (
      <EmptyState icon={<StatusGlyph kind="success" tone="success" size={40} />} title="Rien à traiter">
        {total > 0 ? 'Toutes les anomalies de la période ont été traitées.' : 'Aucune anomalie détectée sur la période.'}
      </EmptyState>
    );
  if (vue === 'traitees') return <EmptyState title="Aucune anomalie traitée" />;
  if (vue === 'ignorees') return <EmptyState title="Aucune anomalie ignorée" />;
  return <EmptyState title="Aucune anomalie">Aucune anomalie détectée sur la période.</EmptyState>;
}
