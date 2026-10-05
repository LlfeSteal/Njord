// Barre de filtres du détail d'une version de plan (§7.3) + export CSV.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Input,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconDownload, IconFilterOff, IconSearch } from '@tabler/icons-react';
import type { Facets } from '../../api/types';
import type { Filters, FiltersPatch, FilterKey } from './useLineFilters';

const STATUT_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'Avertissement (warn)',
  drop: 'Rejetée (drop)',
};

interface Props {
  filters: Filters;
  update: (patch: FiltersPatch) => void;
  reset: () => void;
  activeCount: number;
  facets: Facets | undefined;
  facetsLoading: boolean;
  squadLabel: (id: string) => string;
  csvHref: string;
}

function FacetSelect({
  label,
  name,
  values,
  filters,
  update,
  render,
  loading,
}: {
  label: string;
  name: FilterKey;
  values: string[] | undefined;
  filters: Filters;
  update: (patch: FiltersPatch) => void;
  render?: (v: string) => string;
  loading?: boolean;
}) {
  const current = filters[name];
  const data = useMemo(() => {
    const set = new Set((values ?? []).filter((v) => v !== ''));
    if (current) set.add(current); // valeur venue de l'URL absente des facettes
    return [...set].map((v) => ({ value: v, label: render ? render(v) : v }));
  }, [values, current, render]);
  return (
    <Select
      label={label}
      placeholder="Tous"
      data={data}
      value={current || null}
      onChange={(v) => update({ [name]: v ?? '' })}
      searchable
      clearable
      limit={200}
      nothingFoundMessage="Aucun résultat"
      rightSection={loading ? <Loader size="xs" /> : undefined}
    />
  );
}

export default function PlanLinesFilters({
  filters,
  update,
  reset,
  activeCount,
  facets,
  facetsLoading,
  squadLabel,
  csvHref,
}: Props) {
  // Recherche plein-texte : saisie locale, écrite dans l'URL après 300 ms.
  const [qInput, setQInput] = useState(filters.q);
  const [qDebounced] = useDebouncedValue(qInput, 300);
  const latest = useRef({ q: filters.q, update });
  latest.current = { q: filters.q, update };
  useEffect(() => {
    const v = qDebounced.trim();
    if (v !== latest.current.q) latest.current.update({ q: v });
  }, [qDebounced]);
  // Réinitialisation externe (bouton, navigation) → resynchronise le champ.
  useEffect(() => {
    setQInput((cur) => (cur.trim() === filters.q ? cur : filters.q));
  }, [filters.q]);

  const statutValues = facets?.statut?.length ? facets.statut : ['ok', 'warn', 'drop'];
  const inactiveValue = filters.inactive === 'true' ? 'true' : filters.inactive === 'false' ? 'false' : 'all';
  const dateError =
    filters.date_from && filters.date_to && filters.date_to < filters.date_from
      ? 'Date de fin antérieure au début'
      : undefined;
  const common = { filters, update, loading: facetsLoading };

  return (
    <Paper withBorder p="sm">
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm" verticalSpacing="xs">
        <TextInput
          label="Recherche"
          placeholder="Libellé, CT, ressource…"
          leftSection={<IconSearch size={16} />}
          value={qInput}
          onChange={(e) => setQInput(e.currentTarget.value)}
        />
        <FacetSelect label="CT" name="ct" values={facets?.ct} {...common} />
        <FacetSelect label="Ressource" name="ressource" values={facets?.ressource} {...common} />
        <FacetSelect label="Ligne de coût" name="ligne_cout" values={facets?.ligne_cout} {...common} />
        <FacetSelect
          label="Statut parsing"
          name="statut"
          values={statutValues}
          render={(v) => STATUT_LABEL[v] ?? v}
          {...common}
        />
        <FacetSelect label="Squad" name="squad_id" values={facets?.squad_id} render={squadLabel} {...common} />
        <Input.Wrapper label="Ressources [inactif]">
          <SegmentedControl
            fullWidth
            value={inactiveValue}
            onChange={(v) => update({ inactive: v === 'all' ? '' : v })}
            data={[
              { value: 'all', label: 'Toutes' },
              { value: 'false', label: 'Actives' },
              { value: 'true', label: 'Inactives' },
            ]}
          />
        </Input.Wrapper>
        <Group grow gap="xs" align="flex-start">
          <TextInput
            type="date"
            label="Période du"
            value={filters.date_from}
            onChange={(e) => update({ date_from: e.currentTarget.value })}
          />
          <TextInput
            type="date"
            label="au"
            value={filters.date_to}
            error={dateError}
            onChange={(e) => update({ date_to: e.currentTarget.value })}
          />
        </Group>
      </SimpleGrid>
      <Group justify="space-between" mt="sm">
        <Group gap="xs">
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconFilterOff size={16} />}
            disabled={activeCount === 0}
            onClick={() => {
              setQInput('');
              reset();
            }}
          >
            Réinitialiser les filtres
          </Button>
          {activeCount > 0 && (
            <Badge variant="light" size="sm">
              {activeCount} filtre{activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''}
            </Badge>
          )}
        </Group>
        <Button
          component="a"
          href={csvHref}
          download
          variant="light"
          size="xs"
          leftSection={<IconDownload size={16} />}
        >
          Export CSV (lignes filtrées)
        </Button>
      </Group>
    </Paper>
  );
}
