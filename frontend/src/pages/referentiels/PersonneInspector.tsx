// Fiche personne dans l'inspecteur : identité, squad, matricules, alias, fusion vers une fiche existante (§6.2).
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Group,
  IconButton,
  Inspector,
  InspectorSection,
  KeyValue,
  LoadingBlock,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../ui';
import { IconMerge, IconPlus, IconTrash } from '../../ui/Icons';
import { referentielApi } from '../../api/client';
import type { Personne } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { notifyError, notifySuccess, personneKey, usePersonneMutation, useSquadIndex } from './hooks';
import { AliasTable, MatriculesList, PersonneStatutBadge } from './shared';
import './referentiels.css';

interface Props {
  personneId: string | null;
  onClose: () => void;
  /** Ouvre une autre fiche (après fusion : la fiche cible). */
  onSwitch: (id: string) => void;
}

type StatutBody = { id: string; statut: Personne['statut'] };

export default function PersonneInspector({ personneId, onClose, onSwitch }: Props) {
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
      {p && <PersonneDetail key={p.id} personne={p} onSwitch={onSwitch} />}
    </Inspector>
  );
}

function PersonneDetail({ personne: p, onSwitch }: { personne: Personne; onSwitch: (id: string) => void }) {
  return (
    <>
      <InspectorSection title="Identité">
        <IdentitySection personne={p} />
      </InspectorSection>
      <InspectorSection title="Squad">
        <SquadSection personne={p} />
      </InspectorSection>
      <InspectorSection title="Matricules">
        <MatriculesSection personne={p} />
      </InspectorSection>
      <InspectorSection title="Alias">
        <AliasSection personne={p} />
      </InspectorSection>
      <InspectorSection title="Fusion">
        <MergeSection personne={p} onMerged={onSwitch} />
      </InspectorSection>
    </>
  );
}

// ------------------------------------------------------------------ Identité

function IdentitySection({ personne: p }: { personne: Personne }) {
  const [name, setName] = useState(p.display_name);
  const dirty = name.trim() !== p.display_name;
  const save = usePersonneMutation(
    (display_name: string) => referentielApi.updatePersonne(p.id, { display_name }),
    () => 'Fiche enregistrée.',
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && name.trim()) save.mutate(name.trim());
  };

  return (
    <Stack gap={8}>
      <form onSubmit={submit}>
        <TextInput
          label="Nom affiché"
          value={name}
          onChange={setName}
          required
          error={!name.trim() ? 'Nom requis' : undefined}
        />
        {/* Actions visibles seulement pendant une modification. */}
        {dirty && (
          <Group justify="end" gap={8} mt={8}>
            <Button size="sm" onClick={() => setName(p.display_name)}>
              Annuler
            </Button>
            <Button size="sm" type="submit" variant="primary" disabled={!name.trim()} loading={save.isPending}>
              Enregistrer
            </Button>
          </Group>
        )}
      </form>
      <KeyValue
        items={[
          { label: 'Nom normalisé', value: p.nom_normalise || '—', mono: true },
          { label: 'Créée le', value: fmtDateTime(p.created_at) },
        ]}
      />
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

// ------------------------------------------------------------------ Matricules

function MatriculesSection({ personne: p }: { personne: Personne }) {
  const [value, setValue] = useState('');
  const add = usePersonneMutation(
    (m: string) => referentielApi.addMatricule(p.id, m),
    (_, m) => `Matricule ${m} ajouté.`,
    () => setValue(''),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = value.trim();
    if (m) add.mutate(m);
  };
  return (
    <Stack gap={8}>
      <MatriculesList matricules={p.matricules} />
      <form onSubmit={submit} className="ref-add">
        <TextInput
          aria-label="Nouveau matricule"
          placeholder="Code PDC (R_001) ou matricule (A12345)"
          value={value}
          onChange={setValue}
        />
        <Button type="submit" icon={<IconPlus size={15} />} disabled={!value.trim()} loading={add.isPending}>
          Ajouter
        </Button>
      </form>
    </Stack>
  );
}

// ------------------------------------------------------------------ Alias

function AliasSection({ personne: p }: { personne: Personne }) {
  const [value, setValue] = useState('');
  const add = usePersonneMutation(
    (a: string) => referentielApi.addAlias(p.id, a),
    (_, a) => `Alias « ${a} » ajouté.`,
    () => setValue(''),
  );
  const remove = usePersonneMutation(
    (aliasId: number) => referentielApi.deleteAlias(p.id, aliasId),
    () => 'Alias supprimé.',
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = value.trim();
    if (a) add.mutate(a);
  };
  return (
    <Stack gap={8}>
      <AliasTable
        personne={p}
        actions={(a) => (
          <IconButton
            destructive
            size="sm"
            label={`Supprimer l'alias ${a.alias}`}
            loading={remove.isPending && remove.variables === a.id}
            onClick={() => remove.mutate(a.id)}
          >
            <IconTrash size={15} />
          </IconButton>
        )}
      />
      <form onSubmit={submit} className="ref-add">
        <TextInput aria-label="Nouvel alias" placeholder="Variante de nom (ex. dans le Réalisé)" value={value} onChange={setValue} />
        <Button type="submit" icon={<IconPlus size={15} />} disabled={!value.trim()} loading={add.isPending}>
          Ajouter
        </Button>
      </form>
    </Stack>
  );
}

// ------------------------------------------------------------------ Fusion

function MergeSection({ personne: p, onMerged }: { personne: Personne; onMerged: (id: string) => void }) {
  const qc = useQueryClient();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Liste complète (sans filtre) pour choisir la fiche cible.
  const all = useQuery({ queryKey: qk.personnes(''), queryFn: () => referentielApi.personnes() });
  const options = useMemo(
    () =>
      (all.data ?? [])
        .filter((o) => o.id !== p.id)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'))
        .map((o) => ({
          value: o.id,
          label: o.matricules?.length ? `${o.display_name} (${o.matricules.join(', ')})` : o.display_name,
        })),
    [all.data, p.id],
  );
  const target = all.data?.find((o) => o.id === targetId);

  const merge = useMutation({
    mutationFn: (intoId: string) => referentielApi.merge(p.id, intoId),
    onSuccess: (cible) => {
      qc.setQueryData(personneKey(cible.id), cible);
      setConfirmOpen(false);
      onMerged(cible.id);
      // La fiche source n'existe plus : on la retire du cache au lieu de la recharger (404).
      void qc.cancelQueries({ queryKey: personneKey(p.id) });
      qc.removeQueries({ queryKey: personneKey(p.id) });
      void qc.invalidateQueries({
        queryKey: ['personnes'],
        predicate: (query) => !(query.queryKey[1] === 'id' && query.queryKey[2] === p.id),
      });
      void qc.invalidateQueries({ queryKey: ['analyse'] });
      void qc.invalidateQueries({ queryKey: ['plan-lines'] });
      notifySuccess(`« ${p.display_name} » a été rattachée à « ${cible.display_name} ».`);
    },
    onError: (e) => notifyError(e, 'Fusion impossible'),
  });

  return (
    <Stack gap={8}>
      <p className="ref-help">Doublon d'une fiche existante ? Rattachez-la : tout est transféré, puis cette fiche est supprimée.</p>
      <ErrorAlert error={all.error} />
      <Select
        width="100%"
        aria-label="Fiche cible"
        placeholder={all.isLoading ? 'Chargement…' : 'Choisir la fiche existante'}
        data={options}
        value={targetId}
        onChange={setTargetId}
        searchable
        clearable
        menuWidth={290}
        nothingFound="Aucune personne"
      />
      <Group justify="end">
        <Button icon={<IconMerge size={15} />} disabled={!targetId} onClick={() => setConfirmOpen(true)}>
          Rattacher…
        </Button>
      </Group>

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmer le rattachement"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Annuler</Button>
            <Button variant="primary" destructive loading={merge.isPending} onClick={() => targetId && merge.mutate(targetId)}>
              Rattacher
            </Button>
          </>
        }
      >
        <Stack gap={12}>
          <Text>
            La fiche <strong>{p.display_name}</strong> va être fusionnée dans <strong>{target?.display_name ?? targetId}</strong>.
          </Text>
          <Banner tone="warning" compact>
            Matricules, alias et lignes de plan seront transférés vers la fiche cible, puis « {p.display_name} » sera
            supprimée. Cette opération est irréversible.
          </Banner>
        </Stack>
      </Modal>
    </Stack>
  );
}
