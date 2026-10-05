// Contrôle compact du contexte d'analyse pour la barre d'outils des pages Pilotage :
// « Plan démo × Réalisé démo · S36 → S40 ▾ » ouvrant un popover (versions plan / réalisé, semaines, inactifs).
// CONTRAT FIGÉ (props) — implémentation : agent Pilotage A. Utilisé en lecture par Pilotage B.
// Exporte aussi AnalyseGate (états chargement / vide / erreur communs) et ArchivedTag.
import { useMemo, type ReactNode } from 'react';
import { Button, EmptyState, Group, Popover, Select, SkeletonRows, Spinner, Stack, Switch, Tag, type Option } from '../../../ui';
import { IconChevronDown } from '../../../ui/Icons';
import { ApiError } from '../../../api/client';
import type { AnalyseResult, Version } from '../../../api/types';
import ErrorAlert from '../../../components/ErrorAlert';
import { fmtDate, fmtWeek } from '../../../lib/format';
import type { UseAnalyse } from './context';
import { weekShort } from './pilotage';
import './pilotage.css';

export interface ContextControlProps {
  analyse: UseAnalyse;
}

/** Valeur sentinelle du Select « Version active » (sélection absente = défaut du contexte). */
const ACTIVE = '__active__';

function versionOptions(list: Version[], defaultId: string | null): Option[] {
  const active = list.find((v) => v.id === defaultId);
  return [
    { value: ACTIVE, label: 'Version active', description: active?.intitule },
    ...list
      .filter((v) => v.statut !== 'purgee')
      .map((v) => ({
        value: v.id,
        label: v.intitule,
        description: `${v.statut === 'archivee' ? 'Archivée · ' : ''}${fmtDate(v.periode_debut)} → ${fmtDate(v.periode_fin)}`,
      })),
  ];
}

export default function ContextControl({ analyse }: ContextControlProps) {
  const { selection, setSelection, context, params, result } = analyse;
  const ctx = context.data;

  const planOpts = useMemo(() => versionOptions(ctx?.plan_versions ?? [], ctx?.default_plan_id ?? null), [ctx]);
  const realOpts = useMemo(() => versionOptions(ctx?.realise_versions ?? [], ctx?.default_realise_id ?? null), [ctx]);
  const weekOpts = useMemo<Option[]>(
    () => (ctx?.weeks ?? []).map((w) => ({ value: w.week, label: `${fmtWeek(w.week)}${w.verrouillee ? ' · verrouillée' : ''}` })),
    [ctx],
  );

  const planName = ctx?.plan_versions.find((v) => v.id === params?.plan_version_id)?.intitule ?? 'Plan';
  const realName = ctx?.realise_versions.find((v) => v.id === params?.realise_version_id)?.intitule ?? 'Réalisé';
  const from = params?.week_from ?? null;
  const to = params?.week_to ?? null;
  const weeks = from || to ? `${weekShort(from)} → ${weekShort(to)}` : 'Toutes les semaines';
  const isDefault = !selection.plan && !selection.realise && !selection.from && !selection.to && !selection.inactifs;

  return (
    <span className="pil-ctx">
      {result.isFetching && <Spinner size={12} label="Calcul en cours" />}
      <Popover
        width={320}
        placement="bottom-end"
        target={(p) => (
          <button
            {...p}
            type="button"
            className="ui-popup pil-ctx__button"
            disabled={!ctx}
            aria-label={`Contexte d’analyse : ${planName} × ${realName}, ${weeks}`}
            title={`${planName} × ${realName} · ${weeks}${selection.inactifs ? ' · inactifs inclus' : ''}`}
          >
            <span className="pil-ctx__label">
              <span className="pil-ctx__part">{planName}</span>
              <span className="pil-ctx__sep">×</span>
              <span className="pil-ctx__part">{realName}</span>
              <span className="pil-ctx__sep">·</span>
              <span className="pil-ctx__weeks">{weeks}</span>
            </span>
            <IconChevronDown size={12} stroke={2.2} className="ui-popup__chevron" />
          </button>
        )}
      >
        <Stack gap={12}>
          <Select
            label="Plan de charge"
            data={planOpts}
            value={selection.plan ?? ACTIVE}
            onChange={(v) => setSelection({ plan: !v || v === ACTIVE ? undefined : v })}
            menuWidth={296}
          />
          <Select
            label="Réalisé"
            data={realOpts}
            value={selection.realise ?? ACTIVE}
            onChange={(v) => setSelection({ realise: !v || v === ACTIVE ? undefined : v })}
            menuWidth={296}
          />
          <div className="pil-ctx__weeks-row">
            <Select
              label="Du"
              data={weekOpts.map((o) => ({ ...o, disabled: !!to && o.value > to }))}
              value={from}
              placeholder="Début"
              onChange={(v) => v && setSelection({ from: v })}
              menuWidth={200}
            />
            <Select
              label="Au"
              data={weekOpts.map((o) => ({ ...o, disabled: !!from && o.value < from }))}
              value={to}
              placeholder="Fin"
              onChange={(v) => v && setSelection({ to: v })}
              menuWidth={200}
            />
          </div>
          <Switch
            label="Inclure les ressources inactives"
            checked={selection.inactifs}
            onChange={(v) => setSelection({ inactifs: v })}
          />
          <Group justify="end">
            <Button
              variant="plain"
              size="sm"
              disabled={isDefault}
              onClick={() => setSelection({ plan: undefined, realise: undefined, from: undefined, to: undefined, inactifs: false })}
            >
              Revenir aux valeurs par défaut
            </Button>
          </Group>
        </Stack>
      </Popover>
    </span>
  );
}

// ------------------------------------------------------------------ États communs

function ImportActions() {
  return (
    <Group gap={8} justify="center">
      <Button to="/plan">Plan de charge</Button>
      <Button to="/realise">Réalisé</Button>
    </Group>
  );
}

/**
 * États d'une page Pilotage : contexte en chargement, aucune version, refus métier (409), erreur,
 * calcul initial ; sinon rend `children(result)` (le résultat précédent reste affiché, estompé, pendant un recalcul).
 */
export function AnalyseGate({ analyse, children }: { analyse: UseAnalyse; children: (result: AnalyseResult) => ReactNode }) {
  const { context, ready, result } = analyse;
  if (context.isLoading) return <SkeletonRows rows={6} />;
  if (context.error) return <ErrorAlert error={context.error} title="Impossible de charger le contexte d’analyse" />;
  if (!ready)
    return (
      <EmptyState title="Importez un plan de charge et un réalisé" action={<ImportActions />}>
        {context.data?.message || 'Le pilotage croise une version du plan de charge avec une version du réalisé.'}
      </EmptyState>
    );
  if (result.error instanceof ApiError && result.error.status === 409)
    return (
      <EmptyState title="Analyse impossible" action={<ImportActions />}>
        {result.error.message}
      </EmptyState>
    );
  if (result.error && !result.data) return <ErrorAlert error={result.error} title="Échec du calcul de l’analyse" />;
  if (!result.data) return <SkeletonRows rows={6} />;
  return (
    <div className="pil-content" aria-busy={result.isPlaceholderData || undefined}>
      {result.error != null && <ErrorAlert error={result.error} title="Échec du recalcul de l’analyse" />}
      {children(result.data)}
    </div>
  );
}

/** Repère discret d'une version archivée utilisée (à placer dans le sous-titre). */
export function ArchivedTag({ result }: { result: AnalyseResult | undefined }) {
  if (!result?.meta.archived_warning) return null;
  return (
    <Tag tone="warning" glyph="warning" title="Analyse produite à partir d’une version archivée (lecture d’audit)">
      Version archivée
    </Tag>
  );
}
