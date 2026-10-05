// Module Analyse — monté sur /analyse/* : croisement plan de charge × réalisé (SPEC_analyse §6-§10).
// Sous-onglets liés à la route : /analyse (tableau de bord), /analyse/ecarts, /budget, /alertes, /correspondances.
// Les paramètres d'analyse et les filtres vivent dans la query string (partage / drill-down).
import { useMemo } from 'react';
import { Banner, Button, Grid, Group, Pill, SegmentedControl, Skeleton, Stack, Text, Title } from '../../ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { AnalyseResult } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime, fmtWeek } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import AlertesTab from './AlertesTab';
import BudgetTab from './BudgetTab';
import CorrespondancesTab from './CorrespondancesTab';
import DashboardTab from './DashboardTab';
import EcartsTab from './EcartsTab';
import QualiteBanner from './QualiteBanner';
import SelectionBar from './SelectionBar';
import { resolveParams, useAnalyseUrl, useTabLink } from './params';
import { ANALYSE_MOCK, analyseService } from './service';
import './analyse.css';

const TABS = [
  { value: 'dashboard', label: 'Tableau de bord' },
  { value: 'ecarts', label: 'Écarts' },
  { value: 'budget', label: 'Budget' },
  { value: 'alertes', label: 'Alertes' },
  { value: 'correspondances', label: 'Correspondances' },
] as const;
type TabValue = (typeof TABS)[number]['value'];

function NoAnalysis({ message }: { message: string }) {
  return (
    <Banner tone="info" title="Analyse impossible">
      <Stack gap={8}>
        <Text tone="primary">{message}</Text>
        <Text tone="secondary">
          Importez ou activez une version, ou sélectionnez explicitement une version archivée ci-dessus pour un audit.
        </Text>
        <Group gap={8}>
          <Button to="/plan" size="sm">
            Aller au Plan de charge
          </Button>
          <Button to="/realise" size="sm">
            Aller au Réalisé
          </Button>
        </Group>
      </Stack>
    </Banner>
  );
}

function ArchivedWarning({ result }: { result: AnalyseResult }) {
  const which = [
    result.meta.plan_version?.statut === 'archivee' && `plan « ${result.meta.plan_version.intitule} »`,
    result.meta.realise_version?.statut === 'archivee' && `réalisé « ${result.meta.realise_version.intitule} »`,
  ].filter(Boolean);
  return (
    <Banner tone="warning" title="Version archivée en lecture">
      Analyse produite à partir d’une version archivée{which.length ? ` (${which.join(', ')})` : ''}. Les résultats sont
      fournis à titre d’audit et ne reflètent pas les versions actives.
    </Banner>
  );
}

function ResultSkeleton() {
  return (
    <Stack gap={12} aria-busy="true" aria-label="Calcul de l’analyse en cours">
      <Grid cols={3}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={110} radius={12} />
        ))}
      </Grid>
      <Skeleton height={280} radius={12} />
      <Skeleton height={180} radius={12} />
    </Stack>
  );
}

export default function AnalyseModule() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabLink = useTabLink();
  const { state, update } = useAnalyseUrl();

  const ctxQ = useQuery({ queryKey: qk.analyseContext(), queryFn: analyseService.context });
  const ctx = ctxQ.data;

  const params = useMemo(
    () => resolveParams(ctx, state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, state.plan, state.realise, state.from, state.to, state.inactifs],
  );
  // Pas de plan actif (ou autre message du contexte) : l'analyse n'est lancée que sur sélection explicite.
  const blocked = !!ctx?.message && !state.plan && !state.realise;
  const ready = !!ctx && !blocked && !!params.plan_version_id && !!params.realise_version_id;

  const resQ = useQuery({
    queryKey: qk.analyse(params),
    queryFn: () => analyseService.run(params),
    enabled: ready,
    placeholderData: keepPreviousData,
    retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 1,
  });
  const result = ready ? resQ.data : undefined;
  const precondition = resQ.error instanceof ApiError && resQ.error.status === 409;

  const seg = location.pathname.replace(/^\/analyse\/?/, '').split('/')[0] ?? '';
  const currentTab: TabValue = TABS.find((t) => t.value === seg)?.value ?? 'dashboard';

  const counts = result && {
    ecarts: result.ecarts.filter((e) => e.flag !== 'conforme').length,
    alertes: result.alertes.ct_risque.length + result.alertes.derive_provision.length + (result.alertes.alerte_globale ? 1 : 0),
    fuzzy: result.correspondances.filter((c) => c.confidence === 'fuzzy').length,
  };
  const countFor = (v: TabValue) => {
    if (!counts) return undefined;
    const n = v === 'ecarts' ? counts.ecarts : v === 'alertes' ? counts.alertes : v === 'correspondances' ? counts.fuzzy : 0;
    return n || undefined;
  };

  return (
    <Stack gap={12}>
      <Group justify="between" align="baseline">
        <Group gap={8} align="baseline">
          <Title order={2}>Analyse</Title>
          {ANALYSE_MOCK && <Pill>Maquette</Pill>}
        </Group>
        {result && (
          <Text size="sm" tone="secondary" tabular>
            {fmtWeek(result.meta.week_from)} → {fmtWeek(result.meta.week_to)} · calculée le {fmtDateTime(result.meta.generated_at)}
          </Text>
        )}
      </Group>

      {ctxQ.isLoading && <Skeleton height={120} radius={12} />}
      <ErrorAlert error={ctxQ.error} title="Impossible de charger le contexte d’analyse" />

      {ctx && (
        <SelectionBar
          context={ctx}
          params={params}
          state={state}
          update={update}
          fetching={resQ.isFetching}
          canExport={ready && !resQ.isError}
        />
      )}

      {ctx && blocked && <NoAnalysis message={ctx.message} />}
      {ctx && !blocked && !ready && (
        <NoAnalysis message={ctx.message || 'Aucune version de plan ou de réalisé disponible pour l’analyse.'} />
      )}
      {ready && precondition && <NoAnalysis message={(resQ.error as ApiError).message} />}
      {ready && resQ.isError && !precondition && <ErrorAlert error={resQ.error} title="Échec du calcul de l’analyse" />}

      {ready && resQ.isLoading && <ResultSkeleton />}

      {result && !resQ.isError && (
        <>
          {result.meta.archived_warning && <ArchivedWarning result={result} />}
          <QualiteBanner qualite={result.qualite} />

          <div style={{ overflowX: 'auto' }}>
            <SegmentedControl
              aria-label="Vues de l’analyse"
              equal={false}
              value={currentTab}
              onChange={(v) => navigate(tabLink(v === 'dashboard' ? '' : v))}
              data={TABS.map((t) => ({ value: t.value, label: t.label, count: countFor(t.value) }))}
            />
          </div>

          <div className="analyse-content" aria-busy={resQ.isPlaceholderData}>
            <Routes>
              <Route index element={<DashboardTab result={result} />} />
              <Route path="ecarts" element={<EcartsTab result={result} state={state} update={update} />} />
              <Route path="budget" element={<BudgetTab result={result} />} />
              <Route path="alertes" element={<AlertesTab result={result} />} />
              <Route path="correspondances" element={<CorrespondancesTab result={result} />} />
              <Route path="*" element={<Navigate to={tabLink('')} replace />} />
            </Routes>
          </div>
        </>
      )}
    </Stack>
  );
}
