// Éditeur des jours fériés (liste de dates YYYY-MM-DD), regroupés par année.
import { useState } from 'react';
import { Accordion, Badge, Button, Group, Input, TagsInput, Text } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';

/** Date calendaire valide au format YYYY-MM-DD. */
function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const normalize = (xs: string[]) => Array.from(new Set(xs)).sort();

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });

export default function HolidaysEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const currentYear = String(new Date().getFullYear());

  const byYear = new Map<string, string[]>();
  for (const d of normalize(value)) {
    const y = d.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), d]);
  }
  const years = Array.from(byYear.keys()).sort();

  /** Valide les saisies ; conserve les dates valides, signale les autres. */
  const accept = (vals: string[]) => {
    const trimmed = vals.map((v) => v.trim()).filter(Boolean);
    const bad = trimmed.filter((v) => !isIsoDate(v));
    setError(bad.length ? `Date invalide : ${bad.join(', ')} (format AAAA-MM-JJ attendu)` : null);
    return trimmed.filter((v) => isIsoDate(v));
  };

  const replaceYear = (year: string, vals: string[]) => {
    const others = value.filter((d) => !d.startsWith(year + '-'));
    onChange(normalize([...others, ...accept(vals)]));
  };

  return (
    <Input.Wrapper
      label="Jours fériés"
      description="Exclus des jours ouvrés. Saisir des dates AAAA-MM-JJ (Entrée ou virgule pour valider)."
      error={error}
    >
      <TagsInput
        mt={6}
        aria-label="Ajouter des jours fériés"
        placeholder="Ajouter, ex. 2027-05-01"
        value={[]}
        onChange={(vals) => onChange(normalize([...value, ...accept(vals)]))}
        splitChars={[',', ' ', ';']}
      />
      {years.length === 0 ? (
        <Text size="sm" c="dimmed" mt="xs">
          Aucun jour férié défini.
        </Text>
      ) : (
        <Accordion multiple variant="contained" mt="xs" defaultValue={byYear.has(currentYear) ? [currentYear] : []}>
          {years.map((y) => {
            const dates = byYear.get(y) ?? [];
            const weekend = dates.filter((d) => {
              const wd = new Date(d + 'T00:00:00Z').getUTCDay();
              return wd === 0 || wd === 6;
            });
            return (
              <Accordion.Item key={y} value={y}>
                <Accordion.Control>
                  <Group gap="xs">
                    <Text fw={500}>{y}</Text>
                    <Badge variant="light" size="sm">
                      {dates.length} jour{dates.length > 1 ? 's' : ''}
                    </Badge>
                    {weekend.length > 0 && (
                      <Text size="xs" c="dimmed">
                        dont {weekend.length} le week-end
                      </Text>
                    )}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <TagsInput
                    aria-label={`Jours fériés ${y}`}
                    value={dates}
                    onChange={(vals) => replaceYear(y, vals)}
                    splitChars={[',', ' ', ';']}
                  />
                  <Group justify="space-between" mt={6}>
                    <Text size="xs" c="dimmed">
                      {dates.map((d) => `${WEEKDAY.format(new Date(d + 'T00:00:00Z'))} ${d.slice(8, 10)}/${d.slice(5, 7)}`).join(' · ')}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => replaceYear(y, [])}
                    >
                      Retirer l'année {y}
                    </Button>
                  </Group>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
    </Input.Wrapper>
  );
}
