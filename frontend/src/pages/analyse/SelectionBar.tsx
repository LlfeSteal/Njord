// Barre de sélection persistante (§8) : versions, plage de semaines, inactifs, exports.
import { useMemo, useState } from 'react';
import { Button, Checkbox, Group, Select, Spinner, Stack, Switch, Text, Tooltip } from '../../ui';
import { IconDownload } from '../../ui/Icons';
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

/** Téléchargement d'un export (équivalent d'un lien <a download>). */
function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
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
        label: `${fmtWeek(w.week)} (${fmtDate(w.debut)})${w.verrouillee ? ' · verrouillée' : ''}`,
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

  const exportBtn = (label: string, href: string) => (
    <Tooltip label={exportHint} disabled={!exportDisabled}>
      <Button size="sm" icon={<IconDownload size={14} />} disabled={exportDisabled} onClick={() => download(href)}>
        {label}
      </Button>
    </Tooltip>
  );

  return (
    <Stack gap={8}>
      <Group gap={8}>
        <Select
          aria-label="Version du plan"
          placeholder="Version du plan"
          data={planOpts}
          value={params.plan_version_id ?? null}
          onChange={(v) => v && update({ plan: v })}
          menuWidth={300}
        />
        <Select
          aria-label="Version du réalisé"
          placeholder="Version du réalisé"
          data={realOpts}
          value={params.realise_version_id ?? null}
          onChange={(v) => v && update({ realise: v })}
          menuWidth={300}
        />
        <Group gap={6} wrap={false}>
          <Select
            aria-label="Semaine de début"
            placeholder="Semaine de début"
            data={weekOpts.map((o) => ({ ...o, disabled: !!to && o.value > to }))}
            value={from}
            onChange={(v) => v && update({ from: v })}
          />
          <Text as="span" tone="secondary" aria-hidden>
            →
          </Text>
          <Select
            aria-label="Semaine de fin"
            placeholder="Semaine de fin"
            data={weekOpts.map((o) => ({ ...o, disabled: !!from && o.value < from }))}
            value={to}
            onChange={(v) => v && update({ to: v })}
          />
        </Group>
        <Switch label="Inclure les ressources inactives" checked={state.inactifs} onChange={(v) => update({ inactifs: v })} />
        {fetching && (
          <Group gap={6}>
            <Spinner size={14} label="Calcul en cours" />
            <Text size="sm" tone="secondary">
              Calcul en cours…
            </Text>
          </Group>
        )}
      </Group>
      <Group gap={8}>
        {exportBtn('Exporter CSV conformité', conformiteUrl)}
        <Group gap={8} wrap={false}>
          {exportBtn('Exporter CSV réalisé enrichi', enrichiUrl)}
          <Checkbox label="Masquer les données sensibles" checked={maskSensitive} onChange={setMaskSensitive} />
        </Group>
        {(state.ct || state.ressource || state.flags.length > 0 || state.squad) && (
          <Text size="sm" tone="secondary">
            L’export conformité applique les filtres du tableau d’écarts.
          </Text>
        )}
      </Group>
    </Stack>
  );
}
