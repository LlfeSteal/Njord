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
  Link,
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
import { fmtDate, fmtEur, fmtHours, fmtPct, fmtPeriod } from '../../../lib/format';
import { ForecastChart } from '../shared/charts';
import { useAnalyse, type UseAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, NoProvisionNote } from '../shared/ContextControl';
import EcheanceMetric from '../shared/EcheanceMetric';
import {
  capitalize,
  cmp,
  echeanceOf,
  echeanceWords,
  enveloppesOf,
  fmtDayMonth,
  forecastOf,
  hasEnveloppe,
  rowGlyph,
  rowReason,
  rowTone,
  SOUS_CONSO_LABEL,
  STATUT_LABEL,
  useSort,
  type Echeance,
} from '../shared/pilotage';
import { BudgetCell, Consumption, CtLabel, Reste, RowGlyph } from './cells';
import EnveloppesCard from './EnveloppesCard';
import NatureBars from './NatureBars';
import { mergeCtRows, sumOf, type BudgetSource, type CtRow } from './model';
import '../shared/pilotage.css';

/** Infobulle de « Reste à l'échéance » : enveloppe − atterrissage plan, à la fin de l'enveloppe (DECISIONS n° 21). */
function resteTitle(e: Echeance | null | undefined): string | undefined {
  if (!e) return undefined;
  const w = echeanceWords(e);
  return `${capitalize(w.when)} : ${w.budget} ${fmtEur(e.budget)} − atterrissage plan ${fmtEur(e.projPlan)}`;
}

type SortKey = 'ct' | 'budget' | 'consomme' | 'pct' | 'atterrissage' | 'reste';
type StatutFilter = 'all' | PrevisionStatut;
type SourceFilter = 'all' | BudgetSource;

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'enveloppe', label: 'Avec enveloppe' },
  { value: 'aucun', label: 'Sans enveloppe' },
];
const SOURCE_LABEL: Record<BudgetSource, string> = { enveloppe: 'Avec enveloppe', aucun: 'Sans enveloppe' };

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

function BudgetMetrics({ result }: { result: AnalyseResult }) {
  const fc = forecastOf(result);
  // Budget = Σ enveloppes des CT qui en ont une (DECISIONS n° 20) ; le global est ce périmètre.
  const env = enveloppesOf(fc);
  const nbEnv = env?.nb_configures ?? 0;
  const hors = fc?.hors_enveloppe;
  const nbHors = hors?.nb_ct ?? (env ? env.nb_ct - env.nb_configures : 0);
  const glob = fc && hasEnveloppe(fc.global) ? fc.global : null;
  const total = glob?.budget ?? null;
  const consomme = glob?.consomme ?? null;
  const pct = glob ? (glob.pct_consomme ?? (total ? (glob.consomme / total) * 100 : null)) : null;
  const g = result.budget.global;
  const alert = result.alertes.alerte_globale;
  const e = echeanceOf(glob);
  // Part sécurisée (tous les CT) : portée par la sous-ligne du consommé, glyphe d'alerte compris.
  const secured = `dont ${fmtPct(g.pct_securite)} sécurisé${alert ? ` (non sécurisé ${fmtPct(g.pct_non_securise)} : au-delà du seuil)` : ''}`;
  return (
    <div className="pil-metrics">
      <Metric
        label="Enveloppes"
        value={total != null ? fmtEur(total) : '—'}
        sub={
          nbEnv > 0
            ? `${nbEnv} CT avec enveloppe${nbHors > 0 ? ` · ${nbHors} sans enveloppe` : ''}`
            : fc
              ? 'Aucune enveloppe importée'
              : 'Prévisions non disponibles'
        }
      />
      <Metric
        label="Consommé"
        value={fmtEur(consomme)}
        glyph={e && alert ? { kind: 'warning', tone: 'warning' } : undefined}
        sub={[pct != null ? `${fmtPct(pct)} des enveloppes` : 'Aucune enveloppe', e ? secured : null].filter(Boolean).join(' · ')}
      >
        {pct != null && <ProgressBar value={pct} tone={pct > 100 ? 'danger' : 'accent'} label={`Enveloppes consommées : ${fmtPct(pct)}`} />}
      </Metric>
      {e ? (
        <EcheanceMetric e={e} />
      ) : (
        <Metric
          label="Part sécurisée"
          value={fmtPct(g.pct_securite)}
          glyph={alert ? { kind: 'warning', tone: 'warning' } : undefined}
          sub={alert ? `Non sécurisé ${fmtPct(g.pct_non_securise)} : au-delà du seuil` : `Non sécurisé ${fmtPct(g.pct_non_securise)}`}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Tableau

function BudgetTable({
  rows,
  selected,
  onOpen,
  global,
}: {
  rows: CtRow[];
  selected: string | null;
  onOpen: (ct: string) => void;
  /** Échéance du périmètre (CT avec enveloppe) : total de la colonne quand aucun de ces CT n'est masqué. */
  global: { e: Echeance; complete: boolean } | null;
}) {
  const { sort, toggle } = useSort<SortKey>({ key: 'reste', dir: 'desc' });
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key], b[sort.key]) || cmp(a.ct, b.ct)),
    [rows, sort],
  );
  const th = (k: SortKey, label: string, right = true, title?: string) => (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => toggle(k)} align={right ? 'right' : undefined}>
      <span title={title}>{label}</span>
    </SortHeader>
  );
  // Totaux sur les CT avec enveloppe seulement : un CT sans enveloppe n'a pas de budget (DECISIONS n° 20).
  const envRows = rows.filter((x) => x.budget != null);
  const tBudget = sumOf(envRows, 'budget');
  const tConso = sumOf(envRows, 'consomme');
  return (
    <Table hover minWidth={820} caption="Budget par CT">
      <thead>
        <tr>
          <th data-glyph aria-label="Statut" />
          {th('ct', 'CT', false)}
          {th(
            'budget',
            'Budget',
            true,
            'Montant de l’enveloppe du CT (Données › Enveloppes) ; un CT sans enveloppe n’a pas de budget',
          )}
          {th('consomme', 'Consommé')}
          {th('pct', 'Consommation')}
          {th(
            'atterrissage',
            'Atterrissage',
            true,
            'Atterrissage plan (consommé + plan restant) à la fin de l’enveloppe ; sans enveloppe, à la fin du plan',
          )}
          {th(
            'reste',
            'Reste à l’échéance',
            true,
            'Enveloppe non consommée à sa fin, selon le plan de charge',
          )}
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
            data-tone={r.budget != null ? rowTone(r.statut, r.risque, r.sousConso) : undefined}
            data-selected={r.ct === selected || undefined}
            tabIndex={0}
            onClick={() => onOpen(r.ct)}
            onKeyDown={(e) => e.key === 'Enter' && onOpen(r.ct)}
            aria-label={`Détail du CT ${r.ct}`}
          >
            <td data-glyph>
              {/* Sans enveloppe : ni ton ni glyphe (STYLE, colonne Budget, DECISIONS n° 20). */}
              {r.budget != null && <RowGlyph row={r} />}
            </td>
            <td>
              <CtLabel ct={r.ct} libelle={r.libelle} />
            </td>
            <td data-align="right">
              <BudgetCell b={r} />
            </td>
            <td data-align="right">{fmtEur(r.consomme)}</td>
            <td data-align="right">
              <Consumption pct={r.pct} />
            </td>
            <td data-align="right">{fmtEur(r.atterrissage)}</td>
            <td data-align="right">
              <Reste value={r.reste} over={r.resteOver} warn={r.sousConso} title={resteTitle(r.echeance)} />
            </td>
          </tr>
        ))}
      </tbody>
      {sorted.length > 1 && envRows.length > 0 && (
        <tfoot>
          <tr>
            <td data-glyph />
            <td title="Totaux des CT avec enveloppe">
              Total · {envRows.length} CT{envRows.length < rows.length ? ' avec enveloppe' : ''}
            </td>
            <td data-align="right">{fmtEur(tBudget)}</td>
            <td data-align="right">{fmtEur(tConso)}</td>
            <td data-align="right">
              <Consumption pct={tConso != null && tBudget ? (tConso / tBudget) * 100 : null} />
            </td>
            <td data-align="right">{fmtEur(sumOf(envRows, 'atterrissage'))}</td>
            <td data-align="right" title="Somme des CT avec enveloppe, chacun à la fin de son enveloppe : non consommé CT par CT, sans compensation avec les dépassements (DECISIONS n° 20, 21)">
              {global?.complete ? (
                <Reste
                  value={global.e.nonConsomme > 0.5 ? global.e.nonConsomme : global.e.depassement}
                  over={global.e.nonConsomme <= 0.5 && global.e.depassement > 0.5}
                  warn={global.e.sousConso}
                />
              ) : (
                '—'
              )}
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

/** Fin de l'enveloppe d'un CT (DECISIONS n° 19, 20) : projections, enveloppe perdue ou dépassée, rythme. */
function EcheanceSection({ e }: { e: Echeance }) {
  const unspent = e.nonConsomme > 0.5;
  return (
    <InspectorSection title={`Fin de l’enveloppe · ${fmtDayMonth(e.date)}`}>
      <KeyValue
        items={[
          { label: 'Projection plan', value: fmtEur(e.projPlan), numeric: true },
          e.depassement > 0.5
            ? {
                label: 'Dépassement prévu',
                value: (
                  <span className="pil-signed" data-tone="danger">
                    +{fmtEur(e.depassement)}
                  </span>
                ),
                numeric: true,
              }
            : {
                label: 'Non consommé',
                value: (
                  <span className="pil-signed" data-tone={e.sousConso ? 'warning' : undefined}>
                    {fmtEur(e.nonConsomme)}
                    {e.budget > 0 && unspent ? ` · ${fmtPct(Math.round((e.nonConsomme / e.budget) * 100))}` : ''}
                  </span>
                ),
                numeric: true,
              },
          {
            label: 'Rythme nécessaire',
            value: e.semaines > 0 ? `${fmtEur(e.rythmeNecessaire)} / sem.` : 'Échéance atteinte',
            numeric: true,
          },
          { label: 'Rythme actuel', value: `${fmtEur(e.rythmeActuel)} / sem.`, numeric: true },
          { label: 'Projection tendance (repère)', value: fmtEur(e.projTendance), numeric: true },
        ]}
      />
    </InspectorSection>
  );
}

/**
 * Enveloppe d'un CT (DECISIONS n° 19, 20) : période, montant, zone cible, consommé de la période, ce qui en sort
 * (réalisé et plan hors enveloppe), provisions = marge disponible.
 */
function EnveloppeSection({ row }: { row: CtRow }) {
  const env = row.enveloppe!;
  const p = row.p;
  const horsReel = p?.consomme_hors_enveloppe ?? 0;
  const horsPlan = p?.plan_hors_enveloppe ?? 0;
  return (
    <InspectorSection title="Enveloppe">
      <KeyValue
        items={[
          { label: 'Période', value: fmtPeriod(env.date_debut, env.date_fin), numeric: true },
          { label: 'Montant', value: fmtEur(env.montant), numeric: true },
          ...(p?.cible_min != null ? [{ label: 'Zone cible', value: `${fmtEur(p.cible_min)} → ${fmtEur(env.montant)}`, numeric: true }] : []),
          {
            label: 'Consommé dans la période',
            value: p ? `${fmtEur(p.consomme)} · ${fmtPct(row.pct != null ? Math.round(row.pct) : null)}` : '—',
            numeric: true,
          },
          ...(horsReel > 0.5 ? [{ label: 'Réalisé hors enveloppe', value: fmtEur(horsReel), numeric: true }] : []),
          ...(horsPlan > 0.5 ? [{ label: 'Plan hors enveloppe', value: fmtEur(horsPlan), numeric: true }] : []),
          { label: 'Provisions (marge disponible)', value: fmtEur(row.provisions), numeric: true },
        ]}
      />
      <p className="pil-note pil-inspector-note">
        <Link to={`/enveloppes?ct=${encodeURIComponent(row.ct)}`} size="sm">
          Voir l’enveloppe
        </Link>
      </p>
    </InspectorSection>
  );
}

function CtInspector({ row, fc, onClose }: { row: CtRow; fc: Previsions | null; onClose: () => void }) {
  const p = row.p;
  const glyph = rowGlyph(row.statut, row.risque, row.sousConso);
  const q = encodeURIComponent(row.ct);
  const withEnv = row.budget != null;
  return (
    <Inspector
      opened
      onClose={onClose}
      title={row.ct}
      subtitle={row.libelle}
      accessory={
        glyph ? (
          <StatusGlyph kind={glyph.kind} tone={glyph.tone} label={rowReason(row.statut, row.risque, row.sousConso)} />
        ) : undefined
      }
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
      {withEnv && row.enveloppe ? (
        <EnveloppeSection row={row} />
      ) : (
        <InspectorSection title="Sans enveloppe — aucun budget">
          <KeyValue
            items={[
              { label: 'Consommé', value: p ? fmtEur(p.consomme) : '—', numeric: true },
            ]}
          />
          <p className="pil-note pil-inspector-note">
            Absent du fichier CàT —{' '}
            <Link to={`/enveloppes?ct=${q}`} size="sm">
              Voir les enveloppes
            </Link>
          </p>
        </InspectorSection>
      )}
      <InspectorSection title="Atterrissage">
        <KeyValue
          items={[
            { label: withEnv ? 'Reste à faire (période)' : 'Reste à faire', value: p ? fmtEur(p.reste_a_faire) : '—', numeric: true },
            { label: 'Atterrissage plan', value: p ? fmtEur(p.atterrissage_plan) : '—', numeric: true },
            { label: 'Tendance', value: p ? fmtEur(p.atterrissage_tendance) : '—', numeric: true },
            { label: 'Rythme hebdo', value: p ? `${fmtEur(p.rythme_hebdo)} / sem.` : '—', numeric: true },
            { label: 'Fin du plan', value: p ? fmtDate(p.fin_plan) : '—', numeric: true },
          ]}
        />
      </InspectorSection>
      {row.echeance && <EcheanceSection e={row.echeance} />}
      {p && fc && withEnv && p.series.length > 0 && (
        <InspectorSection title="Trajectoire vers l’enveloppe">
          <ForecastChart prevision={p} asOfWeek={fc.as_of_week} height={160} legend={false} />
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
  const [sousConsoOnly, setSousConsoOnly] = useState(false);
  const [source, setSource] = useState<SourceFilter>('all');

  const r = a.result.data;
  const rows = useMemo(() => (r ? mergeCtRows(r) : []), [r]);
  const fc = r ? forecastOf(r) : null;
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return rows.filter(
      (x) =>
        (!nq || norm(x.ct).includes(nq) || norm(x.libelle).includes(nq)) &&
        (statut === 'all' || x.statut === statut) &&
        (!risqueOnly || x.risque) &&
        (!sousConsoOnly || x.sousConso) &&
        (source === 'all' || x.source === source),
    );
  }, [rows, q, statut, risqueOnly, sousConsoOnly, source]);
  const env = enveloppesOf(fc);
  const globalE = echeanceOf(fc?.global);
  const nbEnvRows = rows.filter((x) => x.budget != null).length;
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
    ...(sousConsoOnly ? [{ key: 'sous_conso', label: SOUS_CONSO_LABEL, onRemove: () => setSousConsoOnly(false) }] : []),
    ...(source !== 'all' ? [{ key: 'source', label: `Budget : ${SOURCE_LABEL[source]}`, onRemove: () => setSource('all') }] : []),
  ];
  const resetFilters = () => {
    setSource('all');
    setStatut('all');
    setRisqueOnly(false);
    setSousConsoOnly(false);
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
                <Select label="Budget" data={SOURCE_OPTIONS} value={source} onChange={(v) => setSource((v as SourceFilter | null) ?? 'all')} />
                <Switch label="CT à risque seulement" checked={risqueOnly} onChange={setRisqueOnly} />
                <Switch label="Sous-consommation seulement" checked={sousConsoOnly} onChange={setSousConsoOnly} />
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
            <BudgetMetrics result={result} />
            {fc && env && env.nb_configures > 0 ? (
              <EnveloppesCard synthese={env} parCt={fc.par_ct} onOpen={setCt} />
            ) : (
              fc && (
                <p className="pil-note">
                  Aucune enveloppe importée : aucun CT n’a de budget (consommé et atterrissages seuls).{' '}
                  <Link to="/enveloppes" size="sm">
                    Importer le fichier CàT
                  </Link>
                </p>
              )
            )}
            <NoProvisionNote result={result} />
            {result.budget.par_nature?.length > 0 && <NatureBars rows={result.budget.par_nature} />}
            <BudgetTable
              rows={filtered}
              selected={ctParam}
              onOpen={(ct) => setCt(ct === ctParam ? null : ct)}
              global={globalE ? { e: globalE, complete: filtered.filter((x) => x.budget != null).length === nbEnvRows } : null}
            />
          </>
        )}
      </AnalyseGate>
    </Page>
  );
}
