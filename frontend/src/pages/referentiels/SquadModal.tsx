// Création / édition d'une squad (nom, entité, parent) + ajout d'alias (§6.1).
import { useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Divider, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import type { Squad } from '../../api/types';
import { descendantIds, flattenSquads, invalidateReferentiels, notifyError, notifySuccess } from './hooks';

interface Props {
  /** null = fermée, 'new' = création, sinon id du squad édité. */
  editing: string | null;
  squads: Squad[];
  onClose: () => void;
  /** Après création : la modale bascule en édition (pour ajouter des alias). */
  onCreated: (s: Squad) => void;
}

function useSquadMutation<V>(fn: (v: V) => Promise<Squad>, success: (s: Squad, v: V) => string, onDone?: (s: Squad) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (s, v) => {
      invalidateReferentiels(qc, { squads: true });
      notifySuccess(success(s, v));
      onDone?.(s);
    },
    onError: (e) => notifyError(e),
  });
}

export default function SquadModal({ editing, squads, onClose, onCreated }: Props) {
  const squad = editing && editing !== 'new' ? (squads.find((s) => s.id === editing) ?? null) : null;
  return (
    <Modal
      opened={editing !== null}
      onClose={onClose}
      title={squad ? `Squad « ${squad.nom_canonique} »` : 'Nouvelle squad'}
      size="lg"
    >
      {editing !== null && (
        <Stack gap="md">
          <SquadForm key={editing} squad={squad} squads={squads} onClose={onClose} onCreated={onCreated} />
          {squad && <SquadAliasSection squad={squad} />}
        </Stack>
      )}
    </Modal>
  );
}

function SquadForm({
  squad,
  squads,
  onClose,
  onCreated,
}: {
  squad: Squad | null;
  squads: Squad[];
  onClose: () => void;
  onCreated: (s: Squad) => void;
}) {
  const [nom, setNom] = useState(squad?.nom_canonique ?? '');
  const [entite, setEntite] = useState(squad?.entite_rattachee ?? '');
  const [parentId, setParentId] = useState<string | null>(squad?.parent_id ?? null);

  // Parent possible : tout squad sauf lui-même et ses descendants (pas de cycle).
  const parentOptions = useMemo(() => {
    const excluded = squad ? descendantIds(squads, squad.id).add(squad.id) : new Set<string>();
    return flattenSquads(squads)
      .filter((n) => !excluded.has(n.squad.id))
      .map((n) => ({ value: n.squad.id, label: n.path }));
  }, [squads, squad]);

  const create = useSquadMutation(
    (b: Parameters<typeof referentielApi.createSquad>[0]) => referentielApi.createSquad(b),
    (s) => `Squad « ${s.nom_canonique} » créée — vous pouvez lui ajouter des alias.`,
    onCreated,
  );
  const update = useSquadMutation(
    (b: Parameters<typeof referentielApi.updateSquad>[1]) => referentielApi.updateSquad(squad!.id, b),
    (s) => `Squad « ${s.nom_canonique} » enregistrée.`,
    onClose,
  );

  const body: Parameters<typeof referentielApi.updateSquad>[1] = {};
  if (squad) {
    if (nom.trim() !== squad.nom_canonique) body.nom_canonique = nom.trim();
    if (entite.trim() !== (squad.entite_rattachee ?? '')) body.entite_rattachee = entite.trim();
    if (parentId !== squad.parent_id) body.parent_id = parentId;
  }
  const dirty = squad ? Object.keys(body).length > 0 : !!nom.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nom.trim()) return;
    if (squad) {
      if (dirty) update.mutate(body);
    } else {
      create.mutate({ nom_canonique: nom.trim(), entite_rattachee: entite.trim() || undefined, parent_id: parentId });
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="xs">
        <TextInput
          label="Nom canonique"
          value={nom}
          onChange={(e) => setNom(e.currentTarget.value)}
          required
          data-autofocus
        />
        <TextInput
          label="Entité rattachée"
          placeholder="Optionnel"
          value={entite}
          onChange={(e) => setEntite(e.currentTarget.value)}
        />
        <Select
          label="Squad parente"
          placeholder="Aucune (racine)"
          data={parentOptions}
          value={parentId}
          onChange={setParentId}
          searchable
          clearable
          nothingFoundMessage="Aucune squad"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {squad ? 'Fermer' : 'Annuler'}
          </Button>
          <Button type="submit" disabled={!dirty || !nom.trim()} loading={create.isPending || update.isPending}>
            {squad ? 'Enregistrer' : 'Créer'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function SquadAliasSection({ squad }: { squad: Squad }) {
  const [value, setValue] = useState('');
  const add = useSquadMutation(
    (a: string) => referentielApi.addSquadAlias(squad.id, a),
    (_, a) => `Alias « ${a} » ajouté.`,
    () => setValue(''),
  );
  const alias = squad.alias ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = value.trim();
    if (a) add.mutate(a);
  };
  return (
    <Stack gap="xs">
      <Divider label="Alias" labelPosition="left" />
      {alias.length ? (
        <Group gap={4}>
          {alias.map((a) => (
            <Badge key={a} variant="light" color="gray" style={{ textTransform: 'none' }}>
              {a}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          Aucun alias.
        </Text>
      )}
      <form onSubmit={submit}>
        <Group gap="xs" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            aria-label="Nouvel alias de squad"
            placeholder="Variante du nom vue dans les fichiers"
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
