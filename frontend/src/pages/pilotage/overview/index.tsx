// Pilotage « Vue d'ensemble » (/) : où en est le budget, ce qui est à traiter, comment l'année atterrit.
import { useNavigate } from 'react-router-dom';
import { Card, EmptyState, GroupedList, Link, ListRow, Metric, Page, PageToolbar, ProgressBar, StatusGlyph } from '../../../ui';
import type { AnalyseResult, PrevisionCT } from '../../../api/types';
import { fmtDate, fmtEur, fmtPct } from '../../../lib/format';
import { ForecastChart } from '../shared/charts';
import { useAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, UncoveredNote } from '../shared/ContextControl';
import EcheanceMetric from '../shared/EcheanceMetric';
import {
  anomaliesATraiter,
  anomalieGlyph,
  CATEGORIE_LABEL,
  echeanceOf,
  ecartTextTone,
  fmtEurSigned,
  forecastOf,
  forecastSentence,
  fmtEurShort,
  graviteGlyph,
} from '../shared/pilotage';
import '../shared/pilotage.css';

/** Avancement attendu à date (plan cumulé à l'arrêté ÷ budget total = charge max), en %. */
function expectedPct(p: PrevisionCT, asOfWeek: string): number | undefined {
  if (!p.budget) return undefined;
  const pt = p.series.find((s) => s.week === asOfWeek);
  return pt ? (pt.budget_cumul / p.budget) * 100 : undefined;
}

function BudgetMetrics({ result }: { result: AnalyseResult }) {
  const fc = forecastOf(result);
  if (!fc)
    return (
      <div className="pil-metrics">
        <Metric label="Consommé" value="—" sub="Prévisions non disponibles" />
        <Metric label="Atterrissage prévu" value="—" />
        <Metric label="Non consommé à l’échéance" value="—" />
      </div>
    );
  const g = fc.global;
  const pct = g.pct_consomme ?? (g.budget ? (g.consomme / g.budget) * 100 : 0);
  const over = g.statut === 'depassement';
  const tone = ecartTextTone(g) ?? (g.statut === 'ok' ? 'success' : undefined);
  const e = echeanceOf(g);
  // Budget = charge max = plan de charge + provisions restantes (DECISIONS n° 16).
  const prov = g.provisions ?? 0;
  const budgetText = prov > 0 ? `sur ${fmtEur(g.budget)} de budget max (dont ${fmtEurShort(prov)} de provisions)` : `sur ${fmtEur(g.budget)} de budget`;
  return (
    <div className="pil-metrics">
      <Metric label="Consommé" value={fmtEur(g.consomme)} sub={`${budgetText} · ${fmtPct(pct)}`}>
        <ProgressBar
          value={pct}
          marker={expectedPct(g, fc.as_of_week)}
          tone={pct > 100 ? 'danger' : 'accent'}
          label={`Budget consommé : ${fmtPct(pct)}`}
        />
      </Metric>
      <Metric
        label="Atterrissage prévu"
        value={fmtEur(g.atterrissage_plan)}
        tone={over ? 'danger' : undefined}
        sub={`Tendance ${fmtEur(g.atterrissage_tendance)}`}
      />
      {e ? (
        <EcheanceMetric e={e} />
      ) : (
        // Backend sans fin d'exercice : ancien chiffre (écart de l'atterrissage au budget sur tout l'horizon).
        <Metric
          label="Écart au budget"
          value={fmtEurSigned(g.ecart_plan)}
          tone={tone}
          sub={g.budget ? `${fmtPct((g.ecart_plan / g.budget) * 100)} du budget` : undefined}
        />
      )}
    </div>
  );
}

function ToDo({ result }: { result: AnalyseResult }) {
  const navigate = useNavigate();
  const { categories, top } = anomaliesATraiter(result.anomalies);
  return (
    <GroupedList
      title={
        <span className="pil-group-title">
          À traiter
          <Link to="/anomalies" size="sm">
            Tout voir
          </Link>
        </span>
      }
    >
      {categories.length === 0 ? (
        <ListRow icon={<StatusGlyph kind="success" tone="success" size={16} />} label="Rien à traiter" />
      ) : (
        <>
          {categories.map((c) => {
            const gl = graviteGlyph(c.gravite);
            return (
              <ListRow
                key={c.categorie}
                icon={<StatusGlyph kind={gl.kind} tone={gl.tone} size={16} />}
                label={CATEGORIE_LABEL[c.categorie]}
                value={c.count}
                onClick={() => navigate(`/anomalies?categorie=${encodeURIComponent(c.categorie)}`)}
              />
            );
          })}
          {top.map((a) => {
            const gl = anomalieGlyph(a);
            return (
              <ListRow
                key={a.key}
                icon={<StatusGlyph kind={gl.kind} tone={gl.tone} size={16} />}
                label={a.titre}
                description={a.detail}
                onClick={() => navigate(`/anomalies?key=${encodeURIComponent(a.key)}`)}
              />
            );
          })}
        </>
      )}
    </GroupedList>
  );
}

function Forecast({ result }: { result: AnalyseResult }) {
  const fc = forecastOf(result);
  return (
    <Card>
      <div className="pil-card-head">
        <h2 className="pil-card-head__title">Prévision</h2>
        {fc && (
          <Link to="/previsions" size="sm">
            Détail des prévisions
          </Link>
        )}
      </div>
      {fc ? (
        <>
          <p className="pil-card-head__sub">{forecastSentence(fc.global, 'le périmètre')}</p>
          <ForecastChart
            series={fc.global.series}
            asOfWeek={fc.as_of_week}
            budget={fc.global.budget}
            pps={fc.global.pps}
            echeance={echeanceOf(fc.global)}
            height={260}
          />
        </>
      ) : (
        <EmptyState title="Prévisions non disponibles">
          Elles apparaîtront dès que le calcul d’atterrissage sera disponible pour la timeline du plan et ce réalisé.
        </EmptyState>
      )}
    </Card>
  );
}

export default function OverviewPage() {
  const a = useAnalyse();
  const r = a.result.data;
  const asOf = r?.previsions?.as_of;
  return (
    <Page
      toolbar={
        <PageToolbar
          title="Vue d’ensemble"
          subtitle={
            r && (
              <>
                {asOf ? `Données arrêtées au ${fmtDate(asOf)}` : `${r.budget.par_ct.length} CT`}{' '}
                <ArchivedTag result={r} /> <UncoveredNote result={r} short />
              </>
            )
          }
          actions={<ContextControl analyse={a} />}
        />
      }
    >
      <AnalyseGate analyse={a}>
        {(result) => (
          <>
            <BudgetMetrics result={result} />
            <ToDo result={result} />
            <Forecast result={result} />
          </>
        )}
      </AnalyseGate>
    </Page>
  );
}
