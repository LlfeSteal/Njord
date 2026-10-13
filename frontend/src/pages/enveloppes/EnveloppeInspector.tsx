// Enveloppe d'un CT dans l'inspecteur, saisie dans l'interface (DECISIONS n° 27) : période, montant, catégorie ;
// création (« Nouvelle enveloppe », champ CT), modification, ajout pour un CT sans enveloppe, suppression confirmée.
// La ligne vient de la liste (pas de route unitaire). Brouillon remis à zéro au changement de CT (clé posée par la page).
import { useMemo, useState, type FormEvent } from 'react';
import {
  Banner,
  Button,
  DateInput,
  Group,
  Inspector,
  InspectorSection,
  KeyValue,
  LoadingBlock,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  toast,
  type Option,
} from '../../ui';
import { IconPlus, IconTrash } from '../../ui/Icons';
import type { EnveloppeCT, EnveloppeInput } from '../../api/types';
import ErrorAlert from '../../components/ErrorAlert';
import { loadOperateur } from '../../components/lifecycle/lifecycleUtils';
import { fmtPeriod } from '../../lib/format';
import { categorieKey, categoriesOf, fmtMontant, useDeleteEnveloppe, useEnveloppes, useSaveEnveloppe } from './hooks';
import { SourcePills } from './shared';
import './enveloppes.css';

interface Props {
  ct: string | null;
  /** Création : « Nouvelle enveloppe », le CT est saisi dans le formulaire. */
  creating: boolean;
  onClose: () => void;
  /** Ouvre un CT (après une création, ou CT saisi qui a déjà une enveloppe). */
  onOpen: (ct: string) => void;
}

export default function EnveloppeInspector({ ct, creating, onClose, onOpen }: Props) {
  const q = useEnveloppes();
  const rows = useMemo(() => q.data?.cts ?? [], [q.data]);
  const categories = useMemo(() => categoriesOf(rows), [rows]);
  const row = !creating && ct ? rows.find((r) => r.ct === ct) : undefined;
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
      opened={creating || !!ct}
      onClose={onClose}
      title={creating ? 'Nouvelle enveloppe' : (ct ?? 'Enveloppe')}
      subtitle={row?.ct_libelle || undefined}
      footer={footer}
    >
      {q.isLoading && <LoadingBlock />}
      <ErrorAlert error={q.error} title="Liste des CT indisponible" />
      {creating && q.data && (
        <InspectorSection title="Enveloppe">
          <EnveloppeForm
            mode="create"
            rows={rows}
            categories={categories}
            initial={emptyValues('')}
            onCancel={onClose}
            onSaved={(r) => onOpen(r.ct)}
            onOpen={onOpen}
          />
        </InspectorSection>
      )}
      {!creating && !q.isLoading && q.data && !row && (
        <Banner tone="warning" title="CT introuvable">
          Ce CT n'a pas d'enveloppe et n'apparaît dans aucun import.
        </Banner>
      )}
      {row && <EnveloppeDetail row={row} rows={rows} categories={categories} onClose={onClose} />}
    </Inspector>
  );
}

// ------------------------------------------------------------------ Détail d'un CT

function EnveloppeDetail({
  row,
  rows,
  categories,
  onClose,
}: {
  row: EnveloppeCT;
  rows: EnveloppeCT[];
  categories: string[];
  onClose: () => void;
}) {
  const e = row.enveloppe;
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useDeleteEnveloppe();

  const remove = () =>
    del.mutate(
      { ct: row.ct, operateur: loadOperateur() || undefined, row },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          toast({ tone: 'success', title: 'Enveloppe supprimée', message: `${row.ct} est désormais sans enveloppe.` });
          const { plan, realise, provisions } = row.sources;
          if (!plan && !realise && !provisions) onClose();
        },
      },
    );

  return (
    <>
      <InspectorSection title="Enveloppe">
        {e ? (
          <EnveloppeForm
            mode="edit"
            ct={row.ct}
            rows={rows}
            categories={categories}
            initial={valuesOf(row, categories)}
            onSaved={() => undefined}
            onDelete={() => {
              del.reset();
              setConfirmDelete(true);
            }}
          />
        ) : adding ? (
          <EnveloppeForm
            mode="add"
            ct={row.ct}
            rows={rows}
            categories={categories}
            initial={emptyValues(row.ct, row.categorie_libelle, categories)}
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        ) : (
          <Stack gap={8} align="start">
            <p className="env-help">
              Sans enveloppe : ce CT n'a aucun budget, ni statut, ni écart, ni sous-consommation ; seuls son consommé et ses
              atterrissages sont suivis (Budget et Prévisions).
            </p>
            <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setAdding(true)}>
              Ajouter une enveloppe
            </Button>
          </Stack>
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
      {e && <p className="env-help">L'enveloppe est le budget du CT sur sa période (Budget et Prévisions).</p>}

      <Modal
        opened={confirmDelete}
        onClose={() => {
          if (!del.isPending) setConfirmDelete(false);
        }}
        title="Supprimer l'enveloppe"
        size="sm"
        dismissable={!del.isPending}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)} disabled={del.isPending}>
              Annuler
            </Button>
            <Button variant="primary" destructive loading={del.isPending} onClick={remove}>
              Supprimer
            </Button>
          </>
        }
      >
        <Stack gap={8}>
          {e && (
            <Text>
              L'enveloppe de <b>{row.ct}</b> ({fmtMontant(e.montant)}, {fmtPeriod(e.date_debut, e.date_fin)}) sera supprimée.
            </Text>
          )}
          <Text tone="secondary">
            Le CT n'aura plus de budget : ni statut, ni écart, ni sous-consommation. Son consommé et ses atterrissages restent
            suivis.
          </Text>
          <ErrorAlert error={del.error} title="Suppression impossible" />
        </Stack>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------------ Formulaire

/** Valeurs du menu Catégorie hors libellés existants. */
const HORS = '__hors_categorie';
const NOUVELLE = '__nouvelle_categorie';

interface Values {
  /** Création seulement (sinon le CT de la ligne). */
  ct: string;
  debut: string;
  fin: string;
  montant: number | null;
  /** Libellé existant, HORS ou NOUVELLE. */
  cat: string;
  /** Libellé saisi quand cat = NOUVELLE. */
  catNew: string;
}

type ErrKey = 'ct' | 'debut' | 'fin' | 'montant' | 'catNew';

/** Choix du menu pour un libellé : l'existant de même clé normalisée, sinon « Hors catégorie ». */
function catChoice(libelle: string, categories: string[]): string {
  const key = categorieKey(libelle);
  if (!key) return HORS;
  return categories.find((c) => categorieKey(c) === key) ?? HORS;
}

function emptyValues(ct: string, libelle = '', categories: string[] = []): Values {
  return { ct, debut: '', fin: '', montant: null, cat: catChoice(libelle, categories), catNew: '' };
}

function valuesOf(row: EnveloppeCT, categories: string[]): Values {
  const e = row.enveloppe;
  return {
    ct: row.ct,
    debut: e?.date_debut ?? '',
    fin: e?.date_fin ?? '',
    montant: e?.montant ?? null,
    cat: catChoice(row.categorie_libelle, categories),
    catNew: '',
  };
}

/** Libellé envoyé : '' hors catégorie ; une nouvelle catégorie qui existe déjà (casse, accents) reprend le libellé existant. */
function categorieOf(v: Values, categories: string[]): string {
  if (v.cat === HORS) return '';
  if (v.cat !== NOUVELLE) return v.cat;
  const typed = v.catNew.trim().replace(/\s+/g, ' ');
  return categories.find((c) => categorieKey(c) === categorieKey(typed)) ?? typed;
}

const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Contrôles du serveur (DECISIONS n° 27) : CT non vide, dates ISO, fin ≥ début, montant ≥ 0 ; plus le libellé d'une nouvelle catégorie. */
function validate(v: Values, needCt: boolean): { errors: Partial<Record<ErrKey, string>>; missing: Set<ErrKey> } {
  const errors: Partial<Record<ErrKey, string>> = {};
  const missing = new Set<ErrKey>();
  const req = (k: ErrKey, msg: string) => {
    errors[k] = msg;
    missing.add(k);
  };
  if (needCt && !v.ct.trim()) req('ct', 'CT requis');
  if (!v.debut) req('debut', 'Date de début requise');
  else if (!isIsoDate(v.debut)) errors.debut = 'Date invalide';
  if (!v.fin) req('fin', 'Date de fin requise');
  else if (!isIsoDate(v.fin)) errors.fin = 'Date invalide';
  else if (isIsoDate(v.debut) && v.fin < v.debut) errors.fin = 'La fin précède le début';
  if (v.montant == null || Number.isNaN(v.montant)) req('montant', 'Montant requis');
  else if (v.montant < 0) errors.montant = 'Le montant doit être positif ou nul';
  if (v.cat === NOUVELLE && !v.catNew.trim()) req('catNew', 'Libellé requis');
  return { errors, missing };
}

interface FormProps {
  /**
   * edit : enveloppe existante, Annuler / Enregistrer seulement si modifiée ;
   * add : CT sans enveloppe ; create : CT saisi. Dans ces deux cas les boutons sont toujours là (Annuler referme).
   */
  mode: 'edit' | 'add' | 'create';
  /** CT de la ligne (edit, add). */
  ct?: string;
  rows: EnveloppeCT[];
  categories: string[];
  initial: Values;
  onCancel?: () => void;
  onSaved: (row: EnveloppeCT) => void;
  /** Création : CT saisi qui a déjà une enveloppe → la modifier. */
  onOpen?: (ct: string) => void;
  /** Modification : demande de suppression (confirmée par l'appelant). */
  onDelete?: () => void;
}

function EnveloppeForm({ mode, ct, rows, categories, initial, onCancel, onSaved, onOpen, onDelete }: FormProps) {
  const [draft, setDraft] = useState<Values | null>(null);
  const [tried, setTried] = useState(false);
  const save = useSaveEnveloppe();

  const v = draft ?? initial;
  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setDraft({ ...v, [k]: value });
    save.reset();
  };

  const create = mode === 'create';
  const ctCode = create ? v.ct.trim() : (ct ?? '');
  const categorie = categorieOf(v, categories);
  const dirty =
    !!draft &&
    (v.debut !== initial.debut ||
      v.fin !== initial.fin ||
      v.montant !== initial.montant ||
      categorie !== categorieOf(initial, categories) ||
      (create && ctCode !== initial.ct.trim()));
  const { errors, missing } = validate(v, create);
  const shown = (k: ErrKey) => (errors[k] && (tried || !missing.has(k)) ? errors[k] : undefined);

  // Création : le CT saisi existe-t-il déjà ? (libellé en description, bascule s'il a déjà une enveloppe)
  const known = create && ctCode ? rows.find((r) => r.ct === ctCode) : undefined;
  const existing = known?.enveloppe ? known : undefined;
  const pristineRest = v.debut === '' && v.fin === '' && v.montant == null && v.cat === initial.cat && v.catNew === '';

  const submit = (ev?: FormEvent) => {
    ev?.preventDefault();
    if (save.isPending) return;
    // CT saisi qui a déjà une enveloppe, rien d'autre de saisi : on passe à sa modification.
    if (existing && pristineRest) {
      onOpen?.(existing.ct);
      return;
    }
    if (Object.keys(errors).length > 0) {
      setTried(true);
      return;
    }
    const input: EnveloppeInput = {
      date_debut: v.debut,
      date_fin: v.fin,
      montant: v.montant ?? 0,
      categorie,
      operateur: loadOperateur() || undefined,
    };
    const wasConfigured = !!rows.find((r) => r.ct === ctCode)?.enveloppe;
    save.mutate(
      { ct: ctCode, input },
      {
        onSuccess: (r) => {
          setDraft(null);
          setTried(false);
          toast({
            tone: 'success',
            title: wasConfigured ? 'Enveloppe modifiée' : 'Enveloppe créée',
            message: `${r.ct} : ${fmtMontant(input.montant)}, ${fmtPeriod(input.date_debut, input.date_fin)}.`,
          });
          onSaved(r);
        },
      },
    );
  };

  const cancel = () => {
    setDraft(null);
    setTried(false);
    save.reset();
    if (mode !== 'edit') onCancel?.();
  };

  const catOptions: Option[] = [
    { value: HORS, label: 'Hors catégorie' },
    ...categories.map((c) => ({ value: c, label: c })),
    { value: NOUVELLE, label: 'Nouvelle catégorie…' },
  ];
  const busy = save.isPending;
  const showActions = mode !== 'edit' || dirty;

  return (
    <form noValidate onSubmit={submit}>
      <Stack gap={12}>
        {create && (
          <>
            <TextInput
              label="CT"
              required
              placeholder="Code du CT"
              autoFocus
              value={v.ct}
              onChange={(x) => set('ct', x)}
              description={known && !existing ? known.ct_libelle || undefined : undefined}
              error={shown('ct')}
              disabled={busy}
            />
            {existing && (
              <Banner
                tone="info"
                compact
                action={
                  <Button size="sm" onClick={() => onOpen?.(existing.ct)}>
                    Modifier
                  </Button>
                }
              >
                {existing.ct} a déjà une enveloppe.
              </Banner>
            )}
          </>
        )}
        <DateInput
          label="Début"
          required
          value={v.debut}
          onChange={(x) => set('debut', x)}
          error={shown('debut')}
          disabled={busy}
        />
        <DateInput
          label="Fin"
          required
          value={v.fin}
          min={isIsoDate(v.debut) ? v.debut : undefined}
          onChange={(x) => set('fin', x)}
          error={shown('fin')}
          disabled={busy}
        />
        <NumberInput
          label="Montant"
          required
          min={0}
          suffix="€"
          value={v.montant}
          onChange={(x) => set('montant', x)}
          error={shown('montant')}
          disabled={busy}
        />
        <Select
          label="Catégorie"
          data={catOptions}
          value={v.cat}
          onChange={(x) => set('cat', x ?? HORS)}
          disabled={busy}
        />
        {v.cat === NOUVELLE && (
          <TextInput
            label="Nouvelle catégorie"
            required
            placeholder="Libellé de la catégorie"
            autoFocus
            value={v.catNew}
            onChange={(x) => set('catNew', x)}
            error={shown('catNew')}
            disabled={busy}
          />
        )}
        <ErrorAlert error={save.error} title="Enregistrement impossible" />
        {showActions ? (
          <Group gap={8} justify="end">
            <Button size="sm" onClick={cancel} disabled={busy}>
              Annuler
            </Button>
            <Button size="sm" type="submit" variant="primary" loading={busy}>
              Enregistrer
            </Button>
          </Group>
        ) : (
          onDelete && (
            <Group gap={8} justify="start">
              <Button size="sm" variant="plain" destructive icon={<IconTrash size={14} />} onClick={onDelete}>
                Supprimer l'enveloppe…
              </Button>
            </Group>
          )
        )}
      </Stack>
    </form>
  );
}
