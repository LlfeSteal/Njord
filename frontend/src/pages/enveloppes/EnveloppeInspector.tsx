// Enveloppe d'un CT dans l'inspecteur, en lecture seule (DECISIONS n° 18) : catégorie, période, montant, sources.
// La ligne vient de la liste (pas de route unitaire) ; le fichier « CàT par CT » est la seule source.
import { Banner, Button, Group, Inspector, InspectorSection, KeyValue, LoadingBlock } from '../../ui';
import type { EnveloppeCT } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtPeriod } from '../../lib/format';
import { fmtMontant, useEnveloppes } from './hooks';
import { SourcePills } from './shared';
import './enveloppes.css';

interface Props {
  ct: string | null;
  onClose: () => void;
}

export default function EnveloppeInspector({ ct, onClose }: Props) {
  const q = useEnveloppes();
  const row = ct ? q.data?.cts.find((r) => r.ct === ct) : undefined;
  const enc = ct ? encodeURIComponent(ct) : '';

  const footer = row ? (
    <Group gap={8} justify="end">
      <Button size="sm" to={`/budget?ct=${enc}`}>
        Voir le budget
      </Button>
      <Button size="sm" to={`/previsions?ct=${enc}`}>
        Voir les prévisions
      </Button>
    </Group>
  ) : undefined;

  return (
    <Inspector
      opened={!!ct}
      onClose={onClose}
      title={ct ?? 'Enveloppe'}
      subtitle={row?.ct_libelle || undefined}
      footer={footer}
    >
      {q.isLoading && <LoadingBlock />}
      <ErrorAlert error={q.error} title="Liste des CT indisponible" />
      {!q.isLoading && q.data && !row && (
        <Banner tone="warning" title="CT introuvable">
          Ce CT n'apparaît ni dans le fichier CàT ni dans les imports.
        </Banner>
      )}
      {row && <EnveloppeDetail row={row} />}
    </Inspector>
  );
}

function EnveloppeDetail({ row }: { row: EnveloppeCT }) {
  const e = row.enveloppe;
  return (
    <>
      <InspectorSection title="Enveloppe">
        {e ? (
          <KeyValue
            items={[
              {
                label: 'Catégorie',
                value: row.categorie ? (
                  <span className="env-cat">
                    <span className="env-ellipsis-inline">{row.categorie_libelle || row.categorie}</span>
                    <span className="env-code">{row.categorie}</span>
                  </span>
                ) : (
                  <span className="env-muted">Hors catégorie</span>
                ),
              },
              { label: 'Période', value: fmtPeriod(e.date_debut, e.date_fin), numeric: true },
              { label: 'Montant', value: fmtMontant(e.montant), numeric: true },
            ]}
          />
        ) : (
          <p className="env-help">
            Sans enveloppe : ce CT est absent du dernier fichier CàT importé. Son budget est la charge max reconstruite (plan de
            charge + provisions).
          </p>
        )}
      </InspectorSection>
      <InspectorSection title="CT">
        <KeyValue
          items={[
            { label: 'Libellé', value: row.ct_libelle },
            { label: 'Sources', value: <SourcePills sources={row.sources} /> },
          ]}
        />
      </InspectorSection>
      {e && (
        <p className="env-help">
          L'enveloppe remplace la charge max reconstruite comme budget du CT sur sa période (Budget et Prévisions). Pour la modifier,
          importez un nouveau fichier CàT.
        </p>
      )}
    </>
  );
}
