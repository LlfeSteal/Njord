// Pilotage « Prévisions » (/previsions) : atterrissage du périmètre ou d'un CT (?ct=), trajectoire, charge à venir.
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  Metric,
  Page,
  PageToolbar,
  Select,
  SortHeader,
  Table,
  type Option,
} from '../../../ui';
import type { AnalyseResult, PrevisionCT, Previsions } from '../../../api/types';
import { fmtDate, fmtEur, fmtHours } from '../../../lib/format';
import { CtLabel, RowGlyph, Signed } from '../budget/cells';
import { ForecastChart, LoadChart } from '../shared/charts';
import { useAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, NoProvisionNote, UncoveredNote } from '../shared/ContextControl';
import { cmp, fmtEurSigned, forecastOf, forecastSentence, rowTone, useSort } from '../shared/pilotage';
import '../shared/pilotage.css';

const ALL = '__all__';
type SortKey = 'ct' | 'budget' | 'atterrissage_plan' | 'atterrissage_tendance' | 'ecart_plan';

function ScopeMetrics({ p }: { p: PrevisionCT }) {
  const over = p.statut === 'depassement';
  return (
    <div className="pil-metrics">
      <Metric
        label="Atterrissage plan"
        value={fmtEur(p.atterrissage_plan)}
        tone={over ? 'danger' : undefined}
        sub={`${fmtEurSigned(p.ecart_plan)} sur ${fmtEur(p.budget)} de ${p.provisions > 0 ? 'budget max' : 'budget'}`}
      />
      <Metric
        label="Atterrissage tendance"
        value={fmtEur(p.atterrissage_tendance)}
        tone={p.ecart_tendance > 0 ? 'danger' : undefined}
        sub={`${fmtEurSigned(p.ecart_tendance)} · rythme ${fmtEur(p.rythme_hebdo)} / sem.`}
      />
      <Metric label="Reste à faire" value={fmtEur(p.reste_a_faire)} sub={`jusqu’au ${fmtDate(p.fin_plan)}`} />
    </div>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">{title}</h2>
      </div>
      <p className="pil-card-head__sub">{sub}</p>
      {children}
    </Card>
  );
}

function CtTable({ list, selected, onPick }: { list: PrevisionCT[]; selected: string | null; onPick: (ct: string) => void }) {
  const { sort, toggle } = useSort<SortKey>({ key: 'ecart_plan', dir: 'desc' });
  const rows = useMemo(
    () => [...list].sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key], b[sort.key]) || cmp(a.ct, b.ct)),
    [list, sort],
  );
  const th = (k: SortKey, label: string, right = true) => (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => toggle(k)} align={right ? 'right' : undefined}>
      {label}
    </SortHeader>
  );
  return (
    <Table hover minWidth={720} caption="Prévisions par CT">
      <thead>
        <tr>
          <th data-glyph aria-label="Statut" />
          {th('ct', 'CT', false)}
          {th('budget', 'Charge max')}
          {th('atterrissage_plan', 'Atterrissage plan')}
          {th('atterrissage_tendance', 'Tendance')}
          {th('ecart_plan', 'Écart')}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr
            key={p.ct}
            data-clickable
            data-tone={rowTone(p.statut)}
            data-selected={p.ct === selected || undefined}
            tabIndex={0}
            onClick={() => onPick(p.ct)}
            onKeyDown={(e) => e.key === 'Enter' && onPick(p.ct)}
            aria-label={`Prévisions du CT ${p.ct}`}
          >
            <td data-glyph>
              <RowGlyph row={{ statut: p.statut, risque: false }} />
            </td>
            <td>
              <CtLabel ct={p.ct} libelle={p.ct_libelle} />
            </td>
            <td data-align="right">{fmtEur(p.budget)}</td>
            <td data-align="right">{fmtEur(p.atterrissage_plan)}</td>
            <td data-align="right">{fmtEur(p.atterrissage_tendance)}</td>
            <td data-align="right">
              <Signed value={p.ecart_plan} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Content({ result, ct, setCt }: { result: AnalyseResult; ct: string | null; setCt: (ct: string | null) => void }) {
  const fc = forecastOf(result);
  if (!fc)
    return (
      <EmptyState title="Prévisions non disponibles">
        Le calcul d’atterrissage n’a pas encore de données pour la timeline du plan et ce réalisé.
      </EmptyState>
    );
  const scope = ct ? fc.par_ct.find((p) => p.ct === ct) : fc.global;
  if (!scope)
    return (
      <EmptyState title="CT absent des prévisions" action={<Button onClick={() => setCt(null)}>Tout le périmètre</Button>}>
        Le CT {ct} n’a pas de budget dans la timeline du plan retenue.
      </EmptyState>
    );
  const future = scope.series.filter((s) => s.week > fc.as_of_week).reduce((n, s) => n + s.heures_plan, 0);
  return (
    <>
      <ScopeMetrics p={scope} />
      <ChartCard title="Trajectoire cumulée" sub={forecastSentence(scope, ct ? `le CT ${ct}` : 'le périmètre')}>
        <ForecastChart series={scope.series} asOfWeek={fc.as_of_week} budget={scope.budget} pps={scope.pps} height={320} />
      </ChartCard>
      <ChartCard
        title="Charge à venir"
        sub={future > 0 ? `${fmtHours(Math.round(future))} encore planifiées jusqu’au ${fmtDate(scope.fin_plan)}.` : 'Plus aucune charge planifiée après l’arrêté des données.'}
      >
        <LoadChart series={scope.series} asOfWeek={fc.as_of_week} height={200} />
      </ChartCard>
      {fc.par_ct.length > 0 && <CtTable list={fc.par_ct} selected={ct} onPick={(c) => setCt(c === ct ? null : c)} />}
      <MethodNote fc={fc} />
      <NoProvisionNote result={result} />
    </>
  );
}

function MethodNote({ fc }: { fc: Previsions }) {
  return (
    <p className="pil-note">
      Budget (charge max) = plan de charge (Σ PPS) + provisions restantes ; les provisions sont une marge disponible, hors reste à faire et
      atterrissage. Atterrissage = réalisé à date + reste à faire du plan (chaque semaine selon la version en vigueur). Tendance = réalisé à date
      + rythme moyen des 4 dernières semaines. Données arrêtées au {fmtDate(fc.as_of)}.
    </p>
  );
}

export default function PrevisionsPage() {
  const a = useAnalyse();
  const [search, setSearch] = useSearchParams();
  const ct = search.get('ct');
  const r = a.result.data;
  const fc = r ? forecastOf(r) : null;

  const setCt = (next: string | null) =>
    setSearch(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next) n.set('ct', next);
        else n.delete('ct');
        return n;
      },
      { replace: true },
    );

  const options = useMemo<Option[]>(
    () => [
      { value: ALL, label: 'Tout le périmètre' },
      ...(fc?.par_ct ?? [])
        .slice()
        .sort((x, y) => cmp(x.ct, y.ct))
        .map((p) => ({ value: p.ct, label: p.ct_libelle ? `${p.ct} · ${p.ct_libelle}` : p.ct })),
    ],
    [fc],
  );

  return (
    <Page
      toolbar={
        <PageToolbar
          title="Prévisions"
          subtitle={
            r && (
              <>
                {fc ? `Horizon : fin du plan · données arrêtées au ${fmtDate(fc.as_of)}` : 'Atterrissage budgétaire'}{' '}
                <ArchivedTag result={r} /> <UncoveredNote result={r} short />
              </>
            )
          }
          actions={<ContextControl analyse={a} />}
          bottom={
            fc && (
              <Select
                aria-label="Périmètre"
                data={options}
                value={ct}
                placeholder="Tout le périmètre"
                searchable
                menuWidth={340}
                onChange={(v) => setCt(!v || v === ALL ? null : v)}
              />
            )
          }
        />
      }
    >
      <AnalyseGate analyse={a}>{(result) => <Content result={result} ct={ct} setCt={setCt} />}</AnalyseGate>
    </Page>
  );
}
