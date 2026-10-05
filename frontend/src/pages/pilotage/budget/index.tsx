// Pilotage « Budget » (/budget) : consommation et atterrissage par CT, détail dans l'inspecteur (?ct=).
import { useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ActiveFilters,
  Button,
  FilterButton,
  Group,
  Inspector,
  InspectorSection,
  KeyValue,
  Metric,
  Page,
  PageToolbar,
  ProgressBar,
  SearchField,
  Select,
  SortHeader,
  StatusGlyph,
  Switch,
  Table,
  type ActiveFilter,
  type MenuEntry,
} from '../../../ui';
import { IconDownload } from '../../../ui/Icons';
import { analyseApi } from '../../../api/client';
import type { AnalyseResult, PrevisionStatut, Previsions } from '../../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtPct } from '../../../lib/format';
import { ForecastChart } from '../shared/charts';
import { useAnalyse, type UseAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag } from '../shared/ContextControl';
import { cmp, forecastOf, rowReason, rowTone, STATUT_LABEL, useSort } from '../shared/pilotage';
import { Consumption, CtLabel, RowGlyph, Signed } from './cells';
import { mergeCtRows, sumOf, type CtRow } from './model';
import '../shared/pilotage.css';

type SortKey = 'ct' | 'budget' | 'consomme' | 'pct' | 'atterrissage' | 'ecart';
type StatutFilter = 'all' | PrevisionStatut;

const STATUT_OPTIONS: { value: StatutFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'depassement', label: STATUT_LABEL.depassement },
  { value: 'vigilance', label: STATUT_LABEL.vigilance },
  { value: 'ok', label: STATUT_LABEL.ok },
];

/** Minuscules sans accents, pour la recherche. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Téléchargement d'un export via un lien temporaire. */
function download(href: string) {
  const el = document.createElement('a');
  el.href = href;
  el.download = '';
  document.body.appendChild(el);
  el.click();
  el.remove();
}

// ------------------------------------------------------------------ Chiffres clés

function BudgetMetrics({ result, rows }: { result: AnalyseResult; rows: CtRow[] }) {
  const fc = forecastOf(result);
  const total = fc?.global.budget ?? sumOf(rows, 'budget') ?? 0;
  const consomme = fc?.global.consomme ?? null;
  const pct = consomme != null && total ? (consomme / total) * 100 : null;
  const g = result.budget.global;
  const alert = result.alertes.alerte_globale;
  return (
    <div className="pil-metrics">
      <Metric label="Budget total" value={fmtEur(total)} sub={`${rows.length} CT · Σ PPS du plan`} />
      <Metric
        label="Consommé"
        value={fmtEur(consomme)}
        sub={pct != null ? `${fmtPct(pct)} du budget` : 'Prévisions non disponibles'}
      >
        {pct != null && <ProgressBar value={pct} tone={pct > 100 ? 'danger' : 'accent'} label={`Budget consommé : ${fmtPct(pct)}`} />}
      </Metric>
      <Metric
        label="Part sécurisée"
        value={fmtPct(g.pct_securite)}
        glyph={alert ? { kind: 'warning', tone: 'warning' } : undefined}
        sub={
          alert
            ? `Non sécurisé ${fmtPct(g.pct_non_securise)} : au-delà du seuil`
            : `Non sécurisé ${fmtPct(g.pct_non_securise)}`
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ Tableau

function BudgetTable({
  rows,
  selected,
  onOpen,
}: {
  rows: CtRow[];
  selected: string | null;
  onOpen: (ct: string) => void;
}) {
  const { sort, toggle } = useSort<SortKey>({ key: 'ecart', dir: 'desc' });
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key], b[sort.key]) || cmp(a.ct, b.ct)),
    [rows, sort],
  );
  const th = (k: SortKey, label: string, right = true) => (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => toggle(k)} align={right ? 'right' : undefined}>
      {label}
    </SortHeader>
  );
  const tBudget = sumOf(rows, 'budget');
  const tConso = sumOf(rows, 'consomme');
  return (
    <Table hover minWidth={820} caption="Budget par CT">
      <thead>
        <tr>
          <th data-glyph aria-label="Statut" />
          {th('ct', 'CT', false)}
          {th('budget', 'Budget')}
          {th('consomme', 'Consommé')}
          {th('pct', 'Consommation')}
          {th('atterrissage', 'Atterrissage')}
          {th('ecart', 'Écart')}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && (
          <tr>
            <td colSpan={7}>
              <span className="pil-note">Aucun CT ne correspond à la recherche.</span>
            </td>
          </tr>
        )}
        {sorted.map((r) => (
          <tr
            key={r.ct}
            data-clickable
            data-tone={rowTone(r.statut, r.risque)}
            data-selected={r.ct === selected || undefined}
            tabIndex={0}
            onClick={() => onOpen(r.ct)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(r.ct)}
            aria-label={`Détail du CT ${r.ct}`}
          >
            <td data-glyph>
              <RowGlyph row={r} />
            </td>
            <td>
              <CtLabel ct={r.ct} libelle={r.libelle} />
            </td>
            <td data-align="right">{fmtEur(r.budget)}</td>
            <td data-align="right">{fmtEur(r.consomme)}</td>
            <td data-align="right">
              <Consumption pct={r.pct} />
            </td>
            <td data-align="right">{fmtEur(r.atterrissage)}</td>
            <td data-align="right">
              <Signed value={r.ecart} />
            </td>
          </tr>
        ))}
      </tbody>
      {sorted.length > 1 && (
        <tfoot>
          <tr>
            <td data-glyph />
            <td>Total · {rows.length} CT</td>
            <td data-align="right">{fmtEur(tBudget)}</td>
            <td data-align="right">{fmtEur(tConso)}</td>
            <td data-align="right">
              <Consumption pct={tConso != null && tBudget ? (tConso / tBudget) * 100 : null} />
            </td>
            <td data-align="right">{fmtEur(sumOf(rows, 'atterrissage'))}</td>
            <td data-align="right">
              <Signed value={sumOf(rows, 'ecart')} />
            </td>
          </tr>
        </tfoot>
      )}
    </Table>
  );
}

// ------------------------------------------------------------------ Inspecteur

function Classification({ row }: { row: CtRow }) {
  const b = row.b;
  if (!b) return null;
  const parts = [
    { kind: 'securise', label: 'Sécurisé', v: b.securise },
    { kind: 'non_securise', label: 'Non sécurisé', v: b.non_securise },
    { kind: 'non_classe', label: 'Non classé', v: b.non_classe },
  ];
  const tot = parts.reduce((s, p) => s + Math.max(0, p.v), 0);
  return (
    <InspectorSection title="Classification">
      {tot > 0 && (
        <div className="pil-stack" role="img" aria-label="Répartition sécurisé, non sécurisé, non classé">
          {parts.map((p) =>
            p.v > 0 ? (
              <span key={p.kind} className="pil-stack__seg" data-kind={p.kind} style={{ width: `${(p.v / tot) * 100}%` } as CSSProperties} />
            ) : null,
          )}
        </div>
      )}
      <KeyValue
        items={[
          ...parts.map((p) => ({
            label: (
              <>
                <span className="pil-dot" data-kind={p.kind} aria-hidden />
                {p.label}
              </>
            ),
            value: fmtEur(p.v),
            numeric: true,
          })),
          { label: '% sécurité', value: fmtPct(b.pct_securite), numeric: true },
        ]}
      />
    </InspectorSection>
  );
}

function CtInspector({ row, fc, onClose }: { row: CtRow; fc: Previsions | null; onClose: () => void }) {
  const p = row.p;
  const tone = rowTone(row.statut, row.risque);
  const q = encodeURIComponent(row.ct);
  return (
    <Inspector
      opened
      onClose={onClose}
      title={row.ct}
      subtitle={row.libelle}
      accessory={tone ? <StatusGlyph kind={tone} tone={tone} label={rowReason(row.statut, row.risque)} /> : undefined}
      footer={
        <Group gap={8} justify="end">
          <Button size="sm" to={`/ecarts?ct=${q}`}>
            Voir les écarts
          </Button>
          <Button size="sm" to={`/previsions?ct=${q}`}>
            Voir les prévisions
          </Button>
        </Group>
      }
    >
      <InspectorSection title="Budget">
        <KeyValue
          items={[
            { label: 'Budget', value: fmtEur(row.budget), numeric: true },
            { label: 'Consommé', value: p ? `${fmtEur(p.consomme)} · ${fmtPct(row.pct != null ? Math.round(row.pct) : null)}` : '—', numeric: true },
            { label: 'Reste à faire', value: p ? fmtEur(p.reste_a_faire) : '—', numeric: true },
            { label: 'Atterrissage plan', value: p ? fmtEur(p.atterrissage_plan) : '—', numeric: true },
            { label: 'Tendance', value: p ? fmtEur(p.atterrissage_tendance) : '—', numeric: true },
            { label: 'Rythme hebdo', value: p ? `${fmtEur(p.rythme_hebdo)} / sem.` : '—', numeric: true },
            { label: 'Fin du plan', value: p ? fmtDate(p.fin_plan) : '—', numeric: true },
          ]}
        />
      </InspectorSection>
      {p && fc && p.series.length > 0 && (
        <InspectorSection title="Trajectoire">
          <ForecastChart series={p.series} asOfWeek={fc.as_of_week} budget={p.budget} height={160} />
        </InspectorSection>
      )}
      <Classification row={row} />
      {row.b && (
        <InspectorSection title="Main-d’œuvre">
          <KeyValue
            items={[
              { label: 'Heures MO', value: fmtHours(row.b.heures_mo), numeric: true },
              { label: 'Coût MO (info)', value: fmtEur(row.b.cout_mo_eur), numeric: true },
            ]}
          />
        </InspectorSection>
      )}
    </Inspector>
  );
}

// ------------------------------------------------------------------ Page

function exportMenu(a: UseAnalyse): MenuEntry[] {
  const disabled = !a.ready || !a.params;
  const url = (mask: boolean) =>
    analyseApi.realiseEnrichiCsvUrl({
      ...(a.params ?? {}),
      include_inactive: a.params?.include_inactive || undefined,
      mask_sensitive: mask || undefined,
    });
  return [
    { label: 'Exporter le réalisé enrichi (CSV)', icon: <IconDownload size={14} />, disabled, onSelect: () => download(url(false)) },
    { label: 'Exporter sans données sensibles (CSV)', icon: <IconDownload size={14} />, disabled, onSelect: () => download(url(true)) },
  ];
}

export default function BudgetPage() {
  const a = useAnalyse();
  const [search, setSearch] = useSearchParams();
  const ctParam = search.get('ct');
  const [q, setQ] = useState('');
  const [statut, setStatut] = useState<StatutFilter>('all');
  const [risqueOnly, setRisqueOnly] = useState(false);

  const r = a.result.data;
  const rows = useMemo(() => (r ? mergeCtRows(r) : []), [r]);
  const fc = r ? forecastOf(r) : null;
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return rows.filter(
      (x) =>
        (!nq || norm(x.ct).includes(nq) || norm(x.libelle).includes(nq)) &&
        (statut === 'all' || x.statut === statut) &&
        (!risqueOnly || x.risque),
    );
  }, [rows, q, statut, risqueOnly]);
  const selected = ctParam ? rows.find((x) => x.ct === ctParam) : undefined;

  const setCt = (ct: string | null) =>
    setSearch(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (ct) n.set('ct', ct);
        else n.delete('ct');
        return n;
      },
      { replace: true },
    );

  const active: ActiveFilter[] = [
    ...(statut !== 'all' ? [{ key: 'statut', label: `Prévision : ${STATUT_LABEL[statut]}`, onRemove: () => setStatut('all') }] : []),
    ...(risqueOnly ? [{ key: 'risque', label: 'CT à risque', onRemove: () => setRisqueOnly(false) }] : []),
  ];
  const resetFilters = () => {
    setStatut('all');
    setRisqueOnly(false);
  };

  return (
    <Page
      toolbar={
        <PageToolbar
          title="Budget"
          subtitle={
            r && (
              <>
                {rows.length} CT{fc ? ` · données arrêtées au ${fmtDate(fc.as_of)}` : ''} <ArchivedTag result={r} />
              </>
            )
          }
          actions={<ContextControl analyse={a} />}
          menu={exportMenu(a)}
          bottom={
            <Group gap={8}>
              <SearchField value={q} onChange={setQ} placeholder="CT ou libellé" />
              <FilterButton count={active.length} onReset={resetFilters}>
                <Select
                  label="Statut de la prévision"
                  data={STATUT_OPTIONS}
                  value={statut}
                  onChange={(v) => setStatut((v as StatutFilter | null) ?? 'all')}
                />
                <Switch label="CT à risque seulement" checked={risqueOnly} onChange={setRisqueOnly} />
              </FilterButton>
              <ActiveFilters items={active} onClearAll={active.length > 1 ? resetFilters : undefined} />
            </Group>
          }
        />
      }
      inspector={selected && <CtInspector row={selected} fc={fc} onClose={() => setCt(null)} />}
    >
      <AnalyseGate analyse={a}>
        {(result) => (
          <>
            <BudgetMetrics result={result} rows={rows} />
            <BudgetTable rows={filtered} selected={ctParam} onOpen={(ct) => setCt(ct === ctParam ? null : ct)} />
          </>
        )}
      </AnalyseGate>
    </Page>
  );
}
