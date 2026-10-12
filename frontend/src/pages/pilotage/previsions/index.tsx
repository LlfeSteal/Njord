// Pilotage « Prévisions » (/previsions) : atterrissage du périmètre ou d'un CT (?ct=), trajectoire, charge à venir.
import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  EmptyState,
  Link,
  Metric,
  Page,
  PageToolbar,
  Select,
  SortHeader,
  Table,
  type Option,
} from '../../../ui';
import type { AnalyseResult, HorsEnveloppe, PrevisionCT, Previsions } from '../../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtPeriod } from '../../../lib/format';
import { BudgetCell, CtLabel, Reste, RowGlyph, Signed } from '../budget/cells';
import { ForecastChart, LoadChart } from '../shared/charts';
import { EnveloppeBars } from '../shared/EnveloppeBars';
import { useAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, NoProvisionNote, UncoveredNote } from '../shared/ContextControl';
import {
  cmp,
  enveloppesOf,
  fmtEurShort,
  fmtEurSigned,
  forecastOf,
  forecastSentence,
  hasEnveloppe,
  rowTone,
  sansEnveloppeSentence,
  useSort,
} from '../shared/pilotage';
import '../shared/pilotage.css';

const ALL = '__all__';
type SortKey = 'ct' | 'budget' | 'atterrissage_plan' | 'atterrissage_tendance' | 'ecart_plan' | 'non_consomme';

/** Chiffres clés d'une portée : écarts face à l'enveloppe (DECISIONS n° 20) ; sans enveloppe, atterrissages seuls. */
function ScopeMetrics({ p }: { p: PrevisionCT }) {
  const withEnv = hasEnveloppe(p);
  const env = withEnv ? p.enveloppe : null;
  const global = p.ct === '';
  // Portée globale = périmètre des CT avec enveloppe : l'échéance est la plus tardive des fins.
  const ref = global ? `sur les enveloppes (${fmtEur(p.budget)})` : `sur l’enveloppe (${fmtEur(p.budget)})`;
  const horsPlan = withEnv ? (p.plan_hors_enveloppe ?? 0) : 0;
  const end = env?.date_fin ?? (withEnv ? p.echeance : '');
  return (
    <div className="pil-metrics">
      <Metric
        label="Atterrissage plan"
        value={fmtEur(p.atterrissage_plan)}
        tone={p.statut === 'depassement' ? 'danger' : undefined}
        sub={withEnv ? `${fmtEurSigned(p.ecart_plan)} ${ref}` : 'Sans enveloppe : aucun écart'}
      />
      <Metric
        label="Atterrissage tendance"
        value={fmtEur(p.atterrissage_tendance)}
        tone={(p.ecart_tendance ?? 0) > 0 ? 'danger' : undefined}
        sub={`${withEnv ? `${fmtEurSigned(p.ecart_tendance)} ${global ? 'sur les enveloppes' : 'sur l’enveloppe'} · ` : ''}rythme ${fmtEur(p.rythme_hebdo)} / sem.`}
      />
      <Metric
        label="Reste à faire"
        value={fmtEur(p.reste_a_faire)}
        sub={
          withEnv && end
            ? `jusqu’à la fin ${global ? 'des enveloppes' : 'de l’enveloppe'} (${fmtDate(end)})${horsPlan > 0.5 ? ` · ${fmtEurShort(horsPlan)} planifiés hors enveloppe` : ''}`
            : `jusqu’au ${fmtDate(p.fin_plan)}`
        }
      />
    </div>
  );
}

/** CT sans enveloppe (DECISIONS n° 20) : pas de trajectoire, une phrase et le lien vers les enveloppes. */
function SansEnveloppeNote({ p }: { p: PrevisionCT }) {
  return (
    <p className="pil-note">
      {sansEnveloppeSentence(p)}.{' '}
      <Link to={`/enveloppes?ct=${encodeURIComponent(p.ct)}`} size="sm">
        Voir les enveloppes
      </Link>
    </p>
  );
}

/** CT sans enveloppe, hors du périmètre global (DECISIONS n° 20). Rien s'il n'y en a pas. */
function HorsEnveloppeNote({ h }: { h: HorsEnveloppe | null | undefined }) {
  if (!h || h.nb_ct <= 0) return null;
  return (
    <p className="pil-note">
      Hors périmètre : {h.nb_ct} CT sans enveloppe, {fmtEurShort(h.consomme)} consommés, atterrissage {fmtEurShort(h.atterrissage_plan)} (plan).{' '}
      <Link to="/enveloppes?filtre=sans_enveloppe" size="sm">
        Voir les CT sans enveloppe
      </Link>
    </p>
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
    // Les CT sans enveloppe restent en dernier quel que soit le sens du tri (pas de budget, DECISIONS n° 20).
    () =>
      [...list].sort((a, b) => {
        const ea = hasEnveloppe(a);
        const eb = hasEnveloppe(b);
        if (ea !== eb && sort.key !== 'ct' && sort.key !== 'atterrissage_plan' && sort.key !== 'atterrissage_tendance') return ea ? -1 : 1;
        return (sort.dir === 'asc' ? 1 : -1) * cmp(a[sort.key], b[sort.key]) || cmp(a.ct, b.ct);
      }),
    [list, sort],
  );
  const th = (k: SortKey, label: string, right = true) => (
    <SortHeader active={sort.key === k} dir={sort.dir} onSort={() => toggle(k)} align={right ? 'right' : undefined}>
      {label}
    </SortHeader>
  );
  return (
    <Table hover minWidth={820} caption="Prévisions par CT">
      <thead>
        <tr>
          <th data-glyph aria-label="Statut" />
          {th('ct', 'CT', false)}
          {th('budget', 'Budget')}
          {th('atterrissage_plan', 'Atterrissage plan')}
          {th('atterrissage_tendance', 'Tendance')}
          {th('ecart_plan', 'Écart')}
          {th('non_consomme', 'Non consommé')}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const withEnv = hasEnveloppe(p);
          return (
            <tr
              key={p.ct}
              data-clickable
              data-tone={withEnv ? rowTone(p.statut, false, p.sous_consommation) : undefined}
              data-selected={p.ct === selected || undefined}
              tabIndex={0}
              onClick={() => onPick(p.ct)}
              onKeyDown={(e) => e.key === 'Enter' && onPick(p.ct)}
              aria-label={`Prévisions du CT ${p.ct}`}
            >
              <td data-glyph>{withEnv && <RowGlyph row={{ statut: p.statut, risque: false, sousConso: p.sous_consommation }} />}</td>
              <td>
                <CtLabel ct={p.ct} libelle={p.ct_libelle} />
              </td>
              <td data-align="right">
                <BudgetCell b={{ enveloppe: p.enveloppe ?? null, budget: withEnv ? p.budget : null }} />
              </td>
              <td data-align="right">{fmtEur(p.atterrissage_plan)}</td>
              <td data-align="right">{fmtEur(p.atterrissage_tendance)}</td>
              <td data-align="right">{withEnv ? <Signed value={p.ecart_plan} /> : '—'}</td>
              <td data-align="right">
                {withEnv && p.non_consomme != null ? <Reste value={p.non_consomme} over={false} warn={p.sous_consommation} /> : '—'}
              </td>
            </tr>
          );
        })}
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
        Le CT {ct} n’a pas de prévision dans la timeline du plan retenue.
      </EmptyState>
    );
  const withEnv = hasEnveloppe(scope);
  const future = scope.series.filter((s) => s.week > fc.as_of_week).reduce((n, s) => n + s.heures_plan, 0);
  const nbEnv = fc.par_ct.filter(hasEnveloppe).length;
  return (
    <>
      {ct || withEnv ? (
        <ScopeMetrics p={scope} />
      ) : (
        <EmptyState
          title="Aucune enveloppe importée"
          action={
            <Button to="/enveloppes" variant="primary">
              Importer le fichier CàT
            </Button>
          }
        >
          Le budget d’un CT est son enveloppe : sans fichier CàT, aucun CT n’a de budget. Les atterrissages par CT restent dans le tableau.
        </EmptyState>
      )}
      {ct ? (
        withEnv ? (
          <ChartCard title="Trajectoire vers l’enveloppe" sub={forecastSentence(scope)}>
            <ForecastChart prevision={scope} asOfWeek={fc.as_of_week} height={320} />
          </ChartCard>
        ) : (
          <SansEnveloppeNote p={scope} />
        )
      ) : (
        withEnv && (
          <ChartCard title="Enveloppes par CT" sub={`${forecastSentence(scope)} ${nbEnv} CT avec enveloppe, en % de leur enveloppe.`}>
            <EnveloppeBars previsions={fc.par_ct} onSelect={(c) => setCt(c)} />
          </ChartCard>
        )
      )}
      {!ct && <HorsEnveloppeNote h={fc.hors_enveloppe} />}
      {scope.series.length > 0 && (
        <ChartCard
          title="Charge à venir"
          sub={future > 0 ? `${fmtHours(Math.round(future))} encore planifiées jusqu’au ${fmtDate(scope.fin_plan)}.` : 'Plus aucune charge planifiée après l’arrêté des données.'}
        >
          <LoadChart series={scope.series} asOfWeek={fc.as_of_week} height={200} />
        </ChartCard>
      )}
      {fc.par_ct.length > 0 && <CtTable list={fc.par_ct} selected={ct} onPick={(c) => setCt(c === ct ? null : c)} />}
      <MethodNote fc={fc} />
      <NoProvisionNote result={result} />
    </>
  );
}

function MethodNote({ fc }: { fc: Previsions }) {
  const env = enveloppesOf(fc);
  const nbEnv = env?.nb_configures ?? 0;
  return (
    <>
      <p className="pil-note">
        Atterrissage = réalisé à date + reste à faire du plan (chaque semaine selon la version en vigueur). Tendance = réalisé à date + rythme moyen
        des 4 dernières semaines. Les provisions sont informatives (marge disponible), hors reste à faire et atterrissage. Données arrêtées au{' '}
        {fmtDate(fc.as_of)}.
      </p>
      <p className="pil-note">
        Budget d’un CT = montant de son enveloppe (Données › Enveloppes, fichier CàT), rien d’autre. Tout le prévisionnel porte sur la période de
        l’enveloppe (semaines de début et de fin incluses) : consommé = réalisé daté dans la période, atterrissage = consommé + plan restant de la
        période ; le réalisé et le plan hors période sont montrés à part. Zone cible = de l’enveloppe moins le seuil de sous-consommation (Réglages)
        jusqu’à l’enveloppe : dépassement au-dessus, sous-consommation en dessous (non consommé à la fin de l’enveloppe, perdu). Périmètre global =
        CT avec enveloppe, chacun sur sa période ; un CT sans enveloppe n’a ni budget, ni statut, ni écart (consommé et atterrissages seuls).{' '}
        {env ? `${nbEnv} CT avec enveloppe sur ${env.nb_ct}.` : ''}
      </p>
    </>
  );
}

export default function PrevisionsPage() {
  const a = useAnalyse();
  const [search, setSearch] = useSearchParams();
  const ct = search.get('ct');
  const r = a.result.data;
  const fc = r ? forecastOf(r) : null;
  // CT avec enveloppe : l'horizon est la période de son enveloppe (DECISIONS n° 19) ; global : CT avec enveloppe (n° 20).
  const scopeP = ct ? fc?.par_ct.find((p) => p.ct === ct) : null;
  const scopeEnv = scopeP?.enveloppe ?? null;
  const horizon = scopeEnv
    ? `enveloppe ${fmtPeriod(scopeEnv.date_debut, scopeEnv.date_fin)}`
    : ct
      ? 'fin du plan (sans enveloppe)'
      : 'CT avec enveloppe, chacun sur sa période';

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
                {fc
                  ? `Horizon : ${horizon} · données arrêtées au ${fmtDate(fc.as_of)}`
                  : 'Atterrissage budgétaire'}{' '}
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
