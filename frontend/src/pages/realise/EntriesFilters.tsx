// Ligne basse de la barre d'outils du détail du réalisé : recherche, popover de critères,
// pastilles des filtres actifs et compteur « à vérifier » (raccourci vers statut=warn).
import type { Facets } from '../../api/types';
import {
  ActiveFilters,
  Button,
  DateInput,
  Disclosure,
  FilterButton,
  Group,
  NumberInput,
  SearchField,
  Select,
  Stack,
  StatusGlyph,
  Switch,
  type ActiveFilter,
} from '../../ui';
import { fmtDate, fmtEur } from '../../lib/format';
import { countActiveFilters, EMPTY_FILTERS, STATUT_LABELS, type EntriesFilterState, type FacetKey } from './filters';
import './realise.css';

interface FacetDef {
  key: FacetKey;
  label: string;
  /** Clés de facette alternatives tolérées. */
  alt?: string[];
}

/** Critères principaux, puis critères secondaires (repliés). */
const MAIN_FACETS: FacetDef[] = [
  { key: 'tg', label: 'TG' },
  { key: 'wp', label: 'WP' },
  { key: 'categorie', label: 'Catégorie' },
  { key: 'type', label: 'Type' },
  { key: 'statut', label: 'Statut du parsing', alt: ['statut_parsing'] },
];
const MORE_FACETS: FacetDef[] = [
  { key: 'entite', label: 'Entité' },
  { key: 'activite', label: 'Activité' },
  { key: 'trigramme', label: 'Trigramme' },
  { key: 'lot', label: 'Lot IFRS15', alt: ['lot_ifrs15'] },
];
const ALL_FACETS = [...MAIN_FACETS, ...MORE_FACETS];

function facetValues(facets: Facets | undefined, def: FacetDef, current: string | null): string[] {
  let values: string[] = [];
  for (const k of [def.key, ...(def.alt ?? [])]) {
    const v = facets?.[k];
    if (v && v.length) {
      values = v.filter((x) => x !== '');
      break;
    }
  }
  if (def.key === 'statut' && values.length === 0) values = ['ok', 'warn', 'drop'];
  if (current && !values.includes(current)) values = [current, ...values]; // valeur venue de l'URL
  return values;
}

/** Montant du filtre (nombre ou '' = vide) → valeur du champ numérique. */
const amount = (v: number | string): number | null => (typeof v === 'number' ? v : null);

interface Props {
  facets: Facets | undefined;
  filters: EntriesFilterState;
  onChange: (patch: Partial<EntriesFilterState>) => void;
  q: string;
  onQChange: (q: string) => void;
  searchDescription: boolean;
  onSearchDescriptionChange: (v: boolean) => void;
  /** Lignes en avertissement de l'import (compteur cliquable). */
  nbWarn: number;
}

export default function EntriesFilters(p: Props) {
  const { filters: f } = p;
  const dateError = f.date_from && f.date_to && f.date_from > f.date_to ? 'Début postérieur à la fin' : undefined;
  const amountError =
    typeof f.montant_min === 'number' && typeof f.montant_max === 'number' && f.montant_min > f.montant_max
      ? 'Minimum supérieur au maximum'
      : undefined;
  const count = countActiveFilters(f);
  const clearCriteria = () => p.onChange(EMPTY_FILTERS);
  const moreActive = MORE_FACETS.some((d) => f[d.key]);

  const facetSelect = (def: FacetDef) => {
    const values = facetValues(p.facets, def, f[def.key]);
    if (p.facets && values.length === 0) return null; // facette absente de cet import
    return (
    <Select
      key={def.key}
      label={def.label}
      placeholder="Tous"
      width="100%"
      data={values.map((v) => ({
        value: v,
        label: def.key === 'statut' ? (STATUT_LABELS[v] ?? v) : v,
      }))}
      value={f[def.key]}
      onChange={(v) => p.onChange({ [def.key]: v })}
      searchable
      clearable
      nothingFound="Aucune valeur"
      menuWidth={290}
    />
    );
  };

  const pills: ActiveFilter[] = [];
  for (const def of ALL_FACETS) {
    const v = f[def.key];
    if (v)
      pills.push({
        key: def.key,
        label: `${def.label} : ${def.key === 'statut' ? (STATUT_LABELS[v] ?? v) : v}`,
        onRemove: () => p.onChange({ [def.key]: null }),
      });
  }
  if (f.date_from) pills.push({ key: 'date_from', label: `Du : ${fmtDate(f.date_from)}`, onRemove: () => p.onChange({ date_from: '' }) });
  if (f.date_to) pills.push({ key: 'date_to', label: `Au : ${fmtDate(f.date_to)}`, onRemove: () => p.onChange({ date_to: '' }) });
  if (typeof f.montant_min === 'number')
    pills.push({ key: 'montant_min', label: `≥ ${fmtEur(f.montant_min, true)}`, onRemove: () => p.onChange({ montant_min: '' }) });
  if (typeof f.montant_max === 'number')
    pills.push({ key: 'montant_max', label: `≤ ${fmtEur(f.montant_max, true)}`, onRemove: () => p.onChange({ montant_max: '' }) });

  const warnOn = f.statut === 'warn';

  return (
    <Group gap={8} wrap={false} className="realise-bottom">
      <SearchField
        aria-label="Recherche plein-texte"
        placeholder={p.searchDescription ? 'TG, libellé, nom, description…' : 'TG, libellé TG, nom…'}
        value={p.q}
        onChange={p.onQChange}
      />
      <FilterButton count={count} onReset={clearCriteria}>
        <Stack gap={12}>
          {MAIN_FACETS.map(facetSelect)}
          <Group gap={8} wrap={false} align="start">
            <DateInput
              label="Dépense du"
              value={f.date_from}
              onChange={(v) => p.onChange({ date_from: v })}
              error={dateError}
              clearable
            />
            <DateInput label="au" value={f.date_to} onChange={(v) => p.onChange({ date_to: v })} clearable />
          </Group>
          <Group gap={8} wrap={false} align="start">
            <NumberInput
              label="Montant min"
              suffix="€"
              value={amount(f.montant_min)}
              onChange={(v) => p.onChange({ montant_min: v ?? '' })}
              error={amountError}
            />
            <NumberInput
              label="Montant max"
              suffix="€"
              value={amount(f.montant_max)}
              onChange={(v) => p.onChange({ montant_max: v ?? '' })}
            />
          </Group>
          <Switch
            label="Inclure la description"
            description="Recherche aussi dans la description (champ sensible)."
            checked={p.searchDescription}
            onChange={p.onSearchDescriptionChange}
          />
          <Disclosure summary="Autres critères" defaultOpen={moreActive}>
            <Stack gap={12}>{MORE_FACETS.map(facetSelect)}</Stack>
          </Disclosure>
        </Stack>
      </FilterButton>
      <div className="realise-bottom__pills">
        <ActiveFilters items={pills} onClearAll={pills.length > 1 ? clearCriteria : undefined} />
      </div>
      {p.nbWarn > 0 && (
        <Button
          variant="plain"
          size="sm"
          className="realise-bottom__warn"
          icon={<StatusGlyph kind="warning" tone="warning" size={13} />}
          aria-pressed={warnOn}
          title={warnOn ? 'Afficher toutes les écritures' : 'Afficher les écritures à vérifier'}
          onClick={() => p.onChange({ statut: warnOn ? null : 'warn' })}
        >
          {p.nbWarn.toLocaleString('fr-FR')} à vérifier
        </Button>
      )}
    </Group>
  );
}
