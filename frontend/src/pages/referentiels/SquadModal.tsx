// Création / édition d'une squad (nom, entité, parent) + ajout d'alias (§6.1). Actions en pied de fenêtre.
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Pill, Select, Stack, Text, TextInput } from '../../ui';
import { IconPlus } from '../../ui/Icons';
import { referentielApi } from '../../api/client';
import type { Squad } from '../../api/types';
import { descendantIds, flattenSquads, invalidateReferentiels, notifyError, notifySuccess } from './hooks';
import './referentiels.css';

const FORM_ID = 'squad-form';

interface Props {
  /** null = fermée, 'new' = création, sinon id du squad édité. */
  editing: string | null;
  squads: Squad[];
  onClose: () => void;
  /** Après création : la modale bascule en édition (pour ajouter des alias). */
  onCreated: (s: Squad) => void;
}

interface Draft {
  nom: string;
  entite: string;
  parentId: string | null;
}

const draftOf = (s: Squad | null): Draft => ({
  nom: s?.nom_canonique ?? '',
  entite: s?.entite_rattachee ?? '',
  parentId: s?.parent_id ?? null,
});

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
  // Squad tout juste créée : utilisée tant que la liste rechargée ne la contient pas encore.
  const [created, setCreated] = useState<Squad | null>(null);
  const squad =
    editing && editing !== 'new'
      ? (squads.find((s) => s.id === editing) ?? (created?.id === editing ? created : null))
      : null;

  // Brouillon réinitialisé à chaque changement de squad éditée (ajustement pendant le rendu).
  const [draft, setDraft] = useState<Draft>(() => draftOf(squad));
  const [draftFor, setDraftFor] = useState(editing);
  if (draftFor !== editing) {
    setDraftFor(editing);
    setDraft(draftOf(squad));
  }
  const { nom, entite, parentId } = draft;
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

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
    (s) => {
      setCreated(s);
      onCreated(s);
    },
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
    <Modal
      opened={editing !== null}
      onClose={onClose}
      title={squad ? `Squad « ${squad.nom_canonique} »` : 'Nouvelle squad'}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{squad ? 'Fermer' : 'Annuler'}</Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            disabled={!dirty || !nom.trim()}
            loading={create.isPending || update.isPending}
          >
            {squad ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <Stack gap={16}>
        <form id={FORM_ID} onSubmit={submit}>
          <Stack gap={8}>
            <TextInput label="Nom canonique" value={nom} onChange={(v) => patch({ nom: v })} required autoFocus />
            <TextInput label="Entité rattachée" placeholder="Optionnel" value={entite} onChange={(v) => patch({ entite: v })} />
            <Select
              label="Squad parente"
              placeholder="Aucune (racine)"
              data={parentOptions}
              value={parentId}
              onChange={(v) => patch({ parentId: v })}
              searchable
              clearable
              nothingFound="Aucune squad"
            />
          </Stack>
        </form>
        {squad && <SquadAliasSection squad={squad} />}
      </Stack>
    </Modal>
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
    <Stack gap={8}>
      <Text size="sm" weight={500} tone="secondary">
        Alias
      </Text>
      {alias.length ? (
        <div className="ref-pills">
          {alias.map((a) => (
            <Pill key={a}>{a}</Pill>
          ))}
        </div>
      ) : (
        <Text tone="secondary">Aucun alias.</Text>
      )}
      <form onSubmit={submit} className="ref-add">
        <TextInput
          aria-label="Nouvel alias de squad"
          placeholder="Variante du nom vue dans les fichiers"
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
