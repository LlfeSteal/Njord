// Sous-onglet Alertes (§7.5) : CT à risque, alerte globale % non sécurisé, dérive de provision.
import { Banner, Group, Link, Stack, Table, Text } from '../../ui';
import { useQuery } from '@tanstack/react-query';
import type { AnalyseResult } from '../../api/types';
import { fmtDate, fmtEur, fmtHours, fmtPct } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { CtCell, SectionHeader } from './common';
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
    <Stack gap={16}>
      {alertes.alerte_globale ? (
        <Banner tone="error" title="Alerte globale : part non sécurisée trop élevée">
          {fmtPct(alertes.pct_non_securise)} du budget classé est non sécurisé
          {s ? ` (seuil : ${fmtPct(s.seuil_non_securise_pct)})` : ''}.
        </Banner>
      ) : (
        <Banner tone="success" title="Part non sécurisée sous le seuil">
          {fmtPct(alertes.pct_non_securise)} du budget classé est non sécurisé
          {s ? ` (seuil : ${fmtPct(s.seuil_non_securise_pct)})` : ''}.
        </Banner>
      )}

      <section>
        <SectionHeader
          title={`CT à risque (${alertes.ct_risque.length})`}
          sub={`TG dont Σ € non sécurisé dépasse ${s ? fmtEur(s.seuil_ct_risque_eur) : 'le seuil paramétré'}.`}
        />
        {alertes.ct_risque.length === 0 ? (
          <Text tone="secondary">Aucun CT à risque.</Text>
        ) : (
          <Table hover minWidth={560}>
            <thead>
              <tr>
                <th>CT</th>
                <th data-align="right">Non sécurisé</th>
                <th>Drill-down</th>
              </tr>
            </thead>
            <tbody>
              {[...alertes.ct_risque]
                .sort((a, b) => b.non_securise - a.non_securise)
                .map((a) => (
                  <tr key={a.ct}>
                    <td>
                      <CtCell ct={a.ct} libelle={a.ct_libelle} />
                    </td>
                    <td data-align="right">
                      <Text as="span" weight={600}>
                        {fmtEur(a.non_securise)}
                      </Text>
                    </td>
                    <td>
                      <Group gap={12}>
                        <Link onClick={() => drill({ ct: a.ct })}>Écarts</Link>
                        <Link to={tabLink('budget')}>Budget</Link>
                      </Group>
                    </td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <SectionHeader
          title={`Dérive de provision (${alertes.derive_provision.length})`}
          sub="Consommations de PROVISIONS POUR ALEAS ou écritures sans ressource identifiée sur un CT provisionné."
        />
        {alertes.derive_provision.length === 0 ? (
          <Text tone="secondary">Aucune dérive détectée.</Text>
        ) : (
          <Table striped hover minWidth={760}>
            <thead>
              <tr>
                <th>CT</th>
                <th data-align="right">Ligne</th>
                <th>Employé / fournisseur</th>
                <th>Type</th>
                <th>Date dépense</th>
                <th data-align="right">Heures</th>
                <th data-align="right">€</th>
              </tr>
            </thead>
            <tbody>
              {alertes.derive_provision.map((d) => (
                <tr key={`${d.ct}|${d.row_num}`}>
                  <td>
                    <Link mono onClick={() => drill({ ct: d.ct })}>
                      {d.ct}
                    </Link>
                  </td>
                  <td data-align="right">{d.row_num}</td>
                  <td>
                    {d.employe_fournisseur || (
                      <Text as="span" tone="secondary">
                        —
                      </Text>
                    )}
                  </td>
                  <td>{d.type}</td>
                  <td data-nowrap>{fmtDate(d.date_depense)}</td>
                  <td data-align="right">{d.heures ? fmtHours(d.heures) : '—'}</td>
                  <td data-align="right">{d.eur ? fmtEur(d.eur, true) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </Stack>
  );
}
