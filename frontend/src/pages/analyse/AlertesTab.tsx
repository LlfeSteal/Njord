// Sous-onglet Alertes (§7.5) : CT à risque, alerte globale % non sécurisé, dérive de provision.
import { Alert, Anchor, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AnalyseResult } from '../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtPct } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { CtCell } from './common';
import { useDrillDown, useTabLink } from './params';
import { analyseService } from './service';

export default function AlertesTab({ result }: { result: AnalyseResult }) {
  const { alertes } = result;
  const drill = useDrillDown();
  const tabLink = useTabLink();
  // Seuils affichés à titre indicatif (le calcul est fait côté serveur).
  const settingsQ = useQuery({ queryKey: qk.settings(), queryFn: analyseService.settings, retry: false });
  const s = settingsQ.data;

  return (
    <Stack gap="lg">
      {alertes.alerte_globale ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="Alerte globale : part non sécurisée trop élevée">
          {fmtPct(alertes.pct_non_securise)} du budget classé est non sécurisé
          {s ? ` (seuil : ${fmtPct(s.seuil_non_securise_pct)})` : ''}.
        </Alert>
      ) : (
        <Alert color="green" variant="light" icon={<IconCircleCheck size={18} />} title="Part non sécurisée sous le seuil">
          {fmtPct(alertes.pct_non_securise)} du budget classé est non sécurisé
          {s ? ` (seuil : ${fmtPct(s.seuil_non_securise_pct)})` : ''}.
        </Alert>
      )}

      <Card withBorder radius="md" padding="md">
        <Group justify="space-between" mb={2}>
          <Title order={4}>CT à risque ({alertes.ct_risque.length})</Title>
        </Group>
        <Text size="xs" c="dimmed" mb="xs">
          TG dont Σ € non sécurisé dépasse {s ? fmtEur(s.seuil_ct_risque_eur) : 'le seuil paramétré'}.
        </Text>
        {alertes.ct_risque.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucun CT à risque.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
            <Table highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>CT</Table.Th>
                  <Table.Th ta="right">⚠️ Non sécurisé</Table.Th>
                  <Table.Th>Drill-down</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...alertes.ct_risque]
                  .sort((a, b) => b.non_securise - a.non_securise)
                  .map((a) => (
                    <Table.Tr key={a.ct}>
                      <Table.Td>
                        <CtCell ct={a.ct} libelle={a.ct_libelle} />
                      </Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {fmtEur(a.non_securise)}
                      </Table.Td>
                      <Table.Td>
                        <Group gap="md">
                          <Anchor component="button" type="button" size="sm" onClick={() => drill({ ct: a.ct })}>
                            Écarts
                          </Anchor>
                          <Anchor component={Link} to={tabLink('budget')} size="sm">
                            Budget
                          </Anchor>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Card withBorder radius="md" padding="md">
        <Title order={4} mb={2}>
          Dérive de provision ({alertes.derive_provision.length})
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          Consommations de PROVISIONS POUR ALEAS ou écritures sans ressource identifiée sur un CT provisionné.
        </Text>
        {alertes.derive_provision.length === 0 ? (
          <Text size="sm" c="dimmed">
            Aucune dérive détectée.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover fz="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>CT</Table.Th>
                  <Table.Th ta="right">Ligne</Table.Th>
                  <Table.Th>Employé / fournisseur</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Date dépense</Table.Th>
                  <Table.Th ta="right">Heures</Table.Th>
                  <Table.Th ta="right">€</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {alertes.derive_provision.map((d) => (
                  <Table.Tr key={`${d.ct}|${d.row_num}`}>
                    <Table.Td>
                      <Anchor component="button" type="button" size="sm" ff="monospace" onClick={() => drill({ ct: d.ct })}>
                        {d.ct}
                      </Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{d.row_num}</Table.Td>
                    <Table.Td>{d.employe_fournisseur || <Text span c="dimmed">—</Text>}</Table.Td>
                    <Table.Td>{d.type}</Table.Td>
                    <Table.Td>{fmtDate(d.date_depense)}</Table.Td>
                    <Table.Td ta="right">{d.heures ? fmtHours(d.heures) : '—'}</Table.Td>
                    <Table.Td ta="right">{d.eur ? fmtEur(d.eur, true) : '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  );
}
