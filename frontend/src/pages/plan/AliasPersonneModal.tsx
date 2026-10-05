// Création manuelle d'un alias personne depuis une ligne de plan (§7.3 « Actions »).
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Button, Divider, Group, Loader, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import type { PlanLine } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { normalizeName, personneKey, usePersonneMutation } from '../referentiels/hooks';
import { AliasTable, MatriculesList, PersonneStatutBadge } from '../referentiels/shared';

/** Libellé « <Squad> / <Prénom NOM> » → partie personne ; sinon libellé tel quel. */
function suggestAlias(l: PlanLine): string {
  const lib = l.libelle.trim();
  const i = lib.lastIndexOf(' / ');
  return i >= 0 ? lib.slice(i + 3).trim() : lib;
}

export default function AliasPersonneModal({ line, onClose }: { line: PlanLine | null; onClose: () => void }) {
  const personneId = line?.personne_id ?? null;
  const q = useQuery({
    queryKey: personneKey(personneId ?? ''),
    queryFn: () => referentielApi.personne(personneId!),
    enabled: !!personneId,
  });
  const [alias, setAlias] = useState('');
  useEffect(() => {
    if (line) setAlias(suggestAlias(line));
  }, [line]);

  const add = usePersonneMutation(
    (a: string) => referentielApi.addAlias(personneId!, a),
    (p, a) => `Alias « ${a} » ajouté à ${p.display_name}.`,
    () => onClose(),
  );

  const p = q.data;
  const duplicate = useMemo(() => {
    const n = normalizeName(alias);
    if (!p || !n) return false;
    return (p.alias ?? []).some((a) => a.alias_normalise === n || normalizeName(a.alias) === n);
  }, [alias, p]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = alias.trim();
    if (a && personneId) add.mutate(a);
  };

  return (
    <Modal opened={!!line} onClose={onClose} title="Créer un alias personne" size="lg">
      {line && (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Ligne {line.row_num} · {line.ct} · <span style={{ fontFamily: 'monospace' }}>{line.ressource}</span>
            {line.libelle ? ` · ${line.libelle}` : ''}
          </Text>
          {q.isLoading && <Loader size="sm" />}
          <ErrorAlert error={q.error} title="Fiche personne introuvable" />
          {p && (
            <>
              <Group justify="space-between">
                <Group gap="xs">
                  <Text fw={600}>{p.display_name}</Text>
                  <PersonneStatutBadge statut={p.statut} />
                </Group>
                <Anchor component={Link} to={`/referentiels?personne=${encodeURIComponent(p.id)}`} size="sm">
                  <Group gap={4}>
                    Ouvrir la fiche <IconExternalLink size={14} />
                  </Group>
                </Anchor>
              </Group>
              <div>
                <Text size="xs" c="dimmed" mb={4}>
                  Matricules
                </Text>
                <MatriculesList matricules={p.matricules} />
              </div>
              <div>
                <Text size="xs" c="dimmed" mb={4}>
                  Alias existants
                </Text>
                <AliasTable personne={p} />
              </div>
              <Divider />
              <form onSubmit={submit}>
                <Stack gap="xs">
                  <TextInput
                    label="Nouvel alias"
                    description="Variante de nom utilisée dans le Réalisé ou le plan (rapprochement de confiance « alias »)."
                    value={alias}
                    onChange={(e) => setAlias(e.currentTarget.value)}
                    required
                    data-autofocus
                  />
                  {duplicate && (
                    <Alert color="yellow" variant="light" p="xs">
                      Un alias équivalent semble déjà exister pour cette personne.
                    </Alert>
                  )}
                  <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                      Annuler
                    </Button>
                    <Button type="submit" loading={add.isPending} disabled={!alias.trim()}>
                      Ajouter l'alias
                    </Button>
                  </Group>
                </Stack>
              </form>
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}
