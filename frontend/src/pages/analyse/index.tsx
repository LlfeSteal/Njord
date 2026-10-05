// Module Analyse — monté sur /analyse/* : croisement plan de charge × réalisé (SPEC_analyse §6-§10).
// Sous-onglets liés à la route : /analyse (tableau de bord), /analyse/ecarts, /budget, /alertes, /correspondances.
// Les paramètres d'analyse et les filtres vivent dans la query string (partage / drill-down).
import { useMemo } from 'react';
import { Alert, Badge, Box, Button, Group, Skeleton, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconArchive, IconInfoCircle } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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

const TABS = [
  { value: 'dashboard', label: 'Tableau de bord' },
  { value: 'ecarts', label: 'Écarts' },
  { value: 'budget', label: 'Budget' },
  { value: 'alertes', label: 'Alertes' },
  { value: 'correspondances', label: 'Correspondances' },
] as const;

function NoAnalysis({ message }: { message: string }) {
  return (
    <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />} title="Analyse impossible">
      <Stack gap="sm">
        <Text size="sm">{message}</Text>
        <Text size="sm" c="dimmed">
          Importez ou activez une version, ou sélectionnez explicitement une version archivée ci-dessus pour un audit.
        </Text>
        <Group gap="sm">
          <Button component={Link} to="/plan" size="xs" variant="light">
            Aller au Plan de charge
          </Button>
          <Button component={Link} to="/realise" size="xs" variant="light">
            Aller au Réalisé
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

function ArchivedWarning({ result }: { result: AnalyseResult }) {
  const which = [
    result.meta.plan_version?.statut === 'archivee' && `plan « ${result.meta.plan_version.intitule} »`,
    result.meta.realise_version?.statut === 'archivee' && `réalisé « ${result.meta.realise_version.intitule} »`,
  ].filter(Boolean);
  return (
    <Alert color="orange" variant="light" icon={<IconArchive size={18} />} title="Version archivée en lecture">
      Analyse produite à partir d’une version archivée{which.length ? ` (${which.join(', ')})` : ''}. Les résultats sont
      fournis à titre d’audit et ne reflètent pas les versions actives.
    </Alert>
  );
}

function ResultSkeleton() {
  return (
    <Stack gap="md" aria-busy="true" aria-label="Calcul de l’analyse en cours">
      <Group grow>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} h={110} radius="md" />
        ))}
      </Group>
      <Skeleton h={280} radius="md" />
      <Skeleton h={180} radius="md" />
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
  const currentTab = TABS.some((t) => t.value === seg) ? seg : 'dashboard';

  const counts = result && {
    ecarts: result.ecarts.filter((e) => e.flag !== 'conforme').length,
    alertes: result.alertes.ct_risque.length + result.alertes.derive_provision.length + (result.alertes.alerte_globale ? 1 : 0),
    fuzzy: result.correspondances.filter((c) => c.confidence === 'fuzzy').length,
  };
  const badgeFor = (v: string) => {
    if (!counts) return null;
    const n = v === 'ecarts' ? counts.ecarts : v === 'alertes' ? counts.alertes : v === 'correspondances' ? counts.fuzzy : 0;
    if (!n) return null;
    return (
      <Badge size="xs" variant="light" color={v === 'alertes' ? 'red' : v === 'correspondances' ? 'yellow' : 'gray'} aria-label={`${n} à traiter`}>
        {n}
      </Badge>
    );
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="baseline" wrap="wrap">
        <Group gap="xs" align="baseline">
          <Title order={2}>Analyse</Title>
          {ANALYSE_MOCK && (
            <Badge color="grape" variant="outline">
              Maquette
            </Badge>
          )}
        </Group>
        {result && (
          <Text size="xs" c="dimmed">
            {fmtWeek(result.meta.week_from)} → {fmtWeek(result.meta.week_to)} · calculée le {fmtDateTime(result.meta.generated_at)}
          </Text>
        )}
      </Group>

      {ctxQ.isLoading && <Skeleton h={120} radius="md" />}
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

          <Tabs value={currentTab} onChange={(v) => navigate(tabLink(!v || v === 'dashboard' ? '' : v))} keepMounted={false}>
            <Tabs.List style={{ flexWrap: 'wrap' }}>
              {TABS.map((t) => (
                <Tabs.Tab key={t.value} value={t.value} rightSection={badgeFor(t.value)}>
                  {t.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          <Box
            style={{ opacity: resQ.isPlaceholderData ? 0.55 : 1, transition: 'opacity 150ms' }}
            aria-busy={resQ.isPlaceholderData}
          >
            <Routes>
              <Route index element={<DashboardTab result={result} />} />
              <Route path="ecarts" element={<EcartsTab result={result} state={state} update={update} />} />
              <Route path="budget" element={<BudgetTab result={result} />} />
              <Route path="alertes" element={<AlertesTab result={result} />} />
              <Route path="correspondances" element={<CorrespondancesTab result={result} />} />
              <Route path="*" element={<Navigate to={tabLink('')} replace />} />
            </Routes>
          </Box>
        </>
      )}
    </Stack>
  );
}
