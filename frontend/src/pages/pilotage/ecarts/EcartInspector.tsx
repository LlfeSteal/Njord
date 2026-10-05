// Inspecteur de la page Écarts : un tuple ressource × CT × semaine, ou un regroupement ressource × CT.
import type { ReactNode } from 'react';
import { Group, Inspector, InspectorSection, KeyValue, Link, Stack, StatusGlyph, Text, type KeyValueItem } from '../../../ui';
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

function Note({ children }: { children: ReactNode }) {
  return (
    <Group gap={6} wrap={false}>
      <StatusGlyph kind="warning" tone="warning" size={12} />
      <Text size="sm" tone="secondary">
        {children}
      </Text>
    </Group>
  );
}

/** Identité de la ressource et du CT, commune aux deux vues. */
function identity(e: EcartRow): KeyValueItem[] {
  const items: KeyValueItem[] = [{ label: 'Personne', value: e.ressource_label || e.ressource }];
  if (e.ressource_label && e.ressource_label !== e.ressource) items.push({ label: 'Code ressource', value: e.ressource, mono: true });
  items.push(
    { label: 'Squad', value: e.squad_nom || '—' },
    { label: 'Correspondance', value: CONFIDENCE_LABEL[e.confidence] },
    { label: 'CT', value: e.ct, mono: true },
  );
  if (e.ct_libelle) items.push({ label: 'Libellé CT', value: e.ct_libelle });
  return items;
}

function Notes({ e }: { e: EcartRow }) {
  if (!e.inactive && !e.warn && e.confidence !== 'fuzzy') return null;
  return (
    <Stack gap={4}>
      {e.inactive && <Note>Personne inactive dans le référentiel.</Note>}
      {e.confidence === 'fuzzy' && <Note>Correspondance approximative du nom : à confirmer dans Anomalies.</Note>}
      {e.warn && <Note>Ligne source signalée « warn » au parsing.</Note>}
    </Stack>
  );
}

const planLink = (planId: string | undefined, e: EcartRow) =>
  planId ? `/plan/${planId}?${new URLSearchParams({ ct: e.ct, ressource: e.ressource }).toString()}` : null;

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
          <Notes e={row} />
          <Stack gap={4} align="start">
            {row.flag !== 'conforme' && <Link to={ecartAnomalieLink(row.ct, row.ressource, row.flag)}>Voir l'anomalie</Link>}
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
  const plan = group && group.prevu > 0 ? planLink(planId, group.head) : null;
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
          <Notes e={group.head} />
          <Stack gap={4} align="start">
            <Link onClick={() => onShowWeeks(group)}>Voir les semaines dans la liste</Link>
            {flags.map((f) => (
              <Link key={f} to={ecartAnomalieLink(group.ct, group.head.ressource, f)}>
                Voir l'anomalie · {FLAG_META[f].label}
              </Link>
            ))}
            {plan && <Link to={plan}>Voir la ligne du plan</Link>}
          </Stack>
        </Stack>
      )}
    </Inspector>
  );
}
