// Petits composants partagés de la page Enveloppes.
import { Pill } from '../../ui';
import type { EnveloppeSources } from '../../api/types';

const SOURCES: { key: keyof EnveloppeSources; label: string; title: string }[] = [
  { key: 'plan', label: 'Plan', title: 'Présent au plan de charge' },
  { key: 'realise', label: 'Réalisé', title: 'Présent au réalisé actif' },
  { key: 'provisions', label: 'Provisions', title: 'Présent aux provisions actives' },
];

/** Imports où le CT apparaît : pastilles neutres (pas un statut), seules les sources présentes. */
export function SourcePills({ sources }: { sources: EnveloppeSources }) {
  const present = SOURCES.filter((s) => sources[s.key]);
  if (present.length === 0)
    return (
      <span className="env-muted" title="Le CT n'apparaît plus dans aucun import">
        aucune
      </span>
    );
  return (
    <span className="env-sources">
      {present.map((s) => (
        <Pill key={s.key} title={s.title}>
          {s.label}
        </Pill>
      ))}
    </span>
  );
}
