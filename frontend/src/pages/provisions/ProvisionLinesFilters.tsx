// Ligne basse de la barre d'outils du détail des provisions : recherche, popover de critères,
// pastilles des filtres actifs et compteur « à vérifier » (raccourci vers statut=warn).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActiveFilters,
  Button,
  FilterButton,
  Group,
  SearchField,
  Select,
  Stack,
  StatusGlyph,
  useDebouncedValue,
  type ActiveFilter,
} from '../../ui';
import type { Facets } from '../../api/types';
import { FILTER_KEYS, STATUT_LABEL, type FilterKey, type Filters, type FiltersPatch } from './useProvisionFilters';

interface Props {
  filters: Filters;
  update: (patch: FiltersPatch) => void;
  facets: Facets | undefined;
  /** Lignes en avertissement de la version (compteur cliquable). */
  nbWarn: number;
}

/** Pop-up button étiqueté sur une facette. */
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
      label={label}
      placeholder="Tous"
      width="100%"
      data={data}
      value={current || null}
      onChange={(v) => update({ [name]: v ?? '' })}
      searchable
      clearable
      menuWidth={290}
    />
  );
}

/** Critères du popover (tout sauf la recherche plein-texte). */
const CRITERIA = FILTER_KEYS.filter((k) => k !== 'q');
const statutLabel = (v: string) => STATUT_LABEL[v] ?? v;

export default function ProvisionLinesFilters({ filters, update, facets, nbWarn }: Props) {
  // Recherche plein-texte : saisie locale, écrite dans l'URL après 300 ms.
  const [qInput, setQInput] = useState(filters.q);
  const [qDebounced] = useDebouncedValue(qInput, 300);
  const latest = useRef({ q: filters.q, update });
  latest.current = { q: filters.q, update };
  useEffect(() => {
    const v = qDebounced.trim();
    if (v !== latest.current.q) latest.current.update({ q: v });
  }, [qDebounced]);
  // Réinitialisation externe (navigation) → resynchronise le champ.
  useEffect(() => {
    setQInput((cur) => (cur.trim() === filters.q ? cur : filters.q));
  }, [filters.q]);

  const statutValues = facets?.statut?.length ? facets.statut : ['ok', 'warn', 'drop'];
  const common = { filters, update };

  const clearCriteria = () => update(Object.fromEntries(CRITERIA.map((k) => [k, ''])));
  const count = CRITERIA.filter((k) => filters[k] !== '').length;

  const pill = (key: FilterKey, label: string, value: string): ActiveFilter => ({
    key,
    label: `${label} : ${value}`,
    onRemove: () => update({ [key]: '' }),
  });
  const pills: ActiveFilter[] = [];
  if (filters.ct) pills.push(pill('ct', 'CT', filters.ct));
  if (filters.ligne_cout) pills.push(pill('ligne_cout', 'Ligne de coût', filters.ligne_cout));
  if (filters.groupe) pills.push(pill('groupe', 'Groupe', filters.groupe));
  if (filters.statut) pills.push(pill('statut', 'Statut', statutLabel(filters.statut)));

  const warnOn = filters.statut === 'warn';

  return (
    <Group gap={8} wrap={false} className="provisions-bottom">
      <SearchField aria-label="Recherche" placeholder="CT, libellé, groupe…" value={qInput} onChange={setQInput} />
      <FilterButton count={count} onReset={clearCriteria}>
        <Stack gap={12}>
          <FacetSelect label="CT" name="ct" values={facets?.ct} {...common} />
          <FacetSelect label="Ligne de coût" name="ligne_cout" values={facets?.ligne_cout} {...common} />
          <FacetSelect label="Groupe" name="groupe" values={facets?.groupe} {...common} />
          <FacetSelect label="Statut du parsing" name="statut" values={statutValues} render={statutLabel} {...common} />
        </Stack>
      </FilterButton>
      <div className="provisions-bottom__pills">
        <ActiveFilters items={pills} onClearAll={pills.length > 1 ? clearCriteria : undefined} />
      </div>
      {nbWarn > 0 && (
        <Button
          variant="plain"
          size="sm"
          className="provisions-bottom__warn"
          icon={<StatusGlyph kind="warning" tone="warning" size={13} />}
          aria-pressed={warnOn}
          title={warnOn ? 'Afficher toutes les lignes' : 'Afficher les lignes à vérifier'}
          onClick={() => update({ statut: warnOn ? '' : 'warn' })}
        >
          {nbWarn.toLocaleString('fr-FR')} à vérifier
        </Button>
      )}
    </Group>
  );
}
