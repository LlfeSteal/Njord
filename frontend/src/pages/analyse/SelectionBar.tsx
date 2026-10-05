// Barre de sélection persistante (§8) : versions, plage de semaines, inactifs, exports.
import { useMemo, useState } from 'react';
import { Button, Checkbox, Group, Loader, Paper, Select, Switch, Text, Tooltip } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { analyseApi } from '../../api/client';
import type { AnalyseContext, AnalyseParams, Version } from '../../api/types';
import { fmtDate, fmtWeek } from '../../lib/format';
import { ecartsCsvQuery, type AnalyseUrlState, type UrlPatch } from './params';
import { ANALYSE_MOCK } from './service';

function versionOptions(list: Version[]) {
  return list
    .filter((v) => v.statut !== 'purgee')
    .map((v) => ({
      value: v.id,
      label: `${v.intitule}${v.statut === 'archivee' ? ' (archivée)' : ''} — ${fmtDate(v.periode_debut)} → ${fmtDate(v.periode_fin)}`,
    }));
}

export default function SelectionBar({
  context,
  params,
  state,
  update,
  fetching,
  canExport,
}: {
  context: AnalyseContext;
  params: AnalyseParams;
  state: AnalyseUrlState;
  update: (p: UrlPatch) => void;
  fetching: boolean;
  canExport: boolean;
}) {
  const [maskSensitive, setMaskSensitive] = useState(true);
  const planOpts = useMemo(() => versionOptions(context.plan_versions), [context.plan_versions]);
  const realOpts = useMemo(() => versionOptions(context.realise_versions), [context.realise_versions]);
  const weekOpts = useMemo(
    () =>
      context.weeks.map((w) => ({
        value: w.week,
        label: `${fmtWeek(w.week)} (${fmtDate(w.debut)})${w.verrouillee ? ' 🔒' : ''}`,
      })),
    [context.weeks],
  );
  const from = params.week_from ?? null;
  const to = params.week_to ?? null;

  const exportDisabled = !canExport || ANALYSE_MOCK;
  const exportHint = ANALYSE_MOCK ? 'Indisponible en mode maquette (VITE_ANALYSE_MOCK)' : 'Analyse indisponible';
  const conformiteUrl = analyseApi.ecartsCsvUrl(ecartsCsvQuery(params, state));
  const enrichiUrl = analyseApi.realiseEnrichiCsvUrl({
    ...params,
    include_inactive: params.include_inactive || undefined,
    mask_sensitive: maskSensitive,
  });

  const exportBtn = (label: string, href: string) => {
    const btn = (
      <Button
        component="a"
        href={exportDisabled ? undefined : href}
        download
        variant="default"
        size="xs"
        leftSection={<IconDownload size={14} />}
        disabled={exportDisabled}
      >
        {label}
      </Button>
    );
    return exportDisabled ? (
      <Tooltip label={exportHint}>
        <span>{btn}</span>
      </Tooltip>
    ) : (
      btn
    );
  };

  return (
    <Paper withBorder p="sm" radius="md">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select
          label="Version du plan"
          placeholder="Aucun plan"
          data={planOpts}
          value={params.plan_version_id ?? null}
          onChange={(v) => update({ plan: v })}
          allowDeselect={false}
          w={{ base: '100%', sm: 300 }}
          comboboxProps={{ width: 'target', withinPortal: true }}
        />
        <Select
          label="Version du réalisé"
          placeholder="Aucun réalisé"
          data={realOpts}
          value={params.realise_version_id ?? null}
          onChange={(v) => update({ realise: v })}
          allowDeselect={false}
          w={{ base: '100%', sm: 300 }}
        />
        <Group gap={6} align="flex-end" wrap="nowrap">
          <Select
            label="Semaine de début"
            data={weekOpts.map((o) => ({ ...o, disabled: !!to && o.value > to }))}
            value={from}
            onChange={(v) => update({ from: v })}
            allowDeselect={false}
            w={170}
          />
          <Select
            label="Semaine de fin"
            data={weekOpts.map((o) => ({ ...o, disabled: !!from && o.value < from }))}
            value={to}
            onChange={(v) => update({ to: v })}
            allowDeselect={false}
            w={170}
          />
        </Group>
        <Switch
          label="Inclure les ressources inactives"
          checked={state.inactifs}
          onChange={(e) => update({ inactifs: e.currentTarget.checked })}
          mb={8}
        />
        {fetching && (
          <Group gap={6} mb={8}>
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              Calcul en cours…
            </Text>
          </Group>
        )}
      </Group>
      <Group gap="sm" mt="sm" wrap="wrap">
        {exportBtn('Exporter CSV conformité', conformiteUrl)}
        <Group gap={8} wrap="nowrap">
          {exportBtn('Exporter CSV réalisé enrichi', enrichiUrl)}
          <Checkbox
            size="xs"
            label="Masquer les données sensibles"
            checked={maskSensitive}
            onChange={(e) => setMaskSensitive(e.currentTarget.checked)}
          />
        </Group>
        {(state.ct || state.ressource || state.flags.length > 0 || state.squad) && (
          <Text size="xs" c="dimmed">
            L’export conformité applique les filtres du tableau d’écarts.
          </Text>
        )}
      </Group>
    </Paper>
  );
}
