// Contrôle compact du contexte d'analyse pour la barre d'outils des pages Pilotage :
// « Plan démo × Réalisé démo · S36 → S40 ▾ » ouvrant un popover (versions plan / réalisé, semaines, inactifs).
// CONTRAT FIGÉ (props) — implémentation : agent Pilotage A. Utilisé en lecture par Pilotage B.
// Exporte aussi AnalyseGate (états chargement / vide / erreur communs), ArchivedTag et UncoveredNote.
// Le plan choisi désigne la timeline connue à la date de cette version (DECISIONS n° 13).
import { useMemo, type ReactNode } from 'react';
import { Button, EmptyState, Group, Popover, Select, SkeletonRows, Spinner, Stack, Switch, Tag, type Option } from '../../../ui';
import { IconChevronDown } from '../../../ui/Icons';
import { ApiError } from '../../../api/client';
import type { AnalyseResult, Version } from '../../../api/types';
import ErrorAlert from '../../../components/ErrorAlert';
import { fmtDate, fmtHours, fmtWeek } from '../../../lib/format';
import type { UseAnalyse } from './context';
import { heuresNonCouvertes, uncoveredSentence, weekShort } from './pilotage';
import './pilotage.css';

export interface ContextControlProps {
  analyse: UseAnalyse;
}

/** Valeur sentinelle des Select (sélection absente = défaut du contexte : dernier plan, réalisé actif). */
const ACTIVE = '__active__';

const archived = (v: Version) => (v.statut === 'archivee' ? 'Archivée · ' : '');

function versionOptions(
  list: Version[],
  defaultId: string | null,
  defaultLabel: string,
  describe: (v: Version) => string,
): Option[] {
  const active = list.find((v) => v.id === defaultId);
  return [
    { value: ACTIVE, label: defaultLabel, description: active?.intitule },
    ...list
      .filter((v) => v.statut !== 'purgee')
      .map((v) => ({ value: v.id, label: v.intitule, description: `${archived(v)}${describe(v)}` })),
  ];
}

/** Plan : la date d'effet situe la version dans la timeline. */
const describePlan = (v: Version) => `Date d’effet ${fmtDate(v.date_effet ?? v.periode_debut)}`;
const describeRealise = (v: Version) => `${fmtDate(v.periode_debut)} → ${fmtDate(v.periode_fin)}`;

export default function ContextControl({ analyse }: ContextControlProps) {
  const { selection, setSelection, context, params, result } = analyse;
  const ctx = context.data;

  const planOpts = useMemo(
    () => versionOptions(ctx?.plan_versions ?? [], ctx?.default_plan_id ?? null, 'Dernier plan (timeline complète)', describePlan),
    [ctx],
  );
  const realOpts = useMemo(
    () => versionOptions(ctx?.realise_versions ?? [], ctx?.default_realise_id ?? null, 'Version active', describeRealise),
    [ctx],
  );
  const weekOpts = useMemo<Option[]>(
    () =>
      (ctx?.weeks ?? []).map((w) => ({
        value: w.week,
        label: `${fmtWeek(w.week)}${w.verrouillee ? ' · verrouillée' : ''}${w.couverture === 'aucune' ? ' · non couverte' : ''}`,
      })),
    [ctx],
  );

  // Plan par défaut = timeline complète ; plan choisi = timeline connue à la date de cette version.
  const planVersion = ctx?.plan_versions.find((v) => v.id === params?.plan_version_id)?.intitule;
  const planName = selection.plan && planVersion ? planVersion : 'Dernier plan';
  const planTitle = selection.plan && planVersion ? `Plan connu au ${planVersion}` : `Dernier plan${planVersion ? ` (${planVersion})` : ''}`;
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
            aria-label={`Contexte d’analyse : ${planTitle} × ${realName}, ${weeks}`}
            title={`${planTitle} × ${realName} · ${weeks}${selection.inactifs ? ' · inactifs inclus' : ''}`}
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
            label="Plan connu au"
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
        {context.data?.message ||
          'Le pilotage croise la timeline du plan de charge (toutes ses versions, chacune à partir de sa date d’effet) avec une version du réalisé.'}
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

/**
 * Repère discret d'une lecture d'audit (à placer dans le sous-titre) : timeline connue à une version de plan
 * antérieure à la dernière, et/ou réalisé archivé (`meta.archived_warning`).
 */
export function ArchivedTag({ result }: { result: AnalyseResult | undefined }) {
  if (!result?.meta.archived_warning) return null;
  const realArchived = result.meta.realise_version?.statut === 'archivee';
  const planOld = !realArchived || result.meta.plan_version?.statut === 'archivee';
  const label = planOld && realArchived ? 'Plan antérieur · réalisé archivé' : realArchived ? 'Réalisé archivé' : 'Plan antérieur';
  const why = [
    planOld && 'la timeline du plan connue à une version antérieure à la dernière',
    realArchived && 'une version archivée du réalisé',
  ]
    .filter(Boolean)
    .join(' et ');
  return (
    <Tag tone="warning" glyph="warning" title={`Analyse produite avec ${why} (lecture d’audit)`}>
      {label}
    </Tag>
  );
}

/**
 * Mention discrète des heures non couvertes par le plan (sous-titre, synthèse) ; rien s'il n'y en a pas.
 * `short` : « 12 h non couvertes par le plan », phrase complète en bulle.
 */
export function UncoveredNote({ result, short = false }: { result: AnalyseResult | undefined; short?: boolean }) {
  const h = heuresNonCouvertes(result);
  if (h <= 0) return null;
  const sentence = uncoveredSentence(h);
  return (
    <span className="pil-uncovered" title={short ? sentence : undefined}>
      <span className="pil-swatch" data-shape="hatch" aria-hidden />
      {short ? `${fmtHours(h)} non couvertes par le plan` : sentence}
    </span>
  );
}
