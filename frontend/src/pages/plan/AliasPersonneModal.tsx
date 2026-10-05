// Création manuelle d'un alias personne depuis une ligne de plan (§7.3 « Actions »).
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banner, Button, Divider, Group, Link, LoadingBlock, Modal, Stack, Text, TextInput } from '../../ui';
import { IconExternalLink } from '../../ui/Icons';
import { useQuery } from '@tanstack/react-query';
import { referentielApi } from '../../api/client';
import type { PlanLine } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { normalizeName, personneKey, usePersonneMutation } from '../referentiels/hooks';
import { AliasTable, MatriculesList, PersonneStatutBadge } from '../referentiels/shared';

/** Libellé « <Squad> / <Prénom NOM> » → partie personne ; sinon libellé tel quel. */
const FORM_ID = 'alias-personne-form';

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
    <Modal
      opened={!!line}
      onClose={onClose}
      title="Créer un alias personne"
      size="lg"
      footer={
        p && (
          <>
            <Button onClick={onClose}>Annuler</Button>
            <Button type="submit" form={FORM_ID} variant="primary" loading={add.isPending} disabled={!alias.trim()}>
              Ajouter l'alias
            </Button>
          </>
        )
      }
    >
      {line && (
        <Stack gap={12}>
          <Text size="sm" tone="secondary">
            Ligne {line.row_num} · {line.ct} ·{' '}
            <Text as="span" mono>
              {line.ressource}
            </Text>
            {line.libelle ? ` · ${line.libelle}` : ''}
          </Text>
          {q.isLoading && <LoadingBlock />}
          <ErrorAlert error={q.error} title="Fiche personne introuvable" />
          {p && (
            <>
              <Group justify="between">
                <Group gap={8}>
                  <Text weight={600}>{p.display_name}</Text>
                  <PersonneStatutBadge statut={p.statut} />
                </Group>
                <Link to={`/referentiels?personne=${encodeURIComponent(p.id)}`} size="sm">
                  <Group gap={4} wrap={false}>
                    Ouvrir la fiche <IconExternalLink size={13} />
                  </Group>
                </Link>
              </Group>
              <div>
                <Text size="sm" tone="secondary" mb={4}>
                  Matricules
                </Text>
                <MatriculesList matricules={p.matricules} />
              </div>
              <div>
                <Text size="sm" tone="secondary" mb={4}>
                  Alias existants
                </Text>
                <AliasTable personne={p} />
              </div>
              <Divider />
              <form id={FORM_ID} onSubmit={submit}>
                <Stack gap={8}>
                  <TextInput
                    label="Nouvel alias"
                    description="Variante de nom utilisée dans le Réalisé ou le plan (rapprochement de confiance « alias »)."
                    value={alias}
                    onChange={setAlias}
                    required
                    autoFocus
                  />
                  {duplicate && (
                    <Banner tone="warning" compact>
                      Un alias équivalent semble déjà exister pour cette personne.
                    </Banner>
                  )}
                </Stack>
              </form>
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}
