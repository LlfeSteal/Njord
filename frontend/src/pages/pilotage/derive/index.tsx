// Pilotage « Dérive du plan » (/derive, DECISIONS n° 12) : version de référence vs version comparée,
// par CT ou par personne. Versions, vue et affichage des inchangés dans l'URL (from, to, vue, tous).
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  Group,
  Metric,
  Page,
  PageToolbar,
  SegmentedControl,
  Select,
  SkeletonRows,
  SortHeader,
  Stack,
  Switch,
  Table,
  Tag,
} from '../../../ui';
import { ApiError, planApi } from '../../../api/client';
import type { PlanCompare } from '../../../api/types';
import ErrorAlert from '../../../components/ErrorAlert';
import { useVersionHistory } from '../../../components/lifecycle/useCurrentVersion';
import { fmtDate, fmtEur, fmtHours, fmtHoursSigned } from '../../../lib/format';
import { qk } from '../../../lib/queryKeys';
import { CtLabel } from '../budget/cells';
import { fmtEurSigned } from '../shared/pilotage';
import DeltaBar from './DeltaBar';
import {
  DEFAULT_SORT,
  NON_NOMINATIF,
  STATUT_META,
  countLabel,
  countStatuts,
  fmtPctSigned,
  formatsOf,
  nextSort,
  planLink,
  sortRows,
  statutLabel,
  toRows,
  useDeriveUrl,
  versionLabel,
  type DeriveRow,
  type DeriveVue,
  type Sort,
  type SortKey,
} from './model';
import '../shared/pilotage.css';
import './derive.css';

const VUES: { value: DeriveVue; label: string }[] = [
  { value: 'ct', label: 'Par CT' },
  { value: 'personne', label: 'Par personne' },
];

/** 404 / 409 : erreurs métier, inutile de réessayer. */
const retry = (n: number, e: unknown) => !(e instanceof ApiError && e.status < 500) && n < 1;

// ------------------------------------------------------------------ Chiffres clés

function DeriveMetrics({ data, vue }: { data: PlanCompare; vue: DeriveVue }) {
  const t = data.totaux;
  const dPps = t.pps_to - t.pps_from;
  const dCharge = t.charge_to - t.charge_from;
  const pPps = fmtPctSigned(dPps, t.pps_from);
  const pCharge = fmtPctSigned(dCharge, t.charge_from);
  const c = countStatuts(vue === 'ct' ? data.par_ct : data.par_personne);
  const [nbFrom, nbTo] = vue === 'ct' ? [t.nb_ct_from, t.nb_ct_to] : [t.nb_personnes_from, t.nb_personnes_to];
  return (
    <div className="pil-metrics">
      <Metric label="Δ PPS" value={fmtEurSigned(dPps)} sub={`${fmtEur(t.pps_from)} → ${fmtEur(t.pps_to)}${pPps ? ` · ${pPps}` : ''}`} />
      <Metric
        label="Δ charge"
        value={fmtHoursSigned(dCharge)}
        sub={`${fmtHours(t.charge_from)} → ${fmtHours(t.charge_to)}${pCharge ? ` · ${pCharge}` : ''}`}
      />
      <Metric
        label={vue === 'ct' ? 'CT' : 'Personnes'}
        value={nbFrom === nbTo ? nbTo : `${nbFrom} → ${nbTo}`}
        sub={(['ajoute', 'retire', 'modifie'] as const).map((s) => countLabel(c[s], s, vue)).join(' · ')}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Tableau

/** « 3 CT inchangés masqués. » / « 1 personne inchangée masquée. » */
function hiddenNote(n: number, vue: DeriveVue): string {
  const s = n > 1 ? 's' : '';
  return vue === 'ct' ? `${n} CT inchangé${s} masqué${s}.` : `${n} personne${s} inchangée${s} masquée${s}.`;
}

/** Valeur principale + secondaire (« 12 345 € · 120 h »), « — » quand l'élément est absent de ce côté. */
function Pair({ main, sec, absent }: { main: string; sec: string; absent: boolean }) {
  if (absent) return <span className="derive-sec">—</span>;
  return (
    <span className="derive-pair">
      {main}
      <span className="derive-sec"> · {sec}</span>
    </span>
  );
}

interface DeriveTableProps {
  data: PlanCompare;
  vue: DeriveVue;
  rows: DeriveRow[];
  /** Lignes inchangées masquées. */
  hidden: number;
  onShowAll: () => void;
}

function DeriveTable({ data, vue, rows, hidden, onShowAll }: DeriveTableProps) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  // Échelle commune : max |Δ| des lignes affichées.
  const scale = useMemo(() => Math.max(0, ...rows.map((r) => Math.abs(r.delta))), [rows]);
  const f = formatsOf(vue);
  const t = data.totaux;
  const [tFrom, tTo, tsFrom, tsTo] =
    vue === 'ct' ? [t.pps_from, t.pps_to, t.charge_from, t.charge_to] : [t.charge_from, t.charge_to, t.pps_from, t.pps_to];
  const nameLabel = vue === 'ct' ? 'CT' : 'NOM Prénom';
  const th = (k: SortKey, label: string, right = false) => (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => setSort((s) => nextSort(s, k))} align={right ? 'right' : undefined}>
      {label}
    </SortHeader>
  );

  return (
    <Stack gap={8}>
      <Table hover minWidth={820} className="derive-table" caption={`Dérive du plan ${vue === 'ct' ? 'par CT' : 'par personne'}`}>
        <thead>
          <tr>
            {th('name', nameLabel)}
            <th data-align="right">Référence</th>
            <th data-align="right">Actuelle</th>
            {th('delta', 'Δ', true)}
            <th className="derive-col-bar">Variation</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const link = planLink(r, vue, data);
            const open = () => link && navigate(link);
            const pct = fmtPctSigned(r.delta, r.from);
            const meta = STATUT_META[r.statut];
            return (
              <tr
                key={r.key}
                data-clickable={link ? true : undefined}
                tabIndex={link ? 0 : undefined}
                onClick={link ? open : undefined}
                onKeyDown={
                  link
                    ? (e: KeyboardEvent) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        open();
                      }
                    : undefined
                }
                aria-label={link ? `Ouvrir ${r.name} dans le plan de charge` : undefined}
              >
                <td>
                  {vue === 'ct' ? (
                    <CtLabel ct={r.name} libelle={r.groupe || undefined} />
                  ) : (
                    <span className="derive-name" data-muted={r.name === NON_NOMINATIF || undefined} title={r.name}>
                      {r.name}
                    </span>
                  )}
                </td>
                <td data-align="right" data-nowrap>
                  <Pair main={f.main(r.from)} sec={f.sec(r.secFrom)} absent={r.statut === 'ajoute'} />
                </td>
                <td data-align="right" data-nowrap>
                  <Pair main={f.main(r.to)} sec={f.sec(r.secTo)} absent={r.statut === 'retire'} />
                </td>
                <td data-align="right" data-nowrap>
                  <span className="derive-delta">{f.mainSigned(r.delta)}</span>
                  <span className="derive-sec"> · {f.secSigned(r.secDelta)}</span>
                </td>
                <td className="derive-col-bar">
                  <DeltaBar
                    delta={r.delta}
                    scale={scale}
                    tip={
                      <>
                        <strong>{r.name}</strong>
                        <br />
                        Référence {f.main(r.from)} · Actuelle {f.main(r.to)}
                        <br />Δ {f.mainSigned(r.delta)}
                        {pct ? ` (${pct})` : ''} · {f.secSigned(r.secDelta)}
                      </>
                    }
                  />
                </td>
                <td data-nowrap>
                  <Tag tone={meta.tone} glyph={meta.glyph}>
                    {statutLabel(r.statut, vue)}
                  </Tag>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>
              Total · {vue === 'ct' ? `${t.nb_ct_to} CT` : `${t.nb_personnes_to} personne${t.nb_personnes_to > 1 ? 's' : ''}`}
            </td>
            <td data-align="right" data-nowrap>
              <Pair main={f.main(tFrom)} sec={f.sec(tsFrom)} absent={false} />
            </td>
            <td data-align="right" data-nowrap>
              <Pair main={f.main(tTo)} sec={f.sec(tsTo)} absent={false} />
            </td>
            <td data-align="right" data-nowrap>
              <span className="derive-delta">{f.mainSigned(tTo - tFrom)}</span>
              <span className="derive-sec"> · {f.secSigned(tsTo - tsFrom)}</span>
            </td>
            <td className="derive-col-bar" />
            <td />
          </tr>
        </tfoot>
      </Table>
      {hidden > 0 && (
        <Group gap={8}>
          <p className="pil-note">{hiddenNote(hidden, vue)}</p>
          <Button size="sm" variant="plain" onClick={onShowAll}>
            Afficher
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// ------------------------------------------------------------------ Page

export default function DerivePage() {
  const { state, update } = useDeriveUrl();
  const history = useVersionHistory('plan');
  const versions = useMemo(() => history.data ?? [], [history.data]);

  // Sous ['versions', 'plan'] : invalidée avec les versions après import, archivage ou purge.
  const q = useQuery({
    queryKey: [...qk.versions('plan'), 'compare', { from: state.from ?? null, to: state.to ?? null }],
    queryFn: () => planApi.compare(state.from, state.to),
    placeholderData: keepPreviousData,
    retry,
  });
  const data = q.data;
  const err = q.error instanceof ApiError ? q.error : null;

  // L'URL d'abord (la réponse précédente reste affichée pendant le rechargement), sinon les défauts de l'API.
  const fromId = state.from ?? data?.from.id ?? null;
  const toId = state.to ?? data?.to.id ?? null;
  const options = useMemo(() => {
    const list = versions.map((v) => ({ value: v.id, label: versionLabel(v), description: `${v.nb_lignes} lignes` }));
    // Version de la réponse absente de l'historique (liste pas encore chargée) : reste affichable.
    for (const v of data ? [data.from, data.to] : [])
      if (!list.some((o) => o.value === v.id)) list.push({ value: v.id, label: versionLabel(v), description: `${v.nb_lignes} lignes` });
    return list;
  }, [versions, data]);
  const resetVersions = () => update({ from: null, to: null });

  const allRows = useMemo(() => (data ? toRows(data, state.vue) : []), [data, state.vue]);
  const rows = useMemo(() => (state.tous ? allRows : allRows.filter((r) => r.statut !== 'inchange')), [allRows, state.tous]);
  const hidden = allRows.length - rows.length;

  const subtitle = data
    ? `${data.from.intitule} (${fmtDate(data.from.importee_le)}) → ${data.to.intitule} (${fmtDate(data.to.importee_le)})`
    : undefined;

  // Moins de deux versions : rien à choisir, l'état vide l'explique.
  const tooFew = history.isSuccess && versions.length < 2;
  const bottom = !tooFew && (
    <Group gap={8}>
      <SegmentedControl<DeriveVue> aria-label="Regroupement" equal={false} value={state.vue} onChange={(v) => update({ vue: v })} data={VUES} />
      <span className="derive-pick">
        <span className="derive-pick__label" aria-hidden>
          Référence
        </span>
        <Select
          aria-label="Référence"
          data={options.map((o) => ({ ...o, disabled: o.value === toId }))}
          value={fromId}
          onChange={(v) => v && update({ from: v })}
          placeholder="Version"
          menuWidth={300}
          nothingFound="Aucune version"
        />
      </span>
      <span className="derive-pick">
        <span className="derive-pick__label" aria-hidden>
          Comparée à
        </span>
        <Select
          aria-label="Comparée à"
          data={options.map((o) => ({ ...o, disabled: o.value === fromId }))}
          value={toId}
          onChange={(v) => v && update({ to: v })}
          placeholder="Version"
          menuWidth={300}
          nothingFound="Aucune version"
        />
      </span>
      <Switch label="Afficher les inchangés" checked={state.tous} onChange={(v) => update({ tous: v })} />
    </Group>
  );

  let content;
  // 409 : moins de deux versions (état vide) ou référence = comparée (choix à corriger).
  if (err?.status === 409 && history.isLoading) content = <SkeletonRows rows={8} />;
  else if (err?.status === 409 && tooFew)
    content = (
      <EmptyState title="Deux versions de plan sont nécessaires" action={<Button to="/plan/versions">Gérer les versions</Button>}>
        La dérive compare une version de référence du plan de charge à une version plus récente. Importez une autre version pour
        suivre l'évolution du PPS et de la charge.
      </EmptyState>
    );
  else if (err?.status === 409)
    content = (
      <EmptyState title="Choisissez deux versions différentes" action={<Button onClick={resetVersions}>Versions par défaut</Button>}>
        {err.message}
      </EmptyState>
    );
  else if (err?.status === 404)
    content = (
      <Stack gap={12} align="start">
        <ErrorAlert error={err} title="Version introuvable" />
        <Button onClick={resetVersions}>Revenir aux versions par défaut</Button>
      </Stack>
    );
  else if (q.error) content = <ErrorAlert error={q.error} title="Impossible de comparer les versions" />;
  else if (!data) content = <SkeletonRows rows={8} />;
  else
    content = (
      <div className="pil-content" aria-busy={q.isPlaceholderData || undefined}>
        <DeriveMetrics data={data} vue={state.vue} />
        {allRows.length === 0 ? (
          <EmptyState title="Aucune ligne à comparer">Les deux versions ne contiennent aucune ligne retenue.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Aucune différence"
            action={<Button onClick={() => update({ tous: true })}>Afficher les inchangés</Button>}
          >
            Le PPS et la charge sont identiques dans les deux versions.
          </EmptyState>
        ) : (
          // La vue fait partie de la clé : le tri revient au défaut à chaque changement de vue.
          <DeriveTable
            key={state.vue}
            data={data}
            vue={state.vue}
            rows={rows}
            hidden={hidden}
            onShowAll={() => update({ tous: true })}
          />
        )}
      </div>
    );

  return <Page toolbar={<PageToolbar title="Dérive du plan" subtitle={subtitle} bottom={bottom || undefined} />}>{content}</Page>;
}
