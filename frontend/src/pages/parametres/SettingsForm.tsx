// Formulaire des paramètres métier (GET/PUT /settings) — état React simple (pas de @mantine/form).
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconDeviceFloppy } from '@tabler/icons-react';
import { settingsApi } from '../../api/client';
import type { Settings } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { qk } from '../../lib/queryKeys';
import HolidaysEditor from './HolidaysEditor';

type NumKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

interface NumField {
  key: NumKey;
  label: string;
  description: string;
  unit?: string;
  min: number;
  /** min exclusif (ex. diviseur > 0). */
  minExclusive?: boolean;
  max?: number;
  integer?: boolean;
}

interface Section {
  title: string;
  description?: string;
  fields: NumField[];
}

const SECTIONS: Section[] = [
  {
    title: "Seuils d'écart",
    description: 'Écart = heures réelles − heures prévues, par ressource × CT × semaine.',
    fields: [
      { key: 'seuil_sur_imputation_h', label: 'Sur-imputation', unit: 'h', min: 0, description: 'FLAG 🔴 si écart > +seuil' },
      { key: 'seuil_sous_imputation_h', label: 'Sous-imputation', unit: 'h', min: 0, description: 'FLAG 🟣 si écart < −seuil' },
      {
        key: 'diviseur_hors_plan_h',
        label: 'Diviseur hors plan',
        unit: 'h',
        min: 0,
        minExclusive: true,
        description: 'Points hors plan = ⌊Σ heures hors plan ÷ diviseur⌋',
      },
    ],
  },
  {
    title: 'Budget & alertes',
    fields: [
      { key: 'seuil_ct_risque_eur', label: 'CT à risque', unit: '€', min: 0, description: 'CT à risque si Σ € non sécurisé > seuil' },
      {
        key: 'seuil_non_securise_pct',
        label: 'Part non sécurisée',
        unit: '%',
        min: 0,
        max: 100,
        description: 'Alerte globale si % non sécurisé > seuil',
      },
      { key: 'seuil_ecart_tg_eur', label: 'Écart par TG', unit: '€', min: 0, description: 'Contrôle qualité : |Σ € réalisé − Σ PPS plan| par TG' },
    ],
  },
  {
    title: 'Contrôles qualité',
    fields: [
      {
        key: 'seuil_quantite_semaine_h',
        label: 'Quantité MO par semaine',
        unit: 'h',
        min: 0,
        description: 'Warn si une ligne MO dépasse ce volume sur une semaine',
      },
      {
        key: 'seuil_fuzzy_count',
        label: 'Correspondances approximatives',
        unit: 'nb',
        min: 0,
        integer: true,
        description: 'Warn global au-delà de ce nombre de correspondances fuzzy',
      },
    ],
  },
  {
    title: 'Cycle de vie',
    fields: [
      {
        key: 'purge_delai_jours',
        label: 'Délai avant purge',
        unit: 'jours',
        min: 0,
        integer: true,
        description: "Une version archivée n'est purgeable qu'après ce délai",
      },
    ],
  },
];

/** Valeurs de TYPE connues (SPEC_realise §3 + défauts métier), proposées en suggestion. */
const TYPE_SUGGESTIONS = [
  "MAIN D'OEUVRE SUR SITE",
  'CAPACITE SUR SITE',
  'FRAIS ACHATS CAPACITE SUR SITE',
  'FRAIS DE MISSION',
  'FRAIS ACHATS MATIERE',
  'FRAIS ACHATS PRESTATIONS',
  'AUTRES PRESTATIONS',
  'IMMOBILISATIONS',
  'NON STOCKABLE',
  'MATIERE',
  'PRESTATION',
  'FNP AUTOMATIQUES',
  'FNP MANUELLES',
  'OD PRESTATION',
  'OD AUTRES DEPENSES',
  'OD FRAIS DE MISSION',
  'PROVISIONS POUR ALEAS',
  'Stockage',
];

function fieldError(f: NumField, v: number): string | undefined {
  if (typeof v !== 'number' || Number.isNaN(v)) return 'Valeur requise';
  if (f.minExclusive ? v <= f.min : v < f.min) return f.minExclusive ? `Doit être > ${f.min}` : `Doit être ≥ ${f.min}`;
  if (f.max !== undefined && v > f.max) return `Doit être ≤ ${f.max}`;
  if (f.integer && !Number.isInteger(v)) return 'Nombre entier attendu';
  return undefined;
}

const dedupe = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="sm" component="section" aria-label={title}>
      <Title order={5}>{title}</Title>
      {description && (
        <Text size="xs" c="dimmed" mt={2}>
          {description}
        </Text>
      )}
      <Stack gap="sm" mt="sm">
        {children}
      </Stack>
    </Paper>
  );
}

export default function SettingsForm() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: qk.settings(), queryFn: settingsApi.get });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);

  const saved = settingsQ.data;
  const current = draft ?? saved;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const save = useMutation({
    mutationFn: (s: Settings) => settingsApi.put(s),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings(), s);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['analyse'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      setDraft(null);
      setWeekError(null);
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Paramètres enregistrés', message: "L'analyse sera recalculée avec ces valeurs." });
    },
    onError: (e) => {
      notifications.show({ color: 'red', title: "Échec de l'enregistrement", message: e instanceof Error ? e.message : String(e) });
    },
  });

  if (settingsQ.isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }
  if (settingsQ.error || !current) {
    return <ErrorAlert error={settingsQ.error ?? new Error('Paramètres indisponibles')} title="Impossible de charger les paramètres" />;
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...current, [key]: value });

  const errors = SECTIONS.flatMap((s) => s.fields)
    .map((f) => fieldError(f, current[f.key]))
    .filter(Boolean);
  const invalid = errors.length > 0;

  const overlap = current.securise.filter((t) => current.non_securise.includes(t));

  const onWeeksChange = (vals: string[]) => {
    const bad = vals.filter((v) => !/^\d{1,2}$/.test(v.trim()) || Number(v) < 1 || Number(v) > 53);
    setWeekError(bad.length ? `Semaine ISO invalide : ${bad.join(', ')} (1 à 53 attendu)` : null);
    const weeks = Array.from(new Set(vals.filter((v) => !bad.includes(v)).map((v) => Number(v.trim())))).sort((a, b) => a - b);
    set('semaines_verrouillees', weeks);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !invalid) save.mutate(current);
      }}
    >
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {SECTIONS.map((s) => (
            <SectionCard key={s.title} title={s.title} description={s.description}>
              {s.fields.map((f) => {
                const v = current[f.key];
                return (
                  <NumberInput
                    key={f.key}
                    label={f.unit ? `${f.label} (${f.unit})` : f.label}
                    description={f.description}
                    value={Number.isNaN(v) ? '' : v}
                    onChange={(x) => set(f.key, typeof x === 'number' ? x : x === '' ? NaN : Number(String(x).replace(',', '.')))}
                    error={fieldError(f, v)}
                    min={f.minExclusive ? undefined : f.min}
                    max={f.max}
                    allowDecimal={!f.integer}
                    decimalSeparator=","
                    thousandSeparator=" "
                    allowNegative={false}
                    required
                  />
                );
              })}
            </SectionCard>
          ))}

          <SectionCard title="Calendrier" description="Utilisé pour répartir la charge du plan par semaine ISO (jours ouvrés).">
            <TagsInput
              label="Semaines ISO verrouillées"
              description="Aucune charge prévue ; tout réalisé imputé dessus est « hors plan ». Saisir un numéro (1 à 53) puis Entrée."
              placeholder="ex. 51"
              value={current.semaines_verrouillees.map(String)}
              onChange={onWeeksChange}
              splitChars={[',', ' ', ';']}
              error={weekError}
              clearable
            />
            <HolidaysEditor value={current.jours_feries} onChange={(v) => set('jours_feries', v)} />
          </SectionCard>

          <SectionCard
            title="Classification"
            description="Valeurs du champ TYPE du réalisé. Les suggestions reprennent les types connus ; toute autre valeur peut être saisie."
          >
            <TagsInput
              label="Types main d'œuvre (heures)"
              description="QUANTITE comptée en heures si TYPE ∈ liste et CATEGORIE = MAIN D'OEUVRE"
              data={TYPE_SUGGESTIONS}
              value={current.mo_types}
              onChange={(v) => set('mo_types', dedupe(v))}
              clearable
            />
            <TagsInput
              label="Types sécurisés"
              data={TYPE_SUGGESTIONS}
              value={current.securise}
              onChange={(v) => set('securise', dedupe(v))}
              clearable
            />
            <TagsInput
              label="Types non sécurisés"
              data={TYPE_SUGGESTIONS}
              value={current.non_securise}
              onChange={(v) => set('non_securise', dedupe(v))}
              clearable
            />
            {overlap.length > 0 && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} p="xs">
                Présent dans les deux listes : {overlap.join(', ')}
              </Alert>
            )}
          </SectionCard>
        </SimpleGrid>

        <Paper
          withBorder
          shadow="sm"
          p="sm"
          radius="sm"
          style={{ position: 'sticky', bottom: 0, zIndex: 5 }}
          role="region"
          aria-label="Enregistrement des paramètres"
        >
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Group gap="xs">
              {dirty ? (
                <Badge color="orange" variant="light">
                  Modifications non enregistrées
                </Badge>
              ) : (
                <Text size="sm" c="dimmed">
                  Aucune modification
                </Text>
              )}
              {invalid && (
                <Text size="sm" c="red">
                  {errors.length} champ{errors.length > 1 ? 's' : ''} invalide{errors.length > 1 ? 's' : ''}
                </Text>
              )}
            </Group>
            <Group gap="xs">
              <Button
                variant="default"
                leftSection={<IconArrowBackUp size={16} />}
                disabled={!draft || save.isPending}
                onClick={() => {
                  setDraft(null);
                  setWeekError(null);
                }}
              >
                Réinitialiser les modifications
              </Button>
              <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} disabled={!dirty || invalid} loading={save.isPending}>
                Enregistrer
              </Button>
            </Group>
          </Group>
        </Paper>
      </Stack>
    </form>
  );
}
