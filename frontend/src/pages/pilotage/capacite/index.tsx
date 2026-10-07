// Pilotage « Capacité » (/capacite) : utilisation de la capacité planifiée par squad et par semaine,
// calculée côté front depuis les écarts de l'analyse courante (DECISIONS n° 11). Clic sur un squad → Écarts filtrés.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Metric, Page, PageToolbar, SkeletonRows } from '../../../ui';
import type { AnalyseResult, Squad } from '../../../api/types';
import { fmtHours, fmtPct, fmtWeek } from '../../../lib/format';
import { useAnalyse } from '../shared/context';
import ContextControl, { AnalyseGate, ArchivedTag, UncoveredNote } from '../shared/ContextControl';
import { shortWeek } from '../anomalies/meta';
import { useSquads } from '../../referentiels/hooks';
import HeatmapTable, { HeatLegend } from './HeatmapTable';
import { capacite, capaciteRows, heatOf, type Capacite } from './model';
import '../shared/pilotage.css';
import './capacite.css';

/** « S36 → S40 » quand la période tient dans une année, sinon avec les années. */
function periodOf(result: AnalyseResult) {
  const { week_from: from, week_to: to } = result.meta;
  const label = from.slice(0, 4) === to.slice(0, 4) ? shortWeek : fmtWeek;
  return from === to ? label(from) : `${label(from)} → ${label(to)}`;
}

// ------------------------------------------------------------------ Chiffres clés

function CapaciteMetrics({ data }: { data: Capacite }) {
  const t = data.total;
  const h = heatOf(t);
  return (
    <div className="pil-metrics">
      <Metric
        label="Capacité planifiée"
        value={fmtHours(t.prevu)}
        sub={`${t.personnes} personne${t.personnes > 1 ? 's' : ''} · Σ prévu du plan`}
      />
      <Metric label="Heures imputées" value={fmtHours(t.reel)} sub={`dont ${fmtHours(t.horsPlan)} hors plan`} />
      <Metric
        label="Taux d'utilisation"
        value={fmtPct(t.utilisation)}
        glyph={
          h.side === 'sur'
            ? { kind: 'danger', tone: 'sur_imputation' }
            : h.side === 'sous'
              ? { kind: 'attention', tone: 'sous_imputation' }
              : undefined
        }
        sub={
          t.utilisation == null
            ? 'Aucune heure prévue'
            : h.side
              ? `${h.side === 'sur' ? 'Sur-utilisé' : 'Sous-utilisé'} · réel ÷ prévu`
              : 'Conforme · réel ÷ prévu'
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ Page

const NO_SQUADS: Squad[] = [];

export default function CapacitePage() {
  const a = useAnalyse();
  const navigate = useNavigate();
  const squads = useSquads();
  const r = a.result.data;
  // Le référentiel ne sert qu'à la parenté : on l'attend, mais en cas d'erreur la liste reste à plat.
  const ref = squads.data ?? NO_SQUADS;
  const data = useMemo(
    () =>
      r && !squads.isLoading
        ? capacite(
            capaciteRows(r.ecarts, r.meta.include_inactive),
            r.meta.weeks,
            ref,
          )
        : null,
    [r, squads.isLoading, ref],
  );
  const nbSquads = data ? data.rows.filter((x) => x.id).length : 0;

  return (
    <Page
      toolbar={
        <PageToolbar
          title="Capacité"
          subtitle={
            r && (
              <>
                {data ? `${nbSquads} squad${nbSquads > 1 ? 's' : ''} · ` : ''}
                {periodOf(r)} <ArchivedTag result={r} /> <UncoveredNote result={r} short />
              </>
            )
          }
          actions={<ContextControl analyse={a} />}
        />
      }
    >
      <AnalyseGate analyse={a}>
        {(result) =>
          !data ? (
            <SkeletonRows rows={6} />
          ) : data.rows.length === 0 ? (
            <EmptyState title="Aucune heure à répartir">
              {result.meta.weeks.length > 0 && result.meta.weeks.every((w) => w.couverture === 'aucune')
                ? 'La période n’est couverte par aucune version du plan de charge.'
                : 'Le plan et le réalisé ne se recoupent pas sur la période.'}
            </EmptyState>
          ) : (
            <>
              <CapaciteMetrics data={data} />
              <HeatmapTable
                rows={data.rows}
                total={data.total}
                weeks={result.meta.weeks}
                period={periodOf(result)}
                onOpen={(id) => navigate(`/ecarts?squad=${encodeURIComponent(id)}&vue=ressource`)}
              />
              <HeatLegend uncovered={result.meta.weeks.some((w) => w.couverture === 'aucune')} />
              <p className="pil-note">
                Utilisation = heures imputées ÷ heures prévues, hors plan compris ; un squad parent cumule ses
                sous-squads. Cliquez sur un squad pour voir ses écarts.
              </p>
            </>
          )
        }
      </AnalyseGate>
    </Page>
  );
}
