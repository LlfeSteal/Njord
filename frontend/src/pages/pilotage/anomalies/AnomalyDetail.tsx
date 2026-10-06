// Détail d'une anomalie (panneau de lecture façon Mail) et actions de traitement.
import { Button, Disclosure, Group, InspectorSection, KeyValue, Link, Stack, StatusGlyph, Text, Textarea, type KeyValueItem } from '../../../ui';
import { IconCheck, IconUndo } from '../../../ui/Icons';
import type { Anomalie } from '../../../api/types';
import { fmtDateTime, fmtEur } from '../../../lib/format';
import { AnomalyGlyph } from './AnomalyList';
import { STATUT_LABEL, anomalySubtitle, fmtAnomalieHeures, fmtWeeks } from './meta';
import type { SuiviAction } from './useSuivi';

/** En-tête du panneau de lecture (écran large ; l'Inspector a le sien). */
export function AnomalyHeader({ a }: { a: Anomalie }) {
  return (
    <div className="anom-detail__head">
      <span className="anom-detail__glyph">
        <AnomalyGlyph a={a} size={20} />
      </span>
      <div className="anom-detail__titles">
        <h2 className="anom-detail__title">{a.titre}</h2>
        <Text size="sm" tone="secondary">
          {anomalySubtitle(a)}
        </Text>
      </div>
    </div>
  );
}

export function AnomalyBody({ a }: { a: Anomalie }) {
  const items: KeyValueItem[] = [];
  if (a.ct) items.push({ label: 'CT', value: a.ct, mono: true });
  if (a.ct_libelle) items.push({ label: 'Libellé CT', value: a.ct_libelle });
  if (a.ressource) items.push({ label: 'Ressource', value: a.ressource });
  const heures = fmtAnomalieHeures(a);
  if (heures) items.push({ label: a.categorie === 'ecart' ? 'Écart' : 'Heures', value: heures, numeric: true });
  if (a.montant != null) items.push({ label: 'Montant', value: fmtEur(a.montant), numeric: true });
  const weeks = fmtWeeks(a.semaines);
  if (weeks) items.push({ label: a.semaines!.length > 1 ? 'Semaines' : 'Semaine', value: weeks });

  return (
    <Stack gap={16}>
      {a.detail && <Text>{a.detail}</Text>}
      {items.length > 0 && <KeyValue items={items} />}
      {!!a.details?.length && (
        <Disclosure summary="Détails" aside={<Text as="span" size="sm" tone="secondary" tabular>{a.details.length}</Text>}>
          <ul className="anom-detail__list">
            {a.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {a.lien && (
        <div>
          <Link to={a.lien}>Voir les données</Link>
        </div>
      )}
      {a.suivi && (
        <InspectorSection title="Suivi">
          <Stack gap={8}>
            {a.suivi.obsolete && (
              <Group gap={6} wrap={false}>
                <StatusGlyph kind="info" tone="accent" size={12} />
                <Text size="sm" tone="secondary">
                  Les chiffres ont changé depuis le traitement.
                </Text>
              </Group>
            )}
            <KeyValue
              items={[
                { label: a.suivi.obsolete ? 'Statut précédent' : 'Statut', value: STATUT_LABEL[a.suivi.statut] },
                { label: 'Par', value: a.suivi.operateur || '—' },
                { label: 'Le', value: fmtDateTime(a.suivi.updated_at) },
              ]}
            />
            {a.suivi.commentaire && <Text className="anom-detail__comment">{a.suivi.commentaire}</Text>}
          </Stack>
        </InspectorSection>
      )}
    </Stack>
  );
}

interface ActionsProps {
  a: Anomalie;
  comment: string;
  onComment: (v: string) => void;
  onAction: (action: SuiviAction) => void;
  /** Action en cours (bouton en chargement, les autres désactivés). */
  pending: SuiviAction | null;
}

export function AnomalyActions({ a, comment, onComment, onAction, pending }: ActionsProps) {
  const busy = pending != null;
  if (a.statut !== 'a_traiter')
    return (
      <Group justify="end" gap={8}>
        <Button icon={<IconUndo size={15} />} loading={pending === 'rouvrir'} disabled={busy} onClick={() => onAction('rouvrir')}>
          Rouvrir
        </Button>
      </Group>
    );
  return (
    <Stack gap={8}>
      <Textarea
        aria-label="Commentaire"
        placeholder="Commentaire (facultatif)"
        rows={2}
        autosize
        value={comment}
        onChange={onComment}
        disabled={busy}
      />
      <Group justify="end" gap={8}>
        <Button
          title="Raccourci : I"
          aria-keyshortcuts="i"
          loading={pending === 'ignoree'}
          disabled={busy}
          onClick={() => onAction('ignoree')}
        >
          Ignorer
        </Button>
        <Button
          variant="primary"
          icon={<IconCheck size={15} />}
          title="Raccourci : E"
          aria-keyshortcuts="e"
          loading={pending === 'traitee'}
          disabled={busy}
          onClick={() => onAction('traitee')}
        >
          Marquer comme traitée
        </Button>
      </Group>
    </Stack>
  );
}
