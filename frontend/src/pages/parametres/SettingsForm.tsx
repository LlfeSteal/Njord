// Paramètres métier (GET/PUT /settings), façon Réglages macOS : listes groupées, une colonne de 720 px.
// État React simple, sans bibliothèque de formulaire ; barre d'enregistrement visible seulement si modifié.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api/client';
import type { Settings } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import {
  Banner,
  Button,
  DateInput,
  GroupedList,
  ListRow,
  LoadingBlock,
  Menu,
  Modal,
  NumberInput,
  Page,
  Stack,
  TagsInput,
  Text,
  toast,
} from '../../ui';
import { IconChevronDown } from '../../ui/Icons';
import { qk } from '../../lib/queryKeys';
import HolidaysEditor from './HolidaysEditor';
import ReglagesToolbar from './ReglagesToolbar';
import './reglages.css';

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
  /** Ligne « Fin d'exercice » (date) avant les champs numériques. */
  finExercice?: boolean;
  fields: NumField[];
}

const SECTIONS: Section[] = [
  {
    title: "Seuils d'écart",
    description: 'Écart = heures réelles − heures prévues, par ressource × CT × semaine.',
    fields: [
      {
        key: 'seuil_sur_imputation_h',
        label: 'Sur-imputation',
        unit: 'h',
        min: 0,
        description: 'Flag « sur-imputation » si écart > +seuil',
      },
      {
        key: 'seuil_sous_imputation_h',
        label: 'Sous-imputation',
        unit: 'h',
        min: 0,
        description: 'Flag « sous-imputation » si écart < −seuil',
      },
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
      {
        key: 'seuil_ct_risque_eur',
        label: 'CT à risque',
        unit: '€',
        min: 0,
        description: 'CT à risque si Σ € non sécurisé > seuil',
      },
      {
        key: 'seuil_non_securise_pct',
        label: 'Part non sécurisée',
        unit: '%',
        min: 0,
        max: 100,
        description: 'Alerte globale si % non sécurisé > seuil',
      },
      {
        key: 'seuil_ecart_tg_eur',
        label: 'Écart par TG',
        unit: '€',
        min: 0,
        description: 'Contrôle qualité : |Σ € réalisé − charge max (PPS + provisions)| par TG',
      },
    ],
  },
  {
    title: "Fin d'exercice",
    description:
      "Le budget non consommé à la fin de l'exercice est perdu. Sous-consommation si le non consommé prévu dépasse les deux seuils.",
    finExercice: true,
    fields: [
      {
        key: 'seuil_sous_conso_pct',
        label: 'Seuil sous-consommation (%)',
        unit: '%',
        min: 0,
        max: 100,
        description: "Non consommé > seuil % du budget de l'exercice",
      },
      {
        key: 'seuil_sous_conso_eur',
        label: 'Seuil sous-consommation (€)',
        unit: '€',
        min: 0,
        description: 'et non consommé > seuil en €',
      },
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

/** Résumé d'une liste pour la ligne : « 2 semaines : S51, S52 » (tronqué au-delà de `max` éléments). */
function summarize(items: string[], unit: [string, string], empty: string, max = 4): string {
  if (items.length === 0) return empty;
  const head = items.slice(0, max).join(', ') + (items.length > max ? '…' : '');
  return `${items.length} ${items.length > 1 ? unit[1] : unit[0]} : ${head}`;
}

/** Résumé des jours fériés : nombre et années couvertes. */
function holidaysSummary(dates: string[]): string {
  if (dates.length === 0) return 'Aucun';
  const years = Array.from(new Set(dates.map((d) => d.slice(0, 4)))).sort();
  return `${dates.length} jour${dates.length > 1 ? 's' : ''} · ${years.join(', ')}`;
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
      <TagsInput aria-label={label} description={description} value={value} onChange={onChange} />
      <div className="reglages-inline">
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
      </div>
    </Stack>
  );
}

const FORM_ID = 'reglages-form';

/** Valeurs par défaut des réglages de fin d'exercice (DECISIONS n° 17), si le backend ne les renvoie pas encore. */
const FIN_EXERCICE_DEFAULTS: Pick<Settings, 'fin_exercice' | 'seuil_sous_conso_pct' | 'seuil_sous_conso_eur'> = {
  fin_exercice: '',
  seuil_sous_conso_pct: 10,
  seuil_sous_conso_eur: 5000,
};

/** '' ou une date ISO valide. */
const finExerciceError = (v: string) => (v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'Date invalide (AAAA-MM-JJ)' : undefined);

/** Éditeurs de liste ouverts en fenêtre depuis leur ligne. */
type ListEditor = 'weeks' | 'holidays' | 'mo_types' | 'securise' | 'non_securise';

const TYPE_LISTS: { key: 'mo_types' | 'securise' | 'non_securise'; label: string; description?: string }[] = [
  {
    key: 'mo_types',
    label: "Types main d'œuvre (heures)",
    description: "QUANTITE comptée en heures si TYPE ∈ liste et CATEGORIE = MAIN D'OEUVRE",
  },
  { key: 'securise', label: 'Types sécurisés' },
  { key: 'non_securise', label: 'Types non sécurisés' },
];

const EDITOR_TITLE: Record<ListEditor, string> = {
  weeks: 'Semaines ISO verrouillées',
  holidays: 'Jours fériés',
  mo_types: "Types main d'œuvre (heures)",
  securise: 'Types sécurisés',
  non_securise: 'Types non sécurisés',
};

/** Ligne de réglage dont la description cède la place à l'erreur de validation. */
function rowDescription(description: string | undefined, error: string | null | undefined) {
  if (!error) return description;
  return (
    <Text as="span" size="sm" tone="danger">
      {error}
    </Text>
  );
}

export default function SettingsForm() {
  const qc = useQueryClient();
  const settingsQ = useQuery({ queryKey: qk.settings(), queryFn: settingsApi.get });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [editor, setEditor] = useState<ListEditor | null>(null);

  const saved = settingsQ.data ? { ...FIN_EXERCICE_DEFAULTS, ...settingsQ.data } : undefined;
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

  const toolbar = <ReglagesToolbar />;

  if (settingsQ.isLoading)
    return (
      <Page toolbar={toolbar}>
        <LoadingBlock />
      </Page>
    );
  if (settingsQ.error || !current) {
    return (
      <Page toolbar={toolbar}>
        <ErrorAlert
          error={settingsQ.error ?? new Error('Paramètres indisponibles')}
          title="Impossible de charger les paramètres"
        />
      </Page>
    );
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...current, [key]: value });

  const errors = [
    ...SECTIONS.flatMap((s) => s.fields).map((f) => fieldError(f, current[f.key])),
    finExerciceError(current.fin_exercice ?? ''),
  ].filter(Boolean);
  const invalid = errors.length > 0;

  const overlap = current.securise.filter((t) => current.non_securise.includes(t));

  const onWeeksChange = (vals: string[]) => {
    const bad = vals.filter((v) => !/^\d{1,2}$/.test(v.trim()) || Number(v) < 1 || Number(v) > 53);
    setWeekError(bad.length ? `Semaine ISO invalide : ${bad.join(', ')} (1 à 53 attendu)` : null);
    const weeks = Array.from(new Set(vals.filter((v) => !bad.includes(v)).map((v) => Number(v.trim())))).sort((a, b) => a - b);
    set('semaines_verrouillees', weeks);
  };

  const reset = () => {
    setDraft(null);
    setWeekError(null);
  };

  return (
    <Page toolbar={toolbar}>
      <div className="reglages-form">
        {/* noValidate : la validation est faite ici (fieldError), pas par le navigateur (pas de blocage sur `step`).
            Le formulaire ne contient que les champs (Entrée enregistre) ; les lignes de liste restent hors formulaire. */}
        <form
          id={FORM_ID}
          noValidate
          className="reglages-fields"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !invalid) save.mutate(current);
          }}
        >
          {SECTIONS.map((s) => (
            <GroupedList key={s.title} title={s.title} footer={s.description}>
              {s.finExercice && (
                <ListRow
                  label="Fin d’exercice"
                  htmlFor="reglage-fin_exercice"
                  description={rowDescription(
                    current.fin_exercice ? 'Budget non consommé à cette date perdu' : 'Vide : 31/12 de l’année des données (automatique)',
                    finExerciceError(current.fin_exercice ?? ''),
                  )}
                  control={
                    <DateInput
                      id="reglage-fin_exercice"
                      aria-label="Fin d’exercice"
                      value={current.fin_exercice ?? ''}
                      onChange={(v) => set('fin_exercice', v)}
                      clearable
                      width={160}
                    />
                  }
                />
              )}
              {s.fields.map((f) => {
                const v = current[f.key];
                const id = `reglage-${f.key}`;
                return (
                  <ListRow
                    key={f.key}
                    label={f.label}
                    htmlFor={id}
                    description={rowDescription(f.description, fieldError(f, v))}
                    control={
                      <NumberInput
                        id={id}
                        width={140}
                        suffix={f.unit}
                        value={Number.isNaN(v) ? null : v}
                        onChange={(x) => set(f.key, x ?? NaN)}
                        min={f.minExclusive ? undefined : f.min}
                        max={f.max}
                        step={f.integer ? 1 : undefined}
                        required
                      />
                    }
                  />
                );
              })}
            </GroupedList>
          ))}
        </form>

        <GroupedList title="Calendrier" footer="Utilisé pour répartir la charge du plan par semaine ISO (jours ouvrés).">
          <ListRow
            label="Semaines ISO verrouillées"
            description={rowDescription('Aucune charge prévue ; tout réalisé imputé dessus est « hors plan »', weekError)}
            value={
              <span className="reglages-summary">
                {summarize(
                  current.semaines_verrouillees.map((w) => `S${w}`),
                  ['semaine', 'semaines'],
                  'Aucune',
                )}
              </span>
            }
            onClick={() => setEditor('weeks')}
          />
          <ListRow
            label="Jours fériés"
            description="Exclus des jours ouvrés"
            value={<span className="reglages-summary">{holidaysSummary(current.jours_feries)}</span>}
            onClick={() => setEditor('holidays')}
          />
        </GroupedList>

        <Stack gap={8}>
          <GroupedList
            title="Classification"
            footer="Valeurs du champ TYPE du réalisé. Les suggestions reprennent les types connus ; toute autre valeur peut être saisie."
          >
            {TYPE_LISTS.map((t) => (
              <ListRow
                key={t.key}
                label={t.label}
                value={<span className="reglages-summary">{summarize(current[t.key], ['type', 'types'], 'Aucun', 2)}</span>}
                onClick={() => setEditor(t.key)}
              />
            ))}
          </GroupedList>
          {overlap.length > 0 && (
            <Banner tone="warning" compact>
              Présent dans les deux listes : {overlap.join(', ')}
            </Banner>
          )}
        </Stack>

        {/* Barre d'enregistrement : collante, seulement en cas de modification. */}
        {dirty && (
          <div className="reglages-savebar" role="region" aria-label="Enregistrement des paramètres">
            <Text as="span" size="sm" tone="secondary">
              Modifications non enregistrées
            </Text>
            {invalid && (
              <Text as="span" size="sm" tone="danger">
                {errors.length} champ{errors.length > 1 ? 's' : ''} invalide{errors.length > 1 ? 's' : ''}
              </Text>
            )}
            <span className="reglages-savebar__actions">
              <Button disabled={save.isPending} onClick={reset}>
                Annuler
              </Button>
              <Button type="submit" form={FORM_ID} variant="primary" disabled={invalid} loading={save.isPending}>
                Enregistrer
              </Button>
            </span>
          </div>
        )}
      </div>

      <Modal
        opened={editor !== null}
        onClose={() => setEditor(null)}
        title={editor ? EDITOR_TITLE[editor] : undefined}
        size="md"
        footer={
          <Button variant="primary" onClick={() => setEditor(null)}>
            OK
          </Button>
        }
      >
        {editor === 'weeks' && (
          <TagsInput
            aria-label="Semaines ISO verrouillées"
            description="Aucune charge prévue ; tout réalisé imputé dessus est « hors plan ». Saisir un numéro (1 à 53) puis Entrée."
            placeholder="ex. 51"
            value={current.semaines_verrouillees.map(String)}
            onChange={onWeeksChange}
            splitChars={[',', ' ', ';']}
            error={weekError}
          />
        )}
        {editor === 'holidays' && (
          <HolidaysEditor label={null} value={current.jours_feries} onChange={(v) => set('jours_feries', v)} />
        )}
        {TYPE_LISTS.filter((t) => t.key === editor).map((t) => (
          <TypeListInput
            key={t.key}
            label={t.label}
            description={t.description}
            value={current[t.key]}
            onChange={(v) => set(t.key, dedupe(v))}
          />
        ))}
      </Modal>
    </Page>
  );
}
