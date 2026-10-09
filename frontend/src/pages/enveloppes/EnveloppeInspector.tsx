// Enveloppe d'un CT dans l'inspecteur : période d'utilisation, montant, commentaire (DECISIONS n° 18).
// La ligne vient de la liste (pas de route unitaire). Monté avec key={ct} : l'état repart à zéro à chaque CT.
import { useId, useState } from 'react';
import {
  Banner,
  Button,
  DateInput,
  Grid,
  Inspector,
  InspectorSection,
  KeyValue,
  LoadingBlock,
  Modal,
  NumberInput,
  Stack,
  Text,
  Textarea,
} from '../../ui';
import { ApiError } from '../../api/client';
import type { EnveloppeCT } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { fmtDateTime, fmtPeriod } from '../../lib/format';
import {
  fmtMontant,
  hasSource,
  initForm,
  sameForm,
  toInput,
  useEnveloppes,
  useRemoveEnveloppe,
  useSaveEnveloppe,
  validate,
  type EnveloppeForm,
} from './hooks';
import { SourcePills } from './shared';
import './enveloppes.css';

interface Props {
  ct: string | null;
  onClose: () => void;
}

type FieldKey = keyof EnveloppeForm;

export default function EnveloppeInspector({ ct, onClose }: Props) {
  const formId = useId();
  const q = useEnveloppes();
  const row = ct ? q.data?.find((r) => r.ct === ct) : undefined;

  // null = formulaire vierge, qui suit la ligne (chargement tardif, enregistrement, retrait).
  const [edited, setEdited] = useState<EnveloppeForm | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [confirmRemove, setConfirmRemove] = useState(false);

  const reset = () => {
    setEdited(null);
    setTouched({});
  };
  const save = useSaveEnveloppe(reset);
  const remove = useRemoveEnveloppe((next) => {
    reset();
    setConfirmRemove(false);
    if (!next) onClose(); // CT absent des imports : il quitte la liste.
  });

  const initial = initForm(row?.enveloppe);
  const form = edited ?? initial;
  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const dirty = edited != null && !sameForm(edited, initial);

  const touch = (k: FieldKey) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const set = <K extends FieldKey>(k: K, v: EnveloppeForm[K]) => {
    setEdited({ ...form, [k]: v });
    // Une date choisie au sélecteur compte comme saisie (pas toujours de blur).
    if (k === 'debut' || k === 'fin') touch(k);
  };
  const errorOf = (k: FieldKey) => (touched[k] ? errors[k] : undefined);

  const submit = () => {
    if (!row || !valid || !dirty || save.isPending) return;
    save.mutate({ ct: row.ct, body: toInput(form) });
  };

  const footer = row ? (
    <>
      {row.enveloppe && (
        <Button destructive onClick={() => setConfirmRemove(true)} disabled={save.isPending}>
          Retirer l'enveloppe
        </Button>
      )}
      <Button
        type="submit"
        form={formId}
        variant="primary"
        loading={save.isPending}
        disabled={!dirty || !valid || remove.isPending}
      >
        Enregistrer
      </Button>
    </>
  ) : undefined;

  return (
    <Inspector opened={!!ct} onClose={onClose} title={ct ?? 'Enveloppe'} footer={footer}>
      {q.isLoading && <LoadingBlock />}
      <ErrorAlert error={q.error} title="Liste des CT indisponible" />
      {!q.isLoading && q.data && !row && (
        <Banner tone="warning" title="CT introuvable">
          Ce CT n'apparaît dans aucun import et n'a pas d'enveloppe.
        </Banner>
      )}
      {row && (
        <>
          <InspectorSection title="CT">
            <CtSummary row={row} />
          </InspectorSection>
          <InspectorSection title="Enveloppe">
            <form
              id={formId}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Stack gap={12}>
                <Grid cols={2} gap={8}>
                  <div onBlur={() => touch('debut')}>
                    <DateInput
                      label="Début"
                      required
                      value={form.debut}
                      max={form.fin || undefined}
                      onChange={(v) => set('debut', v)}
                      error={errorOf('debut')}
                      disabled={save.isPending}
                    />
                  </div>
                  <div onBlur={() => touch('fin')}>
                    <DateInput
                      label="Fin"
                      required
                      value={form.fin}
                      min={form.debut || undefined}
                      onChange={(v) => set('fin', v)}
                      error={errorOf('fin')}
                      disabled={save.isPending}
                    />
                  </div>
                </Grid>
                <div onBlur={() => touch('montant')}>
                  <NumberInput
                    label="Montant (€)"
                    required
                    min={0}
                    suffix="€"
                    value={form.montant}
                    onChange={(v) => set('montant', v)}
                    error={errorOf('montant')}
                    disabled={save.isPending}
                  />
                </div>
                <Textarea
                  label="Commentaire"
                  rows={3}
                  autosize
                  value={form.commentaire}
                  onChange={(v) => set('commentaire', v)}
                  disabled={save.isPending}
                />
                {save.error && (
                  <ErrorAlert
                    error={save.error}
                    title={
                      save.error instanceof ApiError && save.error.status === 400
                        ? 'Enveloppe refusée'
                        : "Échec de l'enregistrement"
                    }
                  />
                )}
                <p className="env-help">Saisie seule : l'enveloppe n'est pas encore utilisée par le pilotage.</p>
              </Stack>
            </form>
          </InspectorSection>
          <RemoveModal
            row={row}
            opened={confirmRemove}
            pending={remove.isPending}
            error={remove.error}
            onCancel={() => {
              setConfirmRemove(false);
              remove.reset();
            }}
            onConfirm={() => remove.mutate(row)}
          />
        </>
      )}
    </Inspector>
  );
}

// ------------------------------------------------------------------ Résumé du CT

function CtSummary({ row }: { row: EnveloppeCT }) {
  const e = row.enveloppe;
  return (
    <KeyValue
      items={[
        { label: 'Libellé', value: row.ct_libelle },
        { label: 'Sources', value: <SourcePills sources={row.sources} /> },
        {
          label: 'Dernière modification',
          value: e ? [e.operateur, fmtDateTime(e.updated_at)].filter(Boolean).join(' · ') : 'À configurer',
        },
      ]}
    />
  );
}

// ------------------------------------------------------------------ Retrait

interface RemoveModalProps {
  row: EnveloppeCT;
  opened: boolean;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}

function RemoveModal({ row, opened, pending, error, onCancel, onConfirm }: RemoveModalProps) {
  const e = row.enveloppe;
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!pending) onCancel();
      }}
      title="Retirer l'enveloppe"
      size="sm"
      dismissable={!pending}
      footer={
        <>
          <Button onClick={onCancel} disabled={pending}>
            Annuler
          </Button>
          <Button variant="primary" destructive loading={pending} onClick={onConfirm}>
            Retirer
          </Button>
        </>
      }
    >
      <Stack gap={8}>
        <Text>
          L'enveloppe de <b>{row.ct}</b>
          {e && (
            <>
              {' '}
              ({fmtMontant(e.montant)}, {fmtPeriod(e.date_debut, e.date_fin)})
            </>
          )}{' '}
          sera supprimée.
        </Text>
        <Text tone="secondary">
          {hasSource(row.sources)
            ? 'Le CT repassera « à configurer ».'
            : "Ce CT n'apparaît plus dans aucun import : il quittera la liste."}
        </Text>
        <ErrorAlert error={error} title="Retrait impossible" />
      </Stack>
    </Modal>
  );
}
