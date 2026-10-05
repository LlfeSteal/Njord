// Affichage du bilan d'import (ImportReport) : totaux, détection, spécificités plan/réalisé, motifs, issues.
// Compteurs en cartes KPI, détails en sections dépliables (cf. docs/STYLE.md §8, « Import wizard »).
import type { ReactNode } from 'react';
import { Card, Disclosure, Grid, Group, Pill, Stack, StatusGlyph, Table, Text, type GlyphKind, type Tone } from '../../ui';
import type { ImportReport } from '../../api/types';
import { fmtEur, fmtNumber, fmtPct, fmtPeriod } from '../../lib/format';
import { ParsingBadge } from '../badges';

/** Carte KPI : libellé 12 px secondaire (précédé d'un glyphe de statut si pertinent) + valeur. */
function StatCard({ label, value, glyph }: { label: string; value: number; glyph?: { kind: GlyphKind; tone: Tone } }) {
  return (
    <Card padding={12}>
      <Group gap={6} wrap={false}>
        {glyph && <StatusGlyph kind={glyph.kind} tone={glyph.tone} size={12} />}
        <Text size="sm" tone="secondary">
          {label}
        </Text>
      </Group>
      <Text size="kpi" weight={600} tabular>
        {fmtNumber(value)}
      </Text>
    </Card>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group gap={6} wrap={false} align="baseline">
      <Text tone="secondary" style={{ whiteSpace: 'nowrap' }}>
        {label} :
      </Text>
      <Text weight={500}>{children}</Text>
    </Group>
  );
}

/** Liste de noms dépliable (pastilles), avec son compte à droite du résumé. */
function NameList({ title, items }: { title: string; items: string[] }) {
  return (
    <Disclosure summary={title} aside={<Pill>{fmtNumber(items.length)}</Pill>}>
      {items.length === 0 ? (
        <Text tone="secondary">Aucun.</Text>
      ) : (
        <div style={{ maxHeight: 180, overflow: 'auto' }}>
          <Group gap={4}>
            {items.map((n) => (
              <Pill key={n}>{n}</Pill>
            ))}
          </Group>
        </div>
      )}
    </Disclosure>
  );
}

const LAYOUT_LABEL: Record<string, string> = { A: 'A', B: 'B', mixte: 'mixte (A et B)' };

export default function ImportReportView({ report }: { report: ImportReport }) {
  const motifs = Object.entries(report.motifs_count ?? {}).sort((a, b) => b[1] - a[1]);
  const issues = report.issues ?? [];
  const hasDetails = report.kind === 'plan' || motifs.length > 0 || issues.length > 0;
  return (
    <Stack gap={12}>
      <Grid cols={{ base: 2, sm: 4 }} gap={8}>
        <StatCard label="Lignes" value={report.total} />
        <StatCard label="OK" value={report.ok} glyph={{ kind: 'success', tone: 'success' }} />
        <StatCard label="Warn" value={report.warn} glyph={report.warn ? { kind: 'warning', tone: 'warning' } : undefined} />
        <StatCard label="Drop" value={report.drop} glyph={report.drop ? { kind: 'danger', tone: 'danger' } : undefined} />
      </Grid>

      <Card padding={12}>
        <Grid cols={{ base: 1, sm: 2 }} gap={4}>
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
        </Grid>
      </Card>

      {hasDetails && (
        <Card padding={12}>
          {report.kind === 'plan' && (
            <>
              <NameList title="Nouvelles personnes" items={report.nouvelles_personnes ?? []} />
              <NameList title="Nouveaux squads" items={report.nouveaux_squads ?? []} />
            </>
          )}

          {motifs.length > 0 && (
            <Disclosure summary="Motifs" aside={<Pill>{fmtNumber(motifs.length)}</Pill>} defaultOpen>
              <Table card={false} striped compact minWidth={360}>
                <thead>
                  <tr>
                    <th>Motif</th>
                    <th data-align="right">Occurrences</th>
                  </tr>
                </thead>
                <tbody>
                  {motifs.map(([m, n]) => (
                    <tr key={m}>
                      <td>{m}</td>
                      <td data-align="right">{fmtNumber(n)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Disclosure>
          )}

          {issues.length > 0 && (
            <Disclosure summary="Lignes signalées" aside={<Pill>{fmtNumber(issues.length)}</Pill>}>
              <Table card={false} striped compact maxHeight={260}>
                <thead>
                  <tr>
                    <th data-align="right" style={{ width: 90 }}>
                      Ligne
                    </th>
                    <th style={{ width: 90 }}>Statut</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((it, i) => (
                    <tr key={`${it.row_num}-${i}`}>
                      <td data-align="right">{it.row_num}</td>
                      <td>
                        <ParsingBadge statut={it.statut} />
                      </td>
                      <td>{it.motif}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Disclosure>
          )}
        </Card>
      )}

      {issues.length === 0 && motifs.length === 0 && <Text tone="secondary">Aucune anomalie détectée.</Text>}
    </Stack>
  );
}
