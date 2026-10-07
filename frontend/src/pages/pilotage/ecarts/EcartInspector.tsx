// Inspecteur de la page Écarts : un tuple ressource × CT × semaine, ou un regroupement ressource × CT.
// Erreur de CT (DECISIONS n° 14) : note « heures imputées ici au lieu de… » avec lien vers les CT liés.
import { Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Group,
  Inspector,
  InspectorSection,
  KeyValue,
  Link,
  Stack,
  StatusGlyph,
  Text,
  type GlyphKind,
  type KeyValueItem,
  type StatusTone,
} from '../../../ui';
import type { EcartRow, Flag } from '../../../api/types';
import { FLAG_META, FlagBadge, FlagGlyph } from '../../../components/badges';
import { fmtHours, fmtHoursSigned, fmtWeek } from '../../../lib/format';
import { ecartAnomalieLink } from '../anomalies/meta';
import { CONFIDENCE_LABEL, ecartTone, type RessourceRow } from './model';

function Ecart({ flag, value }: { flag: Flag; value: number }) {
  return (
    <Text as="span" tabular weight={flag === 'conforme' ? 400 : 600} tone={ecartTone(flag)}>
      {fmtHoursSigned(value)}
    </Text>
  );
}

function Note({ glyph = 'warning', tone = 'warning', children }: { glyph?: GlyphKind; tone?: StatusTone; children: ReactNode }) {
  return (
    <Group gap={6} wrap={false}>
      <StatusGlyph kind={glyph} tone={tone} size={12} />
      <Text size="sm" tone="secondary">
        {children}
      </Text>
    </Group>
  );
}

/** Identité de la ressource (« NOM Prénom ») et du CT, commune aux deux vues. */
function identity(e: EcartRow): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { label: 'Personne', value: e.ressource_label || e.ressource },
    { label: 'Squad', value: e.squad_nom || '—' },
    { label: 'Correspondance', value: CONFIDENCE_LABEL[e.confidence] },
    { label: 'CT', value: e.ct, mono: true },
  ];
  if (e.ct_libelle) items.push({ label: 'Libellé CT', value: e.ct_libelle });
  return items;
}

function Notes({ e }: { e: EcartRow }) {
  if (!e.inactive && !e.warn) return null;
  return (
    <Stack gap={4}>
      {e.inactive && <Note>Personne inactive dans le référentiel.</Note>}
      {e.warn && <Note>Ligne source signalée « warn » au parsing.</Note>}
    </Stack>
  );
}

// ------------------------------------------------------------------ Erreur de CT
/** Heures réaffectées d'un côté (CT imputé à tort ou CT planifié) et CT liés, dédoublonnés. */
interface Reaffectation {
  heures: number;
  cts: string[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Réaffectations des tuples, séparées par côté : `ici` = ce CT a été imputé à tort (prévu = 0),
 * `ailleurs` = ce CT était prévu et ses heures sont parties sur `cts`.
 */
function reaffectations(rows: EcartRow[]): { ici: Reaffectation; ailleurs: Reaffectation } {
  const ici = { heures: 0, cts: new Set<string>() };
  const ailleurs = { heures: 0, cts: new Set<string>() };
  for (const r of rows) {
    if (!(r.reaffecte > 0)) continue;
    const side = r.prevu === 0 ? ici : ailleurs;
    side.heures += r.reaffecte;
    for (const ct of r.cts_lies ?? []) side.cts.add(ct);
  }
  const out = (x: typeof ici): Reaffectation => ({ heures: round1(x.heures), cts: [...x.cts].sort() });
  return { ici: out(ici), ailleurs: out(ailleurs) };
}

/** CT imputés à tort qui portent l'anomalie « erreur_ct » (clé « ecart|<CT imputé à tort>|ressource|erreur_ct »). */
function erreurCtAnomalyCts(rows: EcartRow[]): string[] {
  const cts = new Set<string>();
  for (const r of rows) {
    if (r.flag !== 'erreur_ct') continue;
    if (r.prevu === 0) cts.add(r.ct);
    else for (const ct of r.cts_lies ?? []) cts.add(ct);
  }
  return [...cts].sort();
}

/** Liens « Voir l'anomalie » d'un flag ; pour l'erreur de CT, un par CT imputé à tort. */
function AnomalyLinks({ ct, ressource, flag, rows, suffix }: { ct: string; ressource: string; flag: Flag; rows: EcartRow[]; suffix?: boolean }) {
  const label = suffix ? `Voir l'anomalie · ${FLAG_META[flag].label}` : "Voir l'anomalie";
  if (flag !== 'erreur_ct') return <Link to={ecartAnomalieLink(ct, ressource, flag)}>{label}</Link>;
  const cts = erreurCtAnomalyCts(rows);
  return (
    <>
      {cts.map((c) => (
        <Link key={c} to={ecartAnomalieLink(c, ressource, flag)}>
          {cts.length > 1 ? `${label} (${c})` : label}
        </Link>
      ))}
    </>
  );
}

/** Lien vers la page Écarts filtrée sur un CT lié et la même ressource (vue et squad conservées). */
function useLinkedCtHref() {
  const [sp] = useSearchParams();
  return (ct: string, ressource: string) => {
    const n = new URLSearchParams(sp);
    // La recherche et le filtre de flag pourraient masquer le CT lié.
    n.delete('q');
    n.delete('flag');
    n.set('ct', ct);
    n.set('ressource', ressource);
    return `/ecarts?${n.toString()}`;
  };
}

/** « A », « A et B », « A, B et C » — chaque CT est un lien. */
function CtList({ cts, ressource }: { cts: string[]; ressource: string }) {
  const href = useLinkedCtHref();
  return (
    <>
      {cts.map((ct, i) => (
        <Fragment key={ct}>
          {i > 0 && (i === cts.length - 1 ? ' et ' : ', ')}
          <Link to={href(ct, ressource)} size="sm" mono title={`Voir les écarts de ${ct} pour cette personne`}>
            {ct}
          </Link>
        </Fragment>
      ))}
    </>
  );
}

/** Notes de réaffectation (erreur de CT, totale ou partielle) ; rien si aucune heure réaffectée. */
function ReaffectationNotes({ rows, ressource }: { rows: EcartRow[]; ressource: string }) {
  const { ici, ailleurs } = reaffectations(rows);
  if (!ici.heures && !ailleurs.heures) return null;
  return (
    <Stack gap={4}>
      {ici.heures > 0 && (
        <Note glyph="swap" tone="erreur_ct">
          {fmtHours(ici.heures)} imputées sur ce CT au lieu de{' '}
          {ici.cts.length ? <CtList cts={ici.cts} ressource={ressource} /> : 'un CT prévu'}.
        </Note>
      )}
      {ailleurs.heures > 0 && (
        <Note glyph="swap" tone="erreur_ct">
          {fmtHours(ailleurs.heures)} imputées sur{' '}
          {ailleurs.cts.length ? <CtList cts={ailleurs.cts} ressource={ressource} /> : 'un autre CT'} au lieu de ce CT.
        </Note>
      )}
    </Stack>
  );
}

/** Lien vers la ligne du plan dans la version qui régit la semaine (sinon la version de plan de l'analyse). */
const planLink = (fallbackPlanId: string | undefined, e: EcartRow, planId = e.plan_version_id ?? fallbackPlanId) =>
  planId
    ? `/plan/${planId}?${new URLSearchParams(
        // Ligne non nominative (sans fiche) : ressource = libellé → recherche plein-texte.
        e.personne_id ? { ct: e.ct, nom_prenom: e.ressource } : { ct: e.ct, q: e.ressource },
      ).toString()}`
    : null;

interface RowProps {
  row: EcartRow | null;
  planId?: string;
  onClose: () => void;
}

export function EcartRowInspector({ row, planId, onClose }: RowProps) {
  const plan = row && row.prevu > 0 ? planLink(planId, row) : null;
  return (
    <Inspector
      opened={!!row}
      onClose={onClose}
      title={row ? row.ressource_label || row.ressource : ''}
      subtitle={row ? `${row.ct} · ${fmtWeek(row.semaine)}` : undefined}
      accessory={row ? <FlagGlyph flag={row.flag} /> : undefined}
    >
      {row && (
        <Stack gap={16}>
          <FlagBadge flag={row.flag} />
          <KeyValue
            items={[
              { label: 'Prévu', value: fmtHours(row.prevu), numeric: true },
              { label: 'Réel', value: fmtHours(row.reel), numeric: true },
              { label: 'Écart', value: <Ecart flag={row.flag} value={row.ecart} />, numeric: true },
              { label: 'Semaine', value: fmtWeek(row.semaine) },
            ]}
          />
          <InspectorSection title="Ressource">
            <KeyValue items={identity(row)} />
          </InspectorSection>
          <ReaffectationNotes rows={[row]} ressource={row.ressource} />
          <Notes e={row} />
          <Stack gap={4} align="start">
            {row.flag !== 'conforme' && <AnomalyLinks ct={row.ct} ressource={row.ressource} flag={row.flag} rows={[row]} />}
            {plan && <Link to={plan}>Voir la ligne du plan</Link>}
          </Stack>
        </Stack>
      )}
    </Inspector>
  );
}

interface GroupProps {
  group: RessourceRow | null;
  planId?: string;
  onClose: () => void;
  /** Bascule sur la liste filtrée sur cette ressource et ce CT. */
  onShowWeeks: (g: RessourceRow) => void;
}

export function RessourceInspector({ group, planId, onClose, onShowWeeks }: GroupProps) {
  const flags = group ? [...new Set(group.rows.map((r) => r.flag))].filter((f) => f !== 'conforme') : [];
  // Semaines régies par plusieurs versions : la plus récente semaine prévue désigne la version à ouvrir.
  const planned = group ? [...group.rows].reverse().find((r) => r.prevu > 0) : undefined;
  const plan = group && planned ? planLink(planId, group.head, planned.plan_version_id ?? planId) : null;
  return (
    <Inspector
      opened={!!group}
      onClose={onClose}
      title={group ? group.head.ressource_label || group.head.ressource : ''}
      subtitle={group ? `${group.ct} · ${group.rows.length} semaine${group.rows.length > 1 ? 's' : ''}` : undefined}
      accessory={group ? <FlagGlyph flag={group.flag} /> : undefined}
    >
      {group && (
        <Stack gap={16}>
          <KeyValue
            items={[
              { label: 'Prévu', value: fmtHours(group.prevu), numeric: true },
              { label: 'Réel', value: fmtHours(group.reel), numeric: true },
              { label: 'Écart', value: <Ecart flag={group.flag} value={group.ecart} />, numeric: true },
            ]}
          />
          <InspectorSection title="Par semaine">
            <KeyValue
              items={group.rows.map((r) => ({
                label: (
                  <Group gap={6} wrap={false}>
                    <FlagGlyph flag={r.flag} size={12} />
                    {fmtWeek(r.semaine)}
                  </Group>
                ),
                value: <Ecart flag={r.flag} value={r.ecart} />,
                numeric: true,
              }))}
            />
          </InspectorSection>
          <InspectorSection title="Ressource">
            <KeyValue items={identity(group.head)} />
          </InspectorSection>
          <ReaffectationNotes rows={group.rows} ressource={group.head.ressource} />
          <Notes e={group.head} />
          <Stack gap={4} align="start">
            <Link onClick={() => onShowWeeks(group)}>Voir les semaines dans la liste</Link>
            {flags.map((f) => (
              <AnomalyLinks key={f} ct={group.ct} ressource={group.head.ressource} flag={f} rows={group.rows} suffix />
            ))}
            {plan && <Link to={plan}>Voir la ligne du plan</Link>}
          </Stack>
        </Stack>
      )}
    </Inspector>
  );
}
