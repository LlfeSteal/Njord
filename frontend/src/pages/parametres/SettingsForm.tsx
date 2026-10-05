// Formulaire des paramètres métier (GET/PUT /settings) — état React simple, sans bibliothèque de formulaire.
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import type { Settings } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import {
  Banner,
  Button,
  Card,
  Grid,
  Group,
  LoadingBlock,
  Menu,
  NumberInput,
  Stack,
  Tag,
  TagsInput,
  Text,
  Title,
  toast,
} from '../../ui';
import { IconChevronDown, IconSave, IconUndo } from '../../ui/Icons';
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
      { key: 'seuil_sur_imputation_h', label: 'Sur-imputation', unit: 'h', min: 0, description: 'Flag « sur-imputation » si écart > +seuil' },
      { key: 'seuil_sous_imputation_h', label: 'Sous-imputation', unit: 'h', min: 0, description: 'Flag « sous-imputation » si écart < −seuil' },
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
    <Card as="section" aria-label={title}>
      <Title order={3}>{title}</Title>
      {description && (
        <Text size="sm" tone="secondary" mt={2}>
          {description}
        </Text>
      )}
      <Stack gap={12} mt={12}>
        {children}
      </Stack>
    </Card>
  );
}

/**
 * Liste de types TYPE : saisie libre (TagsInput) + menu des types connus en suggestion
 * (coche = présent dans la liste ; cliquer bascule l'appartenance).
 */
function TypeListInput({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const known = TYPE_SUGGESTIONS.filter((t) => !value.includes(t)).length;
  return (
    <Stack gap={4}>
      <TagsInput label={label} description={description} value={value} onChange={onChange} />
      <Group gap={4}>
        <Menu
          width={290}
          target={(p) => (
            <Button {...p} size="sm" variant="plain" iconRight={<IconChevronDown size={12} />}>
              Types connus{known ? ` (${known} disponibles)` : ''}
            </Button>
          )}
          items={[
            { type: 'header', label: 'Types connus' },
            ...TYPE_SUGGESTIONS.map((t) => ({
              label: t,
              checked: value.includes(t),
              onSelect: () => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]),
            })),
          ]}
        />
        {value.length > 0 && (
          <Button size="sm" variant="plain" destructive onClick={() => onChange([])}>
            Vider
          </Button>
        )}
      </Group>
    </Stack>
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
      toast({ tone: 'success', title: 'Paramètres enregistrés', message: "L'analyse sera recalculée avec ces valeurs." });
    },
    onError: (e) => {
      toast({ tone: 'error', title: "Échec de l'enregistrement", message: e instanceof Error ? e.message : String(e) });
    },
  });

  if (settingsQ.isLoading) return <LoadingBlock />;
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
    // noValidate : la validation est faite ici (fieldError), pas par le navigateur (pas de blocage sur `step`).
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !invalid) save.mutate(current);
      }}
    >
      <Stack gap={12}>
        <Grid cols={{ base: 1, md: 2 }} gap={12}>
          {SECTIONS.map((s) => (
            <SectionCard key={s.title} title={s.title} description={s.description}>
              {s.fields.map((f) => {
                const v = current[f.key];
                return (
                  <NumberInput
                    key={f.key}
                    label={f.label}
                    description={f.description}
                    suffix={f.unit}
                    value={Number.isNaN(v) ? null : v}
                    onChange={(x) => set(f.key, x ?? NaN)}
                    error={fieldError(f, v)}
                    min={f.minExclusive ? undefined : f.min}
                    max={f.max}
                    step={f.integer ? 1 : undefined}
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
            />
            <HolidaysEditor value={current.jours_feries} onChange={(v) => set('jours_feries', v)} />
          </SectionCard>

          <SectionCard
            title="Classification"
            description="Valeurs du champ TYPE du réalisé. Les suggestions reprennent les types connus ; toute autre valeur peut être saisie."
          >
            <TypeListInput
              label="Types main d'œuvre (heures)"
              description="QUANTITE comptée en heures si TYPE ∈ liste et CATEGORIE = MAIN D'OEUVRE"
              value={current.mo_types}
              onChange={(v) => set('mo_types', dedupe(v))}
            />
            <TypeListInput label="Types sécurisés" value={current.securise} onChange={(v) => set('securise', dedupe(v))} />
            <TypeListInput label="Types non sécurisés" value={current.non_securise} onChange={(v) => set('non_securise', dedupe(v))} />
            {overlap.length > 0 && (
              <Banner tone="warning" compact>
                Présent dans les deux listes : {overlap.join(', ')}
              </Banner>
            )}
          </SectionCard>
        </Grid>

        {/* Barre d'action collante en bas */}
        <Card
          padding={12}
          role="region"
          aria-label="Enregistrement des paramètres"
          style={{ position: 'sticky', bottom: 0, zIndex: 5 }}
        >
          <Group justify="between" gap={8}>
            <Group gap={12}>
              {dirty ? (
                <Tag tone="warning">Modifications non enregistrées</Tag>
              ) : (
                <Text tone="secondary">Aucune modification</Text>
              )}
              {invalid && (
                <Text tone="danger">
                  {errors.length} champ{errors.length > 1 ? 's' : ''} invalide{errors.length > 1 ? 's' : ''}
                </Text>
              )}
            </Group>
            <Group gap={8}>
              <Button
                icon={<IconUndo size={15} />}
                disabled={!draft || save.isPending}
                onClick={() => {
                  setDraft(null);
                  setWeekError(null);
                }}
              >
                Réinitialiser les modifications
              </Button>
              <Button type="submit" variant="primary" icon={<IconSave size={15} />} disabled={!dirty || invalid} loading={save.isPending}>
                Enregistrer
              </Button>
            </Group>
          </Group>
        </Card>
      </Stack>
    </form>
  );
}
