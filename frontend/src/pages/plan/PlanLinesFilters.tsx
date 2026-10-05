// Barre de filtres du détail d'une version de plan (§7.3) + export CSV.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  DateInput,
  Group,
  SearchField,
  SegmentedControl,
  Select,
  Spinner,
  Text,
  useDebouncedValue,
} from '../../ui';
import { IconDownload, IconFilterOff } from '../../ui/Icons';
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

/** Pop-up button de filtre sur une facette (le titre du bouton est le nom du filtre). */
function FacetSelect({
  label,
  name,
  values,
  filters,
  update,
  render,
}: {
  label: string;
  name: FilterKey;
  values: string[] | undefined;
  filters: Filters;
  update: (patch: FiltersPatch) => void;
  render?: (v: string) => string;
}) {
  const current = filters[name];
  const data = useMemo(() => {
    const set = new Set((values ?? []).filter((v) => v !== ''));
    if (current) set.add(current); // valeur venue de l'URL absente des facettes
    return [...set].map((v) => ({ value: v, label: render ? render(v) : v }));
  }, [values, current, render]);
  return (
    <Select
      aria-label={label}
      placeholder={label}
      data={data}
      value={current || null}
      onChange={(v) => update({ [name]: v ?? '' })}
      searchable
      clearable
      menuWidth={290}
      nothingFound="Aucun résultat"
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
  const common = { filters, update };

  // Téléchargement du CSV (le kit n'expose pas de bouton-lien externe avec `download`).
  const downloadCsv = () => {
    const a = document.createElement('a');
    a.href = csvHref;
    a.download = '';
    a.click();
  };

  return (
    <Group justify="between" align="start" gap={8}>
      <Group gap={8}>
        <SearchField
          aria-label="Recherche"
          placeholder="Libellé, CT, ressource…"
          value={qInput}
          onChange={setQInput}
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
        <SegmentedControl
          aria-label="Ressources [inactif]"
          equal={false}
          value={inactiveValue}
          onChange={(v) => update({ inactive: v === 'all' ? '' : v })}
          data={[
            { value: 'all', label: 'Toutes' },
            { value: 'false', label: 'Actives' },
            { value: 'true', label: 'Inactives' },
          ]}
        />
        <Group gap={6} align="start" wrap={false}>
          <Text as="span" size="sm" tone="secondary" style={{ lineHeight: '28px' }}>
            Période du
          </Text>
          <DateInput
            aria-label="Période du"
            width={150}
            value={filters.date_from}
            onChange={(v) => update({ date_from: v })}
          />
          <Text as="span" size="sm" tone="secondary" style={{ lineHeight: '28px' }}>
            au
          </Text>
          <DateInput
            aria-label="au"
            width={150}
            value={filters.date_to}
            error={dateError}
            onChange={(v) => update({ date_to: v })}
          />
        </Group>
        {facetsLoading && <Spinner label="Chargement des filtres" />}
        <Button
          variant="plain"
          icon={<IconFilterOff size={15} />}
          disabled={activeCount === 0}
          onClick={() => {
            setQInput('');
            reset();
          }}
        >
          Réinitialiser
        </Button>
        {activeCount > 0 && (
          <Text as="span" size="sm" tone="secondary" tabular>
            {activeCount} filtre{activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''}
          </Text>
        )}
      </Group>
      <Button icon={<IconDownload size={15} />} onClick={downloadCsv}>
        Export CSV (lignes filtrées)
      </Button>
    </Group>
  );
}
