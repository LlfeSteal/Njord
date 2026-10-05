// Barre de filtres des écritures du réalisé (SPEC_realise §6.3).
import type { Facets } from '../../api/types';
import { Button, DateInput, Group, NumberInput, SearchField, Select, Skeleton, Stack, Switch, Text, Tooltip } from '../../ui';
import { IconFilterOff } from '../../ui/Icons';
import { countActiveFilters, type EntriesFilterState, type FacetKey } from './filters';

/** Filtres à liste de valeurs ; `alt` = clés de facette alternatives tolérées. */
const FACET_FILTERS: { key: FacetKey; label: string; alt?: string[] }[] = [
  { key: 'entite', label: 'Entité' },
  { key: 'activite', label: 'Activité' },
  { key: 'trigramme', label: 'Trigramme' },
  { key: 'tg', label: 'TG' },
  { key: 'wp', label: 'WP' },
  { key: 'categorie', label: 'Catégorie' },
  { key: 'type', label: 'Type' },
  { key: 'lot', label: 'Lot IFRS15', alt: ['lot_ifrs15'] },
  { key: 'statut', label: 'Statut parsing', alt: ['statut_parsing'] },
];

const STATUT_LABELS: Record<string, string> = {
  ok: 'OK',
  warn: 'Avertissement (warn)',
  drop: 'Rejetée (drop)',
};

function facetValues(facets: Facets | undefined, key: string, alt?: string[]): string[] {
  if (!facets) return [];
  for (const k of [key, ...(alt ?? [])]) {
    const v = facets[k];
    if (v && v.length) return v.filter((x) => x !== '');
  }
  return [];
}

/** Montant du filtre (nombre ou '' = vide) → valeur du champ numérique. */
const amount = (v: number | string): number | null => (typeof v === 'number' ? v : null);

interface Props {
  facets: Facets | undefined;
  facetsLoading: boolean;
  filters: EntriesFilterState;
  onChange: (patch: Partial<EntriesFilterState>) => void;
  onReset: () => void;
  q: string;
  onQChange: (q: string) => void;
  searchDescription: boolean;
  onSearchDescriptionChange: (v: boolean) => void;
  maskSensitive: boolean;
  onMaskSensitiveChange: (v: boolean) => void;
}

export default function EntriesFilters(p: Props) {
  const { filters: f } = p;
  const dateError = f.date_from && f.date_to && f.date_from > f.date_to ? 'Début postérieur à la fin' : undefined;
  const amountError =
    typeof f.montant_min === 'number' && typeof f.montant_max === 'number' && f.montant_min > f.montant_max
      ? 'Minimum supérieur au maximum'
      : undefined;
  const active = countActiveFilters(f) + (p.q.trim() ? 1 : 0);

  const selects = FACET_FILTERS.map((def) => {
    let values = facetValues(p.facets, def.key, def.alt);
    if (def.key === 'statut' && values.length === 0 && p.facets) values = ['ok', 'warn', 'drop'];
    return { def, values };
  }).filter((s) => s.values.length > 0);

  return (
    <Stack gap={8}>
      {/* Recherche plein-texte + filtres à valeurs (pop-up buttons) */}
      <Group gap={8}>
        <SearchField
          aria-label="Recherche plein-texte"
          placeholder={p.searchDescription ? 'TG, libellé TG ou description…' : 'TG ou libellé TG…'}
          value={p.q}
          onChange={p.onQChange}
          width={260}
        />
        {p.facetsLoading
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} width={96} height={28} radius={7} />)
          : selects.map(({ def, values }) => (
              <Select
                key={def.key}
                aria-label={def.label}
                placeholder={def.label}
                data={values.map((v) => ({ value: v, label: def.key === 'statut' ? (STATUT_LABELS[v] ?? v) : v }))}
                value={f[def.key]}
                onChange={(v) => p.onChange({ [def.key]: v })}
                searchable
                clearable
                nothingFound="Aucune valeur"
                menuWidth={290}
              />
            ))}
        <Button
          variant="plain"
          icon={<IconFilterOff size={15} />}
          onClick={p.onReset}
          disabled={active === 0}
          style={{ marginLeft: 'auto' }}
        >
          Réinitialiser{active ? ` (${active})` : ''}
        </Button>
      </Group>

      {/* Bornes de date et de montant, options de recherche */}
      <Group gap={8} align="start">
        <Group gap={8}>
          <Text as="span" size="sm" tone="secondary">
            Dépense du
          </Text>
          <DateInput
            aria-label="Dépense du"
            value={f.date_from}
            onChange={(v) => p.onChange({ date_from: v })}
            error={dateError}
            width={150}
          />
          <Text as="span" size="sm" tone="secondary">
            au
          </Text>
          <DateInput aria-label="Dépense au" value={f.date_to} onChange={(v) => p.onChange({ date_to: v })} width={150} />
        </Group>
        <Group gap={8}>
          <NumberInput
            aria-label="Montant min (€)"
            placeholder="Montant min"
            suffix="€"
            value={amount(f.montant_min)}
            onChange={(v) => p.onChange({ montant_min: v ?? '' })}
            error={amountError}
            width={140}
          />
          <NumberInput
            aria-label="Montant max (€)"
            placeholder="Montant max"
            suffix="€"
            value={amount(f.montant_max)}
            onChange={(v) => p.onChange({ montant_max: v ?? '' })}
            width={140}
          />
        </Group>
        <Group gap={16} style={{ minHeight: 28 }}>
          <Tooltip label="Désactiver pour ne pas chercher dans un champ sensible">
            <Switch label="Inclure la description" checked={p.searchDescription} onChange={p.onSearchDescriptionChange} />
          </Tooltip>
          <Tooltip label="Nom, matricule, facture, commande, description (affichage et export)" maxWidth={300}>
            <Switch label="Masquer les colonnes sensibles" checked={p.maskSensitive} onChange={p.onMaskSensitiveChange} />
          </Tooltip>
        </Group>
      </Group>
    </Stack>
  );
}
