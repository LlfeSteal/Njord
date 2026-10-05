// Fiche personne (drawer) : identité, matricules, alias, fusion vers une fiche existante (§6.2).
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Divider,
  Drawer,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconGitMerge, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import type { Personne } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import {
  notifyError,
  notifySuccess,
  personneKey,
  usePersonneMutation,
  useSquadIndex,
} from './hooks';
import { AliasTable, MatriculesList, PersonneStatutBadge } from './shared';

interface Props {
  personneId: string | null;
  onClose: () => void;
  /** Ouvre une autre fiche (après fusion : la fiche cible). */
  onSwitch: (id: string) => void;
}

export default function PersonneDrawer({ personneId, onClose, onSwitch }: Props) {
  const q = useQuery({
    queryKey: personneKey(personneId ?? ''),
    queryFn: () => referentielApi.personne(personneId!),
    enabled: !!personneId,
  });
  const p = q.data;
  return (
    <Drawer
      opened={!!personneId}
      onClose={onClose}
      position="right"
      size="lg"
      title={
        p ? (
          <Group gap="xs">
            <Title order={4}>{p.display_name}</Title>
            <PersonneStatutBadge statut={p.statut} />
          </Group>
        ) : (
          'Fiche personne'
        )
      }
    >
      {q.isLoading && (
        <Center py="xl">
          <Loader />
        </Center>
      )}
      <ErrorAlert error={q.error} title="Fiche introuvable" />
      {p && <PersonneDetail key={p.id} personne={p} onSwitch={onSwitch} />}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Divider label={title} labelPosition="left" />
      {children}
    </Stack>
  );
}

function PersonneDetail({ personne: p, onSwitch }: { personne: Personne; onSwitch: (id: string) => void }) {
  const squads = useSquadIndex();
  return (
    <Stack gap="lg">
      <Text size="xs" c="dimmed">
        Nom normalisé : <span style={{ fontFamily: 'monospace' }}>{p.nom_normalise || '—'}</span> · créée le{' '}
        {fmtDateTime(p.created_at)}
      </Text>
      <Section title="Identité">
        <IdentityForm personne={p} squadOptions={squads.options} />
      </Section>
      <Section title="Matricules">
        <MatriculesSection personne={p} />
      </Section>
      <Section title="Alias">
        <AliasSection personne={p} />
      </Section>
      <Section title="Rattacher à une fiche existante">
        <MergeSection personne={p} onMerged={onSwitch} />
      </Section>
    </Stack>
  );
}

// ------------------------------------------------------------------ Identité

function IdentityForm({
  personne: p,
  squadOptions,
}: {
  personne: Personne;
  squadOptions: { value: string; label: string }[];
}) {
  const [name, setName] = useState(p.display_name);
  const [statut, setStatut] = useState<Personne['statut']>(p.statut);
  const [squadId, setSquadId] = useState<string | null>(p.squad_id);

  const body: Parameters<typeof referentielApi.updatePersonne>[1] = {};
  if (name.trim() !== p.display_name) body.display_name = name.trim();
  if (statut !== p.statut) body.statut = statut;
  if (squadId !== p.squad_id) body.squad_id = squadId;
  const dirty = Object.keys(body).length > 0;

  const save = usePersonneMutation(
    (b: typeof body) => referentielApi.updatePersonne(p.id, b),
    () => 'Fiche enregistrée.',
  );

  const options = useMemo(() => {
    // Squad courant inconnu de la liste (ex. pas encore chargée) : on l'affiche par son id.
    if (squadId && !squadOptions.some((o) => o.value === squadId)) return [...squadOptions, { value: squadId, label: squadId }];
    return squadOptions;
  }, [squadOptions, squadId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && name.trim()) save.mutate(body);
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="xs">
        <TextInput
          label="Nom affiché"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          error={!name.trim() ? 'Nom requis' : undefined}
        />
        <Group grow align="flex-start">
          <Select
            label="Statut"
            allowDeselect={false}
            data={[
              { value: 'brouillon', label: 'Brouillon' },
              { value: 'validee', label: 'Validée' },
            ]}
            value={statut}
            onChange={(v) => v && setStatut(v as Personne['statut'])}
          />
          <Select
            label="Squad"
            placeholder="Aucune"
            data={options}
            value={squadId}
            onChange={setSquadId}
            searchable
            clearable
            nothingFoundMessage="Aucune squad"
          />
        </Group>
        <Group justify="flex-end">
          <Button
            variant="default"
            size="xs"
            disabled={!dirty}
            onClick={() => {
              setName(p.display_name);
              setStatut(p.statut);
              setSquadId(p.squad_id);
            }}
          >
            Annuler
          </Button>
          <Button type="submit" size="xs" disabled={!dirty || !name.trim()} loading={save.isPending}>
            Enregistrer
          </Button>
        </Group>
      </Stack>
    </form>
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
    <Stack gap="xs">
      <MatriculesList matricules={p.matricules} />
      <form onSubmit={submit}>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            aria-label="Nouveau matricule"
            placeholder="Code ressource PDC (R_001) ou matricule Réalisé (A12345)"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          <Button type="submit" size="xs" leftSection={<IconPlus size={14} />} disabled={!value.trim()} loading={add.isPending}>
            Ajouter
          </Button>
        </Group>
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
    <Stack gap="xs">
      <AliasTable
        personne={p}
        actions={(a) => (
          <Tooltip label="Supprimer l'alias" withArrow>
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              aria-label={`Supprimer l'alias ${a.alias}`}
              loading={remove.isPending && remove.variables === a.id}
              onClick={() => remove.mutate(a.id)}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      />
      <form onSubmit={submit}>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            aria-label="Nouvel alias"
            placeholder="Variante de nom (ex. telle qu'écrite dans le Réalisé)"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          <Button type="submit" size="xs" leftSection={<IconPlus size={14} />} disabled={!value.trim()} loading={add.isPending}>
            Ajouter
          </Button>
        </Group>
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
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        Si cette fiche est un doublon d'une personne existante, rattachez-la : ses matricules, alias et lignes de plan
        sont transférés vers la fiche choisie, puis cette fiche est supprimée.
      </Text>
      <ErrorAlert error={all.error} />
      <Group gap="xs" align="flex-end">
        <Select
          style={{ flex: 1 }}
          size="xs"
          aria-label="Fiche cible"
          placeholder={all.isLoading ? 'Chargement…' : 'Choisir la fiche existante'}
          data={options}
          value={targetId}
          onChange={setTargetId}
          searchable
          clearable
          limit={100}
          nothingFoundMessage="Aucune personne"
        />
        <Button
          size="xs"
          color="orange"
          leftSection={<IconGitMerge size={14} />}
          disabled={!targetId}
          onClick={() => setConfirmOpen(true)}
        >
          Rattacher…
        </Button>
      </Group>

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmer le rattachement"
        zIndex={400}
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            La fiche <b>{p.display_name}</b> va être fusionnée dans <b>{target?.display_name ?? targetId}</b>.
          </Text>
          <Alert color="orange" variant="light">
            Matricules, alias et lignes de plan seront transférés vers la fiche cible, puis « {p.display_name} » sera
            supprimée. Cette opération est irréversible.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button color="orange" loading={merge.isPending} onClick={() => targetId && merge.mutate(targetId)}>
              Rattacher
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
