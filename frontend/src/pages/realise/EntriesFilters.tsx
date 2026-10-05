// Panneau de filtres des écritures du réalisé (SPEC_realise §6.3).
import { Button, Group, NumberInput, Paper, Select, SimpleGrid, Skeleton, Switch, TextInput, Tooltip } from '@mantine/core';
import { IconFilterOff, IconSearch } from '@tabler/icons-react';
import type { Facets } from '../../api/types';
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
    <Paper withBorder p="sm" radius="sm">
      {p.facetsLoading ? (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} h={54} />
          ))}
        </SimpleGrid>
      ) : (
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4, xl: 6 }} spacing="sm" verticalSpacing="xs">
          {selects.map(({ def, values }) => (
            <Select
              key={def.key}
              label={def.label}
              placeholder="Toutes"
              data={values.map((v) => ({ value: v, label: def.key === 'statut' ? (STATUT_LABELS[v] ?? v) : v }))}
              value={f[def.key]}
              onChange={(v) => p.onChange({ [def.key]: v })}
              searchable
              clearable
              nothingFoundMessage="Aucune valeur"
              comboboxProps={{ withinPortal: true }}
              size="sm"
            />
          ))}
          <TextInput
            type="date"
            label="Dépense du"
            value={f.date_from}
            onChange={(e) => p.onChange({ date_from: e.currentTarget.value })}
            error={dateError}
            size="sm"
          />
          <TextInput
            type="date"
            label="au"
            value={f.date_to}
            onChange={(e) => p.onChange({ date_to: e.currentTarget.value })}
            size="sm"
          />
          <NumberInput
            label="Montant min (€)"
            placeholder="—"
            value={f.montant_min}
            onChange={(v) => p.onChange({ montant_min: v })}
            decimalSeparator=","
            thousandSeparator=" "
            allowNegative
            error={amountError}
            size="sm"
          />
          <NumberInput
            label="Montant max (€)"
            placeholder="—"
            value={f.montant_max}
            onChange={(v) => p.onChange({ montant_max: v })}
            decimalSeparator=","
            thousandSeparator=" "
            allowNegative
            size="sm"
          />
        </SimpleGrid>
      )}
      <Group mt="sm" gap="md" align="flex-end" wrap="wrap">
        <TextInput
          style={{ flex: '1 1 260px' }}
          label="Recherche"
          placeholder={p.searchDescription ? 'TG, libellé TG ou description…' : 'TG ou libellé TG…'}
          leftSection={<IconSearch size={16} />}
          value={p.q}
          onChange={(e) => p.onQChange(e.currentTarget.value)}
          size="sm"
          aria-label="Recherche plein-texte"
        />
        <Tooltip label="Désactiver pour ne pas chercher dans un champ sensible" withArrow>
          <Switch
            label="Inclure la description"
            checked={p.searchDescription}
            onChange={(e) => p.onSearchDescriptionChange(e.currentTarget.checked)}
            mb={6}
          />
        </Tooltip>
        <Tooltip label="Nom, matricule, facture, commande, description (affichage et export)" withArrow multiline maw={300}>
          <Switch
            label="Masquer les colonnes sensibles"
            checked={p.maskSensitive}
            onChange={(e) => p.onMaskSensitiveChange(e.currentTarget.checked)}
            mb={6}
          />
        </Tooltip>
        <Button
          variant="subtle"
          size="sm"
          leftSection={<IconFilterOff size={16} />}
          onClick={p.onReset}
          disabled={active === 0}
          ml="auto"
        >
          Réinitialiser les filtres{active ? ` (${active})` : ''}
        </Button>
      </Group>
    </Paper>
  );
}
