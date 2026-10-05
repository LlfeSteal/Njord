// Affichage du bilan d'import (ImportReport) : totaux, détection, spécificités plan/réalisé, motifs, issues.
import { useState, type ReactNode } from 'react';
import {
  Badge,
  Collapse,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { ImportReport } from '../../api/types';
import { fmtEur, fmtNumber, fmtPct, fmtPeriod } from '../../lib/format';
import { ParsingBadge } from '../badges';

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={color}>
        {fmtNumber(value)}
      </Text>
    </Paper>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap" align="baseline">
      <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
        {label} :
      </Text>
      <Text size="sm" fw={500}>
        {children}
      </Text>
    </Group>
  );
}

function CollapsibleList({ title, items }: { title: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Paper withBorder p="xs" radius="sm">
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={items.length === 0}
        style={{ width: '100%' }}
      >
        <Group gap={6}>
          {items.length > 0 &&
            (open ? <IconChevronDown size={16} aria-hidden /> : <IconChevronRight size={16} aria-hidden />)}
          <Text size="sm" fw={500}>
            {title}
          </Text>
          <Badge size="sm" variant="light" color={items.length ? 'indigo' : 'gray'}>
            {items.length}
          </Badge>
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <ScrollArea.Autosize mah={180} mt="xs">
          <Group gap={6}>
            {items.map((n) => (
              <Badge key={n} variant="outline" color="gray" tt="none">
                {n}
              </Badge>
            ))}
          </Group>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  );
}

const LAYOUT_LABEL: Record<string, string> = { A: 'A', B: 'B', mixte: 'mixte (A et B)' };

export default function ImportReportView({ report }: { report: ImportReport }) {
  const motifs = Object.entries(report.motifs_count ?? {}).sort((a, b) => b[1] - a[1]);
  const issues = report.issues ?? [];
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <StatCard label="Lignes" value={report.total} />
        <StatCard label="OK" value={report.ok} color="green" />
        <StatCard label="Warn" value={report.warn} color={report.warn ? 'yellow.7' : undefined} />
        <StatCard label="Drop" value={report.drop} color={report.drop ? 'red' : undefined} />
      </SimpleGrid>

      <Paper withBorder p="sm" radius="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
          <Info label="Fichier">{report.filename || '—'}</Info>
          <Info label="Intitulé">{report.intitule || '—'}</Info>
          <Info label="Onglet">{report.sheet_name || '—'}</Info>
          <Info label="Ligne d'en-tête">{report.header_row || '—'}</Info>
          <Info label="Format détecté">{report.source_format || '—'}</Info>
          <Info label="Période couverte">{fmtPeriod(report.periode_debut, report.periode_fin)}</Info>
          {report.kind === 'plan' && (
            <>
              <Info label="Layout détecté">{report.layout ? (LAYOUT_LABEL[report.layout] ?? report.layout) : '—'}</Info>
              <Info label="Ressources inactives">{fmtPct(report.pct_inactifs)}</Info>
            </>
          )}
          {report.kind === 'realise' && <Info label="Montant total">{fmtEur(report.montant_total_eur)}</Info>}
        </SimpleGrid>
      </Paper>

      {report.kind === 'plan' && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <CollapsibleList title="Nouvelles personnes" items={report.nouvelles_personnes ?? []} />
          <CollapsibleList title="Nouveaux squads" items={report.nouveaux_squads ?? []} />
        </SimpleGrid>
      )}

      {motifs.length > 0 && (
        <Stack gap={4}>
          <Text fw={600} size="sm">
            Motifs
          </Text>
          <Table.ScrollContainer minWidth={360}>
            <Table striped withTableBorder verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Motif</Table.Th>
                  <Table.Th ta="right">Occurrences</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {motifs.map(([m, n]) => (
                  <Table.Tr key={m}>
                    <Table.Td>{m}</Table.Td>
                    <Table.Td ta="right">{fmtNumber(n)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      {issues.length > 0 && (
        <Stack gap={4}>
          <Text fw={600} size="sm">
            Lignes signalées ({fmtNumber(issues.length)})
          </Text>
          <ScrollArea.Autosize mah={260} type="auto">
            <Table striped withTableBorder verticalSpacing={4} stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={90}>Ligne</Table.Th>
                  <Table.Th w={90}>Statut</Table.Th>
                  <Table.Th>Motif</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {issues.map((it, i) => (
                  <Table.Tr key={`${it.row_num}-${i}`}>
                    <Table.Td>{it.row_num}</Table.Td>
                    <Table.Td>
                      <ParsingBadge statut={it.statut} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{it.motif}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Stack>
      )}

      {issues.length === 0 && motifs.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucune anomalie détectée.
        </Text>
      )}
    </Stack>
  );
}
