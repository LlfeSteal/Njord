// Sous-onglet Correspondances (§5) : rapprochement nom réalisé ↔ personne du plan, confirmation des alias fuzzy.
import { useMemo, useState } from 'react';
import { Banner, Button, Group, Link, SearchField, SegmentedControl, Stack, Table, Text, toast, type SegmentOption } from '../../ui';
import { IconCheck } from '../../ui/Icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AnalyseResult, Confidence, Correspondance } from '../../api/types';
import { FlagBadge } from '../../components/badges';
import { fmtHours } from '../../lib/format';
import { ConfidenceBadge, FuzzyMark, SortTh } from './common';
import { CONFIDENCE_META, cmp, useSort } from './helpers';
import { analyseService } from './service';

type Key = 'nom_realise' | 'personne_nom' | 'confidence' | 'nb_ecritures' | 'heures';
const CONF_ORDER: Record<Confidence, number> = { fuzzy: 5, none: 4, alias: 3, matricule: 2, plan: 1 };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export default function CorrespondancesTab({ result }: { result: AnalyseResult }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | Confidence>('all');
  const [q, setQ] = useState('');
  const { sort, toggle } = useSort<Key>({ key: 'confidence', dir: 'desc' });
  const [pending, setPending] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: (c: Correspondance) => analyseService.confirmAlias(c.personne_id!, c.nom_realise),
    onMutate: (c) => setPending(c.nom_realise),
    onSuccess: (_p, c) => {
      toast({
        tone: 'success',
        title: 'Alias confirmé',
        message: `« ${c.nom_realise} » est désormais un alias de ${c.personne_nom}.`,
      });
      qc.invalidateQueries({ queryKey: ['analyse'] });
      qc.invalidateQueries({ queryKey: ['personnes'] });
    },
    onError: (err) =>
      toast({ tone: 'error', title: 'Confirmation impossible', message: err instanceof Error ? err.message : String(err) }),
    onSettled: () => setPending(null),
  });

  const counts = useMemo(() => {
    const c: Partial<Record<Confidence, number>> = {};
    for (const x of result.correspondances) c[x.confidence] = (c[x.confidence] ?? 0) + 1;
    return c;
  }, [result.correspondances]);

  const rows = useMemo(() => {
    const nq = norm(q.trim());
    const list = result.correspondances.filter(
      (c) =>
        (filter === 'all' || c.confidence === filter) &&
        (!nq || norm(`${c.nom_realise} ${c.personne_nom} ${c.ressource}`).includes(nq)),
    );
    const val = (c: Correspondance): string | number => (sort.key === 'confidence' ? CONF_ORDER[c.confidence] : c[sort.key]);
    return list.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * cmp(val(a), val(b)) || b.heures - a.heures);
  }, [result.correspondances, filter, q, sort]);

  const segData: SegmentOption<'all' | Confidence>[] = [
    { value: 'all', label: 'Toutes', count: result.correspondances.length },
    ...(['fuzzy', 'none', 'alias', 'matricule', 'plan'] as Confidence[])
      .filter((c) => counts[c])
      .map((c) => ({ value: c, label: CONFIDENCE_META[c].label.replace(' *', ''), count: counts[c] })),
  ];

  return (
    <Stack gap={12}>
      {(counts.fuzzy ?? 0) > 0 && (
        <Banner tone="warning">
          {counts.fuzzy} correspondance{(counts.fuzzy ?? 0) > 1 ? 's' : ''} approximative{(counts.fuzzy ?? 0) > 1 ? 's' : ''} (nom
          normalisé). Confirmez-les pour alimenter les alias du référentiel Personne : elles seront ensuite rapprochées avec
          certitude.
        </Banner>
      )}
      <Group justify="between" gap={8}>
        <SegmentedControl
          aria-label="Filtrer par confiance"
          equal={false}
          data={segData}
          value={filter}
          onChange={setFilter}
        />
        <SearchField
          placeholder="Rechercher un nom…"
          value={q}
          onChange={setQ}
          width={260}
          aria-label="Rechercher une correspondance"
        />
      </Group>

      {rows.length === 0 ? (
        <Text tone="secondary" align="center" mt={24} mb={24}>
          Aucune correspondance.
        </Text>
      ) : (
        <Table striped hover minWidth={860}>
          <thead>
            <tr>
              <SortTh k="nom_realise" sort={sort} onSort={toggle}>
                Nom au réalisé
              </SortTh>
              <SortTh k="personne_nom" sort={sort} onSort={toggle}>
                Personne / ressource rapprochée
              </SortTh>
              <SortTh k="confidence" sort={sort} onSort={toggle}>
                Confiance
              </SortTh>
              <SortTh k="nb_ecritures" sort={sort} onSort={toggle} align="right">
                Écritures
              </SortTh>
              <SortTh k="heures" sort={sort} onSort={toggle} align="right">
                Heures
              </SortTh>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.nom_normalise}|${c.personne_id ?? ''}`}>
                <td>
                  <Text>
                    {c.nom_realise || '—'}
                    {c.confidence === 'fuzzy' && (
                      <>
                        {' '}
                        <FuzzyMark />
                      </>
                    )}
                  </Text>
                  {c.nom_normalise && (
                    <Text size="sm" tone="secondary" mono>
                      {c.nom_normalise}
                    </Text>
                  )}
                </td>
                <td>
                  {c.personne_id ? (
                    <>
                      <Text>{c.personne_nom}</Text>
                      {c.ressource && (
                        <Text size="sm" tone="secondary" mono>
                          {c.ressource}
                        </Text>
                      )}
                    </>
                  ) : (
                    <FlagBadge flag="hors_plan" />
                  )}
                </td>
                <td>
                  <ConfidenceBadge confidence={c.confidence} />
                </td>
                <td data-align="right">{c.nb_ecritures}</td>
                <td data-align="right">{fmtHours(c.heures)}</td>
                <td data-nowrap>
                  {c.confidence === 'fuzzy' && c.personne_id ? (
                    <Button
                      size="sm"
                      icon={<IconCheck size={14} />}
                      loading={pending === c.nom_realise}
                      disabled={confirm.isPending && pending !== c.nom_realise}
                      onClick={() => confirm.mutate(c)}
                    >
                      Confirmer cet alias
                    </Button>
                  ) : c.confidence === 'none' ? (
                    <Link to="/referentiels">Créer un alias dans les référentiels</Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Stack>
  );
}
