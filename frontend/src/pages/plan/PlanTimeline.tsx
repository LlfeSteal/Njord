// Timeline du plan de charge (DECISIONS n° 13) : Gantt des segments par ressource, groupés par squad.
// Bande du haut = fenêtres des versions (où chacune fait référence) et périodes « Non couvert par le plan
// de charge » (hachure --uncovered-hatch). Une seule teinte (piste « prévu ») : les versions se distinguent
// par un filet vertical à chaque date d'effet et une encoche à gauche des barres qui démarrent à une
// relève de version. Filtres et version dans l'URL (?plan=&ct=&squad=&q=&vue=).
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/fr';
import {
  ActiveFilters,
  Button,
  Card,
  EmptyState,
  FilterButton,
  Group,
  Page,
  PageToolbar,
  SearchField,
  SegmentedControl,
  Select,
  SkeletonRows,
  Stack,
  Table,
  Text,
  Tooltip,
  type ActiveFilter,
} from '../../ui';
import { IconDownload, IconImport } from '../../ui/Icons';
import { analyseApi } from '../../api/client';
import type { TimelineSegment, TimelineWindow, Version } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtRange, plural } from '../../components/lifecycle/lifecycleUtils';
import { useVersionHistory } from '../../components/lifecycle/useCurrentVersion';
import { isReplaced, usePlanTimeline } from '../../components/lifecycle/usePlanTimeline';
import { fmtDate, fmtDateTime, fmtEur, fmtHours, fmtPct } from '../../lib/format';
import { download } from './download';
import './plan.css';
import './PlanTimeline.css';

// ------------------------------------------------------------------ Constantes de tracé

const LABEL_W = 220;
const BAR_H = 20;
const LANE_GAP = 2;
const ROW_PAD = 4;
/** Échelle minimale (px par jour) : en deçà, le Gantt défile horizontalement. */
const MIN_PPD = 3;
const NO_SQUAD = '__sans_squad__';
const SANS_SQUAD = 'Sans squad';
const UNCOVERED = 'Non couvert par le plan de charge';

type View = 'gantt' | 'table';
const PARAM_KEYS = ['plan', 'ct', 'squad', 'q', 'vue'] as const;
type ParamKey = (typeof PARAM_KEYS)[number];

const STATUT_LABEL: Record<Version['statut'], string> = { active: 'active', archivee: 'archivée', purgee: 'purgée' };

// ------------------------------------------------------------------ Utilitaires

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const day = (iso: string) => dayjs(iso.slice(0, 10));

/** Mesure la largeur d'un élément (ResizeObserver). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function useTimelineParams() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo(
    () => Object.fromEntries(PARAM_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<ParamKey, string>,
    [sp],
  );
  const update = useCallback(
    (patch: Partial<Record<ParamKey, string>>) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (!v) n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );
  return { params, update };
}

interface Interval {
  debut: Dayjs;
  fin: Dayjs;
}

/** Jours de [r0, r1] hors de toute fenêtre. */
function uncoveredIntervals(windows: TimelineWindow[], r0: Dayjs, r1: Dayjs): Interval[] {
  const out: Interval[] = [];
  let cursor = r0;
  for (const w of windows) {
    const d = day(w.debut);
    const f = day(w.fin);
    if (d.isAfter(cursor)) out.push({ debut: cursor, fin: d.subtract(1, 'day') });
    if (!f.isBefore(cursor)) cursor = f.add(1, 'day');
  }
  if (!cursor.isAfter(r1)) out.push({ debut: cursor, fin: r1 });
  return out.filter((i) => !i.fin.isBefore(i.debut));
}

interface Placed {
  seg: TimelineSegment;
  lane: number;
}
interface Row {
  key: string;
  ressource: string;
  nominative: boolean;
  lanes: number;
  items: Placed[];
  /** Libellés des autres squads portées par des segments de la ligne (hors squad du groupe). */
  otherSquads: string[];
}
interface SquadGroup {
  key: string;
  label: string;
  rows: Row[];
}

/** Empile les segments qui se chevauchent sur des couloirs (premier couloir libre). */
function placeLanes(segs: TimelineSegment[]): { items: Placed[]; lanes: number } {
  const sorted = [...segs].sort((a, b) => a.debut.localeCompare(b.debut) || a.ct.localeCompare(b.ct));
  const ends: string[] = [];
  const items = sorted.map((seg) => {
    let lane = ends.findIndex((end) => end < seg.debut);
    if (lane < 0) {
      lane = ends.length;
      ends.push(seg.fin);
    } else ends[lane] = seg.fin;
    return { seg, lane };
  });
  return { items, lanes: Math.max(1, ends.length) };
}

const squadKey = (s: TimelineSegment) => s.squad_nom || NO_SQUAD;
const squadLabel = (key: string) => (key === NO_SQUAD ? SANS_SQUAD : key);

/** Segment le plus récent (début le plus tardif, puis fin, puis squad) : fixe le groupe de la ligne. */
const latestOf = (list: TimelineSegment[]) =>
  list.reduce((a, b) =>
    (b.debut.localeCompare(a.debut) || b.fin.localeCompare(a.fin) || squadKey(a).localeCompare(squadKey(b))) > 0 ? b : a,
  );

/**
 * Une ligne par ressource : les personnes (nom_prenom) ont une seule ligne, rangée dans la squad de leur
 * segment le plus récent ; leurs segments d'autres squads restent sur cette ligne. Les lignes non
 * nominatives restent par (squad, libellé).
 */
function groupSegments(segs: TimelineSegment[]): SquadGroup[] {
  const byRow = new Map<string, TimelineSegment[]>();
  for (const s of segs) {
    const k = s.nom_prenom ? `p|${s.nom_prenom}` : `r|${squadKey(s)}|${s.ressource}`;
    const list = byRow.get(k) ?? [];
    byRow.set(k, list);
    list.push(s);
  }
  const groups = new Map<string, Row[]>();
  for (const [key, list] of byRow) {
    const latest = latestOf(list);
    const home = squadKey(latest);
    const otherSquads = [...new Set(list.map(squadKey))]
      .filter((k) => k !== home)
      .map(squadLabel)
      .sort((a, b) => a.localeCompare(b, 'fr'));
    const { items, lanes } = placeLanes(list);
    const rows = groups.get(home) ?? [];
    groups.set(home, rows);
    rows.push({ key, ressource: latest.ressource, nominative: latest.nom_prenom !== '', lanes, items, otherSquads });
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({
      key,
      label: squadLabel(key),
      // Personnes d'abord (ordre alphabétique), lignes non nominatives ensuite.
      rows: rows.sort(
        (a, b) => Number(b.nominative) - Number(a.nominative) || a.ressource.localeCompare(b.ressource, 'fr'),
      ),
    }))
    .sort((a, b) => Number(a.key === NO_SQUAD) - Number(b.key === NO_SQUAD) || a.label.localeCompare(b.label, 'fr'));
}

const rowHeight = (lanes: number) => lanes * BAR_H + (lanes - 1) * LANE_GAP + 2 * ROW_PAD;
/**
 * Largeur minimale (px) d'une marque pour y écrire un libellé : au-delà, le texte est tronqué en CSS
 * (text-overflow: ellipsis) ; en deçà, rien n'est écrit (la bulle reste disponible).
 */
const MIN_LABEL_W = 28;
const labelIn = (text: string, w: number) => (w >= MIN_LABEL_W ? <span className="ptl__text">{text}</span> : null);
/**
 * Libellé de barre « CT · % » dégradé en CSS seul : si le tout ne tient pas, « · % » passe à la ligne
 * (masquée) et il reste le CT, lui-même tronqué par ellipse.
 */
const barLabelIn = (s: TimelineSegment, w: number) =>
  w >= MIN_LABEL_W ? (
    <span className="ptl__bar-text">
      <span className="ptl__bar-ct">{s.ct}</span>
      <span className="ptl__bar-pct">&nbsp;· {s.pourcentage} %</span>
    </span>
  ) : null;

// ------------------------------------------------------------------ Page

export default function PlanTimeline() {
  const navigate = useNavigate();
  const { params, update } = useTimelineParams();
  const view: View = params.vue === 'table' ? 'table' : 'gantt';
  const history = useVersionHistory('plan');
  const timeline = usePlanTimeline(params.plan || undefined);
  const data = timeline.data;

  // Recherche « ressource » : saisie locale (filtrage client immédiat), recopiée dans l'URL.
  const [q, setQ] = useState(params.q);
  const onSearch = (v: string) => {
    setQ(v);
    update({ q: v.trim() });
  };

  const versionsById = useMemo(() => new Map((history.data ?? []).map((v) => [v.id, v])), [history.data]);
  const windowsById = useMemo(() => new Map((data?.windows ?? []).map((w) => [w.version_id, w])), [data]);
  /** Fenêtres non vides, dans l'ordre chronologique. */
  const windows = useMemo(
    () => (data?.windows ?? []).filter((w) => !isReplaced(w)).sort((a, b) => a.debut.localeCompare(b.debut)),
    [data],
  );
  const replaced = useMemo(() => (data?.windows ?? []).filter(isReplaced), [data]);

  // Options des filtres (sur toute la timeline, pas sur la sélection courante).
  const ctOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of data?.segments ?? []) if (!m.has(s.ct)) m.set(s.ct, s.ct_libelle);
    if (params.ct && !m.has(params.ct)) m.set(params.ct, '');
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, lib]) => ({ value, label: value, description: lib || undefined }));
  }, [data, params.ct]);
  const squadOptions = useMemo(() => {
    const set = new Set((data?.segments ?? []).map((s) => s.squad_nom || NO_SQUAD));
    if (params.squad) set.add(params.squad);
    return [...set]
      .sort((a, b) => Number(a === NO_SQUAD) - Number(b === NO_SQUAD) || a.localeCompare(b, 'fr'))
      .map((v) => ({ value: v, label: v === NO_SQUAD ? SANS_SQUAD : v }));
  }, [data, params.squad]);
  const planOptions = useMemo(
    () =>
      [...(history.data ?? [])]
        .sort((a, b) => b.importee_le.localeCompare(a.importee_le))
        .map((v) => ({
          value: v.id,
          label: v.intitule,
          description: `Importée le ${fmtDateTime(v.importee_le)}${v.date_effet ? ` · effet ${fmtDate(v.date_effet)}` : ''}`,
        })),
    [history.data],
  );

  const segments = useMemo(() => {
    const needle = norm(q.trim());
    return (data?.segments ?? []).filter(
      (s) =>
        (!params.ct || s.ct === params.ct) &&
        (!params.squad || (s.squad_nom || NO_SQUAD) === params.squad) &&
        (!needle || norm(s.ressource).includes(needle)),
    );
  }, [data, params.ct, params.squad, q]);
  const groups = useMemo(() => groupSegments(segments), [segments]);
  const nbRessources = groups.reduce((n, g) => n + g.rows.length, 0);

  const planVersion = data?.plan_version ?? null;
  const latestId = planOptions[0]?.value;
  const isLatest = !params.plan || params.plan === latestId;

  const openSegment = (s: TimelineSegment) => {
    const sp = new URLSearchParams({ ct: s.ct });
    if (s.nom_prenom) sp.set('nom_prenom', s.nom_prenom);
    navigate({ pathname: `/plan/${s.version_id}`, search: sp.toString() });
  };
  const openVersion = (id: string) => navigate(`/plan/${id}`);

  // ---------------------------------------------------------------- Filtres
  const criteria: ParamKey[] = ['plan', 'ct', 'squad'];
  const count = criteria.filter((k) => params[k] !== '' && !(k === 'plan' && isLatest)).length;
  const clearCriteria = () => update({ plan: '', ct: '', squad: '' });
  const pills: ActiveFilter[] = [];
  if (params.plan && !isLatest)
    pills.push({
      key: 'plan',
      label: `Plan connu au : ${versionsById.get(params.plan)?.intitule ?? planVersion?.intitule ?? params.plan}`,
      onRemove: () => update({ plan: '' }),
    });
  if (params.ct) pills.push({ key: 'ct', label: `CT : ${params.ct}`, onRemove: () => update({ ct: '' }) });
  if (params.squad)
    pills.push({
      key: 'squad',
      label: `Squad : ${params.squad === NO_SQUAD ? SANS_SQUAD : params.squad}`,
      onRemove: () => update({ squad: '' }),
    });

  const bottom = (
    <Group gap={8} wrap={false} className="plan-bottom">
      <SearchField aria-label="Rechercher une ressource" placeholder="Ressource…" value={q} onChange={onSearch} />
      <FilterButton count={count} onReset={clearCriteria}>
        <Stack gap={12}>
          <Select
            label="Plan connu au"
            description="Timeline des versions importées jusqu'à celle-ci."
            placeholder="Dernière version"
            width="100%"
            data={planOptions}
            value={params.plan || null}
            onChange={(v) => update({ plan: v && v !== latestId ? v : '' })}
            searchable
            clearable
            menuWidth={290}
          />
          <Select
            label="CT"
            placeholder="Tous"
            width="100%"
            data={ctOptions}
            value={params.ct || null}
            onChange={(v) => update({ ct: v ?? '' })}
            searchable
            clearable
            menuWidth={290}
          />
          <Select
            label="Squad"
            placeholder="Tous"
            width="100%"
            data={squadOptions}
            value={params.squad || null}
            onChange={(v) => update({ squad: v ?? '' })}
            searchable
            clearable
            menuWidth={290}
          />
        </Stack>
      </FilterButton>
      <div className="plan-bottom__pills">
        <ActiveFilters items={pills} onClearAll={pills.length > 1 ? clearCriteria : undefined} />
      </div>
      <SegmentedControl
        aria-label="Affichage"
        className="ptl-view"
        equal={false}
        value={view}
        onChange={(v) => update({ vue: v === 'table' ? 'table' : '' })}
        data={[
          { value: 'gantt', label: 'Gantt' },
          { value: 'table', label: 'Tableau' },
        ]}
      />
    </Group>
  );

  const subtitle = planVersion
    ? [
        `Plan connu au « ${planVersion.intitule} »`,
        // Toutes les versions de la timeline, y compris celles entièrement remplacées (fenêtre vide).
        plural(data?.windows.length ?? 0, 'version') +
          (replaced.length ? ` dont ${plural(replaced.length, 'remplacée')}` : ''),
        windows.length ? fmtRange(windows[0].debut, windows[windows.length - 1].fin) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  // ---------------------------------------------------------------- Contenu
  let body;
  if (timeline.isLoading) {
    body = <SkeletonRows rows={8} />;
  } else if (timeline.error) {
    body = <ErrorAlert error={timeline.error} title="Impossible de charger la timeline du plan" />;
  } else if (!data || !planVersion || data.windows.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={<IconImport size={40} />}
          title="Aucun plan de charge"
          action={
            <Button variant="primary" onClick={() => navigate('/plan/versions')}>
              Gérer les versions
            </Button>
          }
        >
          Importez un plan de charge : chaque version remplace les précédentes à partir de sa date d'effet.
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <Stack gap={12}>
        {!isLatest && (
          <Text size="sm" tone="secondary">
            Timeline telle qu'elle était connue à l'import de « {planVersion.intitule} » ({fmtDateTime(planVersion.importee_le)}).
          </Text>
        )}
        {view === 'gantt' ? (
          <Gantt
            groups={groups}
            windows={windows}
            windowsAll={windowsById}
            versionsById={versionsById}
            onOpenSegment={openSegment}
            onOpenVersion={openVersion}
          />
        ) : (
          <SegmentsTable groups={groups} windowsById={windowsById} onOpen={openSegment} />
        )}
        {segments.length === 0 && (
          <Card>
            <EmptyState title="Aucun segment">Aucune ligne du plan ne correspond aux filtres.</EmptyState>
          </Card>
        )}
        <Text size="sm" tone="secondary">
          {plural(nbRessources, 'ressource')} · {plural(segments.length, 'segment')}
          {replaced.length > 0 && (
            <>
              {' '}
              · Remplacée{replaced.length > 1 ? 's' : ''} sans période de référence :{' '}
              {replaced.map((w) => `« ${w.intitule} »`).join(', ')}
            </>
          )}
        </Text>
      </Stack>
    );
  }

  return (
    <Page
      wide
      toolbar={
        <PageToolbar
          back={{ to: '/plan', label: 'Plan de charge' }}
          title="Timeline du plan de charge"
          subtitle={subtitle}
          actions={
            <Button
              icon={<IconDownload size={15} />}
              disabled={!planVersion}
              onClick={() => download(analyseApi.planTimelineCsvUrl(params.plan || undefined))}
            >
              Exporter (CSV)
            </Button>
          }
          menu={[{ label: 'Gérer les versions…', onSelect: () => navigate('/plan/versions') }]}
          bottom={bottom}
        />
      }
    >
      {body}
    </Page>
  );
}

// ------------------------------------------------------------------ Gantt

interface GanttProps {
  groups: SquadGroup[];
  /** Fenêtres non vides, triées. */
  windows: TimelineWindow[];
  windowsAll: Map<string, TimelineWindow>;
  versionsById: Map<string, Version>;
  onOpenSegment: (s: TimelineSegment) => void;
  onOpenVersion: (versionId: string) => void;
}

function Gantt({ groups, windows, windowsAll, versionsById, onOpenSegment, onOpenVersion }: GanttProps) {
  const [ref, width] = useWidth<HTMLDivElement>();

  const scale = useMemo(() => {
    const dates = windows.flatMap((w) => [w.debut, w.fin]).sort();
    if (!dates.length) return null;
    const r0 = day(dates[0]).startOf('month');
    const r1 = day(dates[dates.length - 1]).endOf('month').startOf('day');
    const days = r1.diff(r0, 'day') + 1;
    const ppd = Math.max(MIN_PPD, (width - LABEL_W - 1) / days);
    const x = (iso: string | Dayjs) => (typeof iso === 'string' ? day(iso) : iso).diff(r0, 'day') * ppd;
    const w = (debut: string | Dayjs, fin: string | Dayjs) =>
      ((typeof fin === 'string' ? day(fin) : fin).diff(typeof debut === 'string' ? day(debut) : debut, 'day') + 1) * ppd;
    const months: { key: string; x: number; w: number; label: string; long: string }[] = [];
    for (let m = r0; !m.isAfter(r1); m = m.add(1, 'month')) {
      const end = m.endOf('month').startOf('day');
      const first = m.isSame(r0, 'month');
      months.push({
        key: m.format('YYYY-MM'),
        x: x(m),
        w: w(m, end),
        label: m.locale('fr').format(first || m.month() === 0 ? 'MMM YYYY' : 'MMM'),
        long: m.locale('fr').format('MMMM YYYY'),
      });
    }
    return { r0, r1, plotW: days * ppd, x, w, months, gaps: uncoveredIntervals(windows, r0, r1) };
  }, [windows, width]);

  const firstWindowId = windows[0]?.version_id;
  const bodyHeight = groups.reduce((h, g) => h + 28 + g.rows.reduce((s, r) => s + rowHeight(r.lanes), 0), 0);

  return (
    <Card padding={0} className="ptl">
      <div ref={ref} className="ptl__scroll">
        {scale && width > 0 && (
          <div className="ptl__grid" style={{ width: LABEL_W + scale.plotW } as CSSProperties}>
            {/* Axe des mois */}
            <div className="ptl__row ptl__row--axis">
              <div className="ptl__label ptl__label--head">Ressource</div>
              <div className="ptl__plot" style={{ width: scale.plotW }}>
                {scale.months.map((m) => (
                  <span
                    key={m.key}
                    className="ptl__month"
                    style={{ left: m.x, width: m.w }}
                    title={m.long}
                    data-compact={m.w < 56 || undefined}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Bande des versions : fenêtres de référence et périodes non couvertes */}
            <div className="ptl__row ptl__row--band">
              <div className="ptl__label ptl__label--head">Version en vigueur</div>
              <div className="ptl__plot" style={{ width: scale.plotW }}>
                {scale.gaps.map((g) => {
                  const gw = scale.w(g.debut, g.fin);
                  return (
                    <div
                      key={g.debut.format('YYYY-MM-DD')}
                      className="ptl__slot ptl__gap"
                      style={{ left: scale.x(g.debut), width: gw }}
                    >
                      <Tooltip
                        label={`${UNCOVERED} : ${fmtRange(g.debut.format('YYYY-MM-DD'), g.fin.format('YYYY-MM-DD'))}`}
                      >
                        <span className="ptl__gap-label" tabIndex={0}>
                          {labelIn(UNCOVERED, gw)}
                        </span>
                      </Tooltip>
                    </div>
                  );
                })}
                {windows.map((w) => {
                  const ww = scale.w(w.debut, w.fin);
                  const v = versionsById.get(w.version_id);
                  return (
                    <div key={w.version_id} className="ptl__slot" style={{ left: scale.x(w.debut), width: ww }}>
                      <Tooltip
                        maxWidth={300}
                        label={
                          <div className="ptl-tip">
                            <div className="ptl-tip__title">{w.intitule}</div>
                            <div>Date d'effet : {fmtDate(w.date_effet)}</div>
                            <div>En vigueur : {fmtRange(w.debut, w.fin)}</div>
                            <div>Statut : {STATUT_LABEL[w.statut]}</div>
                            {v && <div>Importée le {fmtDateTime(v.importee_le)}</div>}
                          </div>
                        }
                      >
                        <button
                          type="button"
                          className="ptl__window"
                          aria-label={`${w.intitule}, en vigueur ${fmtRange(w.debut, w.fin)} — ouvrir la version`}
                          onClick={() => onOpenVersion(w.version_id)}
                        >
                          {labelIn(w.intitule, ww)}
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Corps : fond (mois, non couvert, relèves de version) puis lignes */}
            <div className="ptl__body">
              <div className="ptl__backdrop" style={{ left: LABEL_W, width: scale.plotW, height: bodyHeight }} aria-hidden>
                {scale.months.slice(1).map((m) => (
                  <span key={m.key} className="ptl__gridline" style={{ left: m.x }} />
                ))}
                {scale.gaps.map((g) => (
                  <span
                    key={g.debut.format('YYYY-MM-DD')}
                    className="ptl__gap-fill"
                    style={{ left: scale.x(g.debut), width: scale.w(g.debut, g.fin) }}
                  />
                ))}
                {windows.slice(1).map((w) => (
                  <span key={w.version_id} className="ptl__boundary" style={{ left: scale.x(w.debut) }} />
                ))}
              </div>

              {groups.map((g) => (
                <div key={g.key} role="group" aria-label={g.label}>
                  <div className="ptl__row ptl__row--group">
                    <div className="ptl__label ptl__label--group" title={g.label}>
                      <span className="ptl__ellipsis">{g.label}</span>
                      <span className="ptl__count">{g.rows.length}</span>
                    </div>
                    <div className="ptl__plot" style={{ width: scale.plotW }} />
                  </div>
                  {g.rows.map((r) => (
                    <div key={r.key} className="ptl__row" style={{ height: rowHeight(r.lanes) }}>
                      <div className="ptl__label" data-nominative={r.nominative || undefined} title={r.ressource}>
                        <span className="ptl__ellipsis">{r.ressource}</span>
                        {r.otherSquads.length > 0 && (
                          <span className="ptl__more" title={`Segments aussi dans : ${r.otherSquads.join(', ')}`}>
                            {r.otherSquads.length > 1 ? `+${r.otherSquads.length} autres squads` : '+1 autre squad'}
                          </span>
                        )}
                      </div>
                      <div className="ptl__plot" style={{ width: scale.plotW }}>
                        {r.items.map(({ seg, lane }) => {
                          const bw = scale.w(seg.debut, seg.fin);
                          const win = windowsAll.get(seg.version_id);
                          const relief = !!win && win.version_id !== firstWindowId && win.debut === seg.debut;
                          return (
                            <div
                              key={`${seg.version_id}-${seg.line_id}`}
                              className="ptl__slot"
                              style={{ left: scale.x(seg.debut), width: bw, top: ROW_PAD + lane * (BAR_H + LANE_GAP) }}
                            >
                              <Tooltip
                                maxWidth={320}
                                label={<SegmentTip seg={seg} version={win?.intitule ?? versionsById.get(seg.version_id)?.intitule} />}
                              >
                                <button
                                  type="button"
                                  className="ptl__bar"
                                  data-relief={relief || undefined}
                                  data-inactive={seg.inactive || undefined}
                                  aria-label={`${seg.ressource} — ${seg.ct} ${seg.pourcentage} %, ${fmtRange(seg.debut, seg.fin)}`}
                                  onClick={() => onOpenSegment(seg)}
                                >
                                  {barLabelIn(seg, bw)}
                                </button>
                              </Tooltip>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="ptl__legend">
        <span className="ptl__legend-item">
          <span className="ptl__swatch" data-kind="bar" aria-hidden />
          Segment de plan (CT · %)
        </span>
        <span className="ptl__legend-item">
          <span className="ptl__swatch" data-kind="relief" aria-hidden />
          Reprise par une nouvelle version
        </span>
        <span className="ptl__legend-item">
          <span className="ptl__swatch" data-kind="gap" aria-hidden />
          {UNCOVERED}
        </span>
      </div>
    </Card>
  );
}

function SegmentTip({ seg, version }: { seg: TimelineSegment; version?: string }) {
  return (
    <div className="ptl-tip">
      <div className="ptl-tip__title">
        {seg.ct} · {fmtPct(seg.pourcentage)}
      </div>
      {seg.ct_libelle && <div className="ptl-tip__sub">{seg.ct_libelle}</div>}
      <div>{seg.ressource}</div>
      <div>Squad : {squadLabel(squadKey(seg))}</div>
      <div>Du {fmtDate(seg.debut)} au {fmtDate(seg.fin)}</div>
      <div>
        Charge {fmtHours(seg.charge)} · PPS {fmtEur(seg.pps)}
      </div>
      {version && <div className="ptl-tip__sub">Version : {version}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Vue tableau

function SegmentsTable({
  groups,
  windowsById,
  onOpen,
}: {
  groups: SquadGroup[];
  windowsById: Map<string, TimelineWindow>;
  onOpen: (s: TimelineSegment) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <Table hover minWidth={760} caption="Segments de la timeline du plan de charge">
      <thead>
        <tr>
          <th>Ressource</th>
          <th>CT</th>
          <th>Période</th>
          <th data-align="right">%</th>
          <th data-align="right">Charge</th>
          <th>Version</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => [
          <tr key={g.key} data-emphasis>
            <td colSpan={6}>{g.label}</td>
          </tr>,
          ...g.rows.flatMap((r) =>
            r.items.map(({ seg }) => (
              <tr key={`${seg.version_id}-${seg.line_id}`} data-clickable onClick={() => onOpen(seg)}>
                <td className="ptl-table__res" data-nominative={r.nominative || undefined}>
                  {seg.ressource}
                  {/* Une personne n'apparaît que sous la squad de son segment le plus récent. */}
                  {squadKey(seg) !== g.key && <span className="ptl-table__squad"> · {squadLabel(squadKey(seg))}</span>}
                </td>
                <td title={seg.ct_libelle}>
                  <Text as="span" mono>
                    {seg.ct}
                  </Text>
                </td>
                <td data-nowrap>{fmtRange(seg.debut, seg.fin)}</td>
                <td data-align="right">{fmtPct(seg.pourcentage)}</td>
                <td data-align="right">{fmtHours(seg.charge)}</td>
                <td className="ptl-table__version">{windowsById.get(seg.version_id)?.intitule ?? '—'}</td>
              </tr>
            )),
          ),
        ])}
      </tbody>
    </Table>
  );
}
