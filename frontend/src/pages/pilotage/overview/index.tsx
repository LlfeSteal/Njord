// Pilotage « Vue d'ensemble » (/) : où en sont les enveloppes, ce qui est à traiter, comment chaque CT atterrit.
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, GroupedList, Link, ListRow, Metric, Page, PageToolbar, ProgressBar, StatusGlyph } from '../../../ui';
import type { AnalyseResult, PrevisionCT } from '../../../api/types';
import { fmtDate, fmtEur, fmtPct } from '../../../lib/format';
import { EnveloppesOverviewChart } from '../shared/charts';
import { useAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, UncoveredNote } from '../shared/ContextControl';
import {
  anomalieGlyph,
  anomaliesATraiter,
  CATEGORIE_LABEL,
  enveloppesOf,
  fmtEurShort,
  forecastOf,
  forecastSentence,
  graviteGlyph,
  hasEnveloppe,
  SOUS_CONSO_GLYPH,
} from '../shared/pilotage';
import '../shared/pilotage.css';

/** Avancement attendu à date (plan cumulé à l'arrêté ÷ Σ enveloppes), en %. */
function expectedPct(p: PrevisionCT, asOfWeek: string): number | undefined {
  if (!p.budget) return undefined;
  const pt = p.series.find((s) => s.week === asOfWeek);
  return pt ? (pt.budget_cumul / p.budget) * 100 : undefined;
}

/**
 * Chiffres clés (DECISIONS n° 20) : consommé sur Σ enveloppes, enveloppes à risque d'être perdues, dépassement
 * (lecture brute, sans compensation entre CT). Sans aucune enveloppe : état vide vers l'import du fichier CàT.
 */
function KeyFigures({ result }: { result: AnalyseResult }) {
  const fc = forecastOf(result);
  if (!fc)
    return (
      <div className="pil-metrics">
        <Metric label="Consommé" value="—" sub="Prévisions non disponibles" />
        <Metric label="À risque d’être perdus" value="—" />
        <Metric label="Dépassement" value="—" />
      </div>
    );
  const g = fc.global;
  const env = enveloppesOf(fc);
  if (!hasEnveloppe(g) || !env || env.nb_configures === 0)
    return (
      <EmptyState
        title="Aucune enveloppe importée"
        action={
          <Button to="/enveloppes" variant="primary">
            Importer le fichier CàT
          </Button>
        }
      >
        Le budget d’un CT est son enveloppe : sans fichier CàT, aucun CT n’a de budget.
      </EmptyState>
    );
  const budget = g.budget ?? env.montant;
  const pct = g.pct_consomme ?? (budget ? (g.consomme / budget) * 100 : 0);
  const hors = fc.hors_enveloppe;
  const nbHors = hors?.nb_ct ?? env.nb_ct - env.nb_configures;
  const risk = env.non_consomme > 0.5;
  const over = env.depassement > 0.5;
  return (
    <>
      <div className="pil-metrics">
        <Metric
          label="Consommé"
          value={fmtEur(g.consomme)}
          sub={`sur ${fmtEur(budget)} d’enveloppes (${env.nb_configures} CT) · ${fmtPct(pct)}`}
        >
          <ProgressBar
            value={pct}
            marker={expectedPct(g, fc.as_of_week)}
            tone={pct > 100 ? 'danger' : 'accent'}
            label={`Enveloppes consommées : ${fmtPct(pct)}`}
          />
        </Metric>
        <Metric
          label="À risque d’être perdus"
          value={fmtEur(env.non_consomme)}
          tone={risk ? 'warning' : undefined}
          glyph={risk ? SOUS_CONSO_GLYPH : undefined}
          sub={`${env.nb_sous_consommation} CT sous la zone cible`}
        />
        <Metric
          label="Dépassement"
          value={fmtEur(env.depassement)}
          tone={over ? 'danger' : undefined}
          glyph={over ? { kind: 'danger', tone: 'danger' } : undefined}
          sub={`${env.nb_depassement} CT au-dessus de leur enveloppe`}
        />
      </div>
      {nbHors > 0 && (
        <p className="pil-note">
          <Link to="/enveloppes?filtre=sans_enveloppe" size="sm">
            {nbHors} CT sans enveloppe
          </Link>
          {hors ? ` : ${fmtEurShort(hors.consomme)} consommés` : ''}
        </p>
      )}
    </>
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

/** Carte « Prévision » : Σ enveloppes actives face au réalisé cumulé puis au plan de charge projeté (DECISIONS n° 20). */
function Forecast({ result }: { result: AnalyseResult }) {
  const fc = forecastOf(result);
  if (fc && !hasEnveloppe(fc.global)) return null;
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
          <p className="pil-card-head__sub">{forecastSentence(fc.global)}</p>
          <EnveloppesOverviewChart previsions={fc} />
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
            <KeyFigures result={result} />
            <ToDo result={result} />
            <Forecast result={result} />
          </>
        )}
      </AnalyseGate>
    </Page>
  );
}
