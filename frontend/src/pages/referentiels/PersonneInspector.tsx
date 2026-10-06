// Fiche personne dans l'inspecteur : identité (NOM + Prénom, lecture seule), statut, squad (§6.2, DECISIONS n° 8).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Inspector, InspectorSection, KeyValue, LoadingBlock, Select, Stack } from '../../ui';
import { referentielApi } from '../../api/client';
import type { Personne } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime } from '../../lib/format';
import { personneKey, usePersonneMutation, useSquadIndex } from './hooks';
import { PersonneStatutBadge } from './shared';
import './referentiels.css';

interface Props {
  personneId: string | null;
  onClose: () => void;
}

type StatutBody = { id: string; statut: Personne['statut'] };

export default function PersonneInspector({ personneId, onClose }: Props) {
  const q = useQuery({
    queryKey: personneKey(personneId ?? ''),
    queryFn: () => referentielApi.personne(personneId!),
    enabled: !!personneId,
  });
  const p = q.data;

  const setStatut = usePersonneMutation(
    ({ id, statut }: StatutBody) => referentielApi.updatePersonne(id, { statut }),
    () => 'Fiche enregistrée.',
  );

  const footer = p ? (
    p.statut === 'brouillon' ? (
      <Button
        variant="primary"
        loading={setStatut.isPending}
        onClick={() => setStatut.mutate({ id: p.id, statut: 'validee' })}
      >
        Valider la fiche
      </Button>
    ) : (
      <Button loading={setStatut.isPending} onClick={() => setStatut.mutate({ id: p.id, statut: 'brouillon' })}>
        Repasser en brouillon
      </Button>
    )
  ) : undefined;

  return (
    <Inspector
      opened={!!personneId}
      onClose={onClose}
      title={p?.display_name ?? 'Fiche personne'}
      accessory={p ? <PersonneStatutBadge statut={p.statut} /> : undefined}
      footer={footer}
    >
      {q.isLoading && <LoadingBlock />}
      <ErrorAlert error={q.error} title="Fiche introuvable" />
      {p && <PersonneDetail key={p.id} personne={p} />}
    </Inspector>
  );
}

function PersonneDetail({ personne: p }: { personne: Personne }) {
  return (
    <>
      <InspectorSection title="Identité">
        <IdentitySection personne={p} />
      </InspectorSection>
      <InspectorSection title="Squad">
        <SquadSection personne={p} />
      </InspectorSection>
    </>
  );
}

// ------------------------------------------------------------------ Identité

/** Le nom est l'identité de la fiche : il n'est pas modifiable (il vient du plan et du réalisé). */
function IdentitySection({ personne: p }: { personne: Personne }) {
  return (
    <Stack gap={8}>
      <KeyValue
        items={[
          { label: 'NOM Prénom', value: p.display_name },
          { label: 'Clé', value: p.nom_normalise || '—', mono: true },
          { label: 'Créée le', value: fmtDateTime(p.created_at) },
        ]}
      />
      <p className="ref-help">Identité = NOM + Prénom, tels qu'écrits au plan et au réalisé.</p>
    </Stack>
  );
}

// ------------------------------------------------------------------ Squad

function SquadSection({ personne: p }: { personne: Personne }) {
  const squads = useSquadIndex();
  const save = usePersonneMutation(
    (squad_id: string | null) => referentielApi.updatePersonne(p.id, { squad_id }),
    () => 'Fiche enregistrée.',
  );
  // Pendant l'enregistrement, on affiche déjà la valeur choisie.
  const value = save.isPending ? (save.variables ?? null) : p.squad_id;

  const options = useMemo(() => {
    // Squad courant inconnu de la liste (ex. pas encore chargée) : on l'affiche par son id.
    if (value && !squads.options.some((o) => o.value === value)) return [...squads.options, { value, label: value }];
    return squads.options;
  }, [squads.options, value]);

  return (
    <Select
      aria-label="Squad"
      width="100%"
      placeholder="Aucune"
      data={options}
      value={value}
      onChange={(v) => v !== p.squad_id && save.mutate(v)}
      searchable
      clearable
      menuWidth={290}
      nothingFound="Aucune squad"
    />
  );
}
