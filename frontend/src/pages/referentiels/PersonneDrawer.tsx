// Fiche personne (panneau latéral) : identité, matricules, alias, fusion vers une fiche existante (§6.2).
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Banner,
  Button,
  Group,
  IconButton,
  LoadingBlock,
  Modal,
  Select,
  Sheet,
  Stack,
  Text,
  TextInput,
  Title,
} from '../../ui';
import { IconMerge, IconPlus, IconTrash } from '../../ui/Icons';
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
    <Sheet
      opened={!!personneId}
      onClose={onClose}
      width={560}
      title={
        p ? (
          <Group gap={8} wrap={false}>
            <span>{p.display_name}</span>
            <PersonneStatutBadge statut={p.statut} />
          </Group>
        ) : (
          'Fiche personne'
        )
      }
    >
      {q.isLoading && <LoadingBlock />}
      <ErrorAlert error={q.error} title="Fiche introuvable" />
      {p && <PersonneDetail key={p.id} personne={p} onSwitch={onSwitch} />}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={8}>
      <Title order={4}>{title}</Title>
      {children}
    </Stack>
  );
}

function PersonneDetail({ personne: p, onSwitch }: { personne: Personne; onSwitch: (id: string) => void }) {
  const squads = useSquadIndex();
  return (
    <Stack gap={24}>
      <Text size="sm" tone="secondary">
        Nom normalisé :{' '}
        <Text as="span" mono>
          {p.nom_normalise || '—'}
        </Text>{' '}
        · créée le {fmtDateTime(p.created_at)}
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
      <Stack gap={8}>
        <TextInput
          label="Nom affiché"
          value={name}
          onChange={setName}
          required
          error={!name.trim() ? 'Nom requis' : undefined}
        />
        <Group grow align="start" gap={8}>
          <Select<Personne['statut']>
            label="Statut"
            data={[
              { value: 'brouillon', label: 'Brouillon' },
              { value: 'validee', label: 'Validée' },
            ]}
            value={statut}
            onChange={(v) => v && setStatut(v)}
          />
          <Select
            label="Squad"
            placeholder="Aucune"
            data={options}
            value={squadId}
            onChange={setSquadId}
            searchable
            clearable
            nothingFound="Aucune squad"
          />
        </Group>
        <Group justify="end" gap={8}>
          <Button
            disabled={!dirty}
            onClick={() => {
              setName(p.display_name);
              setStatut(p.statut);
              setSquadId(p.squad_id);
            }}
          >
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={!dirty || !name.trim()} loading={save.isPending}>
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
    <Stack gap={8}>
      <MatriculesList matricules={p.matricules} />
      <form onSubmit={submit}>
        <Group gap={8} align="end" wrap={false}>
          <div style={{ flex: 1 }}>
            <TextInput
              aria-label="Nouveau matricule"
              placeholder="Code ressource PDC (R_001) ou matricule Réalisé (A12345)"
              value={value}
              onChange={setValue}
            />
          </div>
          <Button type="submit" icon={<IconPlus size={15} />} disabled={!value.trim()} loading={add.isPending}>
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
      <form onSubmit={submit}>
        <Group gap={8} align="end" wrap={false}>
          <div style={{ flex: 1 }}>
            <TextInput
              aria-label="Nouvel alias"
              placeholder="Variante de nom (ex. telle qu'écrite dans le Réalisé)"
              value={value}
              onChange={setValue}
            />
          </div>
          <Button type="submit" icon={<IconPlus size={15} />} disabled={!value.trim()} loading={add.isPending}>
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
    <Stack gap={8}>
      <Text size="sm" tone="secondary">
        Si cette fiche est un doublon d'une personne existante, rattachez-la : ses matricules, alias et lignes de plan
        sont transférés vers la fiche choisie, puis cette fiche est supprimée.
      </Text>
      <ErrorAlert error={all.error} />
      <Group gap={8} align="end" wrap={false}>
        <div style={{ flex: 1 }}>
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
        </div>
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
            <Button
              variant="primary"
              destructive
              loading={merge.isPending}
              onClick={() => targetId && merge.mutate(targetId)}
            >
              Rattacher
            </Button>
          </>
        }
      >
        <Stack gap={12}>
          <Text>
            La fiche <strong>{p.display_name}</strong> va être fusionnée dans{' '}
            <strong>{target?.display_name ?? targetId}</strong>.
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
