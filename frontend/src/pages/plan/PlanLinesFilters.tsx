// Ligne basse de la barre d'outils du détail d'un plan : recherche, popover de critères,
// pastilles des filtres actifs et compteur « à vérifier » (raccourci vers statut=warn).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActiveFilters,
  Button,
  DateInput,
  Field,
  FilterButton,
  Group,
  SearchField,
  SegmentedControl,
  Select,
  Stack,
  StatusGlyph,
  useDebouncedValue,
  type ActiveFilter,
} from '../../ui';
import type { Facets } from '../../api/types';
import { fmtDate } from '../../lib/format';
import { FILTER_KEYS, type FilterKey, type Filters, type FiltersPatch } from './useLineFilters';

const STATUT_LABEL: Record<string, string> = {
  ok: 'OK',
  warn: 'À vérifier (warn)',
  drop: 'Rejetée (drop)',
};

interface Props {
  filters: Filters;
  update: (patch: FiltersPatch) => void;
  facets: Facets | undefined;
  squadLabel: (id: string) => string;
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

export default function PlanLinesFilters({ filters, update, facets, squadLabel, nbWarn }: Props) {
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
  const inactiveValue = filters.inactive === 'true' ? 'true' : filters.inactive === 'false' ? 'false' : 'all';
  const dateError =
    filters.date_from && filters.date_to && filters.date_to < filters.date_from ? 'Fin antérieure au début' : undefined;
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
  if (filters.nom_prenom) pills.push(pill('nom_prenom', 'Ressource', filters.nom_prenom));
  if (filters.ligne_cout) pills.push(pill('ligne_cout', 'Ligne de coût', filters.ligne_cout));
  if (filters.statut) pills.push(pill('statut', 'Statut', STATUT_LABEL[filters.statut] ?? filters.statut));
  if (filters.squad_id) pills.push(pill('squad_id', 'Squad', squadLabel(filters.squad_id)));
  if (filters.inactive)
    pills.push(pill('inactive', 'Ressources', filters.inactive === 'true' ? 'inactives' : 'actives'));
  if (filters.date_from) pills.push(pill('date_from', 'Du', fmtDate(filters.date_from)));
  if (filters.date_to) pills.push(pill('date_to', 'Au', fmtDate(filters.date_to)));

  const warnOn = filters.statut === 'warn';

  return (
    <Group gap={8} wrap={false} className="plan-bottom">
      <SearchField aria-label="Recherche" placeholder="Nom, CT, libellé…" value={qInput} onChange={setQInput} />
      <FilterButton count={count} onReset={clearCriteria}>
        <Stack gap={12}>
          <FacetSelect label="CT" name="ct" values={facets?.ct} {...common} />
          <FacetSelect label="Ressource" name="nom_prenom" values={facets?.nom_prenom} {...common} />
          <FacetSelect label="Ligne de coût" name="ligne_cout" values={facets?.ligne_cout} {...common} />
          <FacetSelect label="Squad" name="squad_id" values={facets?.squad_id} render={squadLabel} {...common} />
          <FacetSelect
            label="Statut du parsing"
            name="statut"
            values={statutValues}
            render={(v) => STATUT_LABEL[v] ?? v}
            {...common}
          />
          <Field label="Ressources">
            <SegmentedControl
              aria-label="Ressources"
              fullWidth
              value={inactiveValue}
              onChange={(v) => update({ inactive: v === 'all' ? '' : v })}
              data={[
                { value: 'all', label: 'Toutes' },
                { value: 'false', label: 'Actives' },
                { value: 'true', label: 'Inactives' },
              ]}
            />
          </Field>
          <Group gap={8} wrap={false} align="start">
            <DateInput label="Du" value={filters.date_from} onChange={(v) => update({ date_from: v })} clearable />
            <DateInput
              label="Au"
              value={filters.date_to}
              error={dateError}
              onChange={(v) => update({ date_to: v })}
              clearable
            />
          </Group>
        </Stack>
      </FilterButton>
      <div className="plan-bottom__pills">
        <ActiveFilters items={pills} onClearAll={pills.length > 1 ? clearCriteria : undefined} />
      </div>
      {nbWarn > 0 && (
        <Button
          variant="plain"
          size="sm"
          className="plan-bottom__warn"
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
