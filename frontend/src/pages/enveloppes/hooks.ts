// Enveloppes par CT (DECISIONS n° 18) : liste, enregistrement, retrait, validation du formulaire.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enveloppeApi } from '../../api/client';
import type { Enveloppe, EnveloppeCT, EnveloppeInput, EnveloppeSources } from '../../api/types';
import { loadOperateur } from '../../components/lifecycle/lifecycleUtils';
import { fmtEur } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../ui';

/** Liste des CT (triée par CT côté serveur) ; l'inspecteur lit sa ligne ici (pas de route unitaire). */
export function useEnveloppes() {
  return useQuery({ queryKey: qk.enveloppes(), queryFn: enveloppeApi.list });
}

/** Remplace (ou retire) la ligne d'un CT dans le cache de la liste. */
function patchList(rows: EnveloppeCT[] | undefined, ct: string, next: EnveloppeCT | null) {
  if (!rows) return rows;
  return next ? rows.map((r) => (r.ct === ct ? next : r)) : rows.filter((r) => r.ct !== ct);
}

export function hasSource(s: EnveloppeSources) {
  return s.plan || s.realise || s.provisions;
}

/** PUT /enveloppes/:ct : met la ligne à jour dans le cache, invalide, notifie. Erreurs affichées par l'appelant. */
export function useSaveEnveloppe(onSaved?: (row: EnveloppeCT) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ct, body }: { ct: string; body: EnveloppeInput }) =>
      enveloppeApi.save(ct, { ...body, operateur: loadOperateur() || undefined }),
    onSuccess: (row, { ct }) => {
      qc.setQueryData<EnveloppeCT[]>(qk.enveloppes(), (rows) => patchList(rows, ct, row));
      void qc.invalidateQueries({ queryKey: qk.enveloppes() });
      toast({ tone: 'success', title: 'Enveloppe enregistrée.' });
      onSaved?.(row);
    },
  });
}

/** DELETE /enveloppes/:ct : le CT repasse « à configurer », ou quitte la liste s'il n'est plus dans aucun import. */
export function useRemoveEnveloppe(onRemoved?: (row: EnveloppeCT | null) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: EnveloppeCT) => enveloppeApi.remove(row.ct),
    onSuccess: (_, row) => {
      const next = hasSource(row.sources) ? { ...row, enveloppe: null } : null;
      qc.setQueryData<EnveloppeCT[]>(qk.enveloppes(), (rows) => patchList(rows, row.ct, next));
      void qc.invalidateQueries({ queryKey: qk.enveloppes() });
      toast({ tone: 'success', title: 'Enveloppe retirée.' });
      onRemoved?.(next);
    },
  });
}

// ------------------------------------------------------------------ Formulaire

export interface EnveloppeForm {
  /** YYYY-MM-DD ou '' */
  debut: string;
  fin: string;
  montant: number | null;
  commentaire: string;
}

export type EnveloppeErrors = Partial<Record<keyof EnveloppeForm, string>>;

export function initForm(e: Enveloppe | null | undefined): EnveloppeForm {
  return e
    ? { debut: e.date_debut.slice(0, 10), fin: e.date_fin.slice(0, 10), montant: e.montant, commentaire: e.commentaire }
    : { debut: '', fin: '', montant: null, commentaire: '' };
}

export function sameForm(a: EnveloppeForm, b: EnveloppeForm) {
  return a.debut === b.debut && a.fin === b.fin && a.montant === b.montant && a.commentaire.trim() === b.commentaire.trim();
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mêmes règles que l'API : dates requises (YYYY-MM-DD), fin ≥ début, montant requis, fini et ≥ 0. */
export function validate(f: EnveloppeForm): EnveloppeErrors {
  const err: EnveloppeErrors = {};
  if (!f.debut) err.debut = 'Date de début requise.';
  else if (!ISO_DATE.test(f.debut)) err.debut = 'Date invalide.';
  if (!f.fin) err.fin = 'Date de fin requise.';
  else if (!ISO_DATE.test(f.fin)) err.fin = 'Date invalide.';
  else if (!err.debut && f.fin < f.debut) err.fin = 'La fin doit être postérieure ou égale au début.';
  if (f.montant == null) err.montant = 'Montant requis.';
  else if (!Number.isFinite(f.montant) || f.montant < 0) err.montant = 'Le montant doit être positif ou nul.';
  return err;
}

export function toInput(f: EnveloppeForm): EnveloppeInput {
  return { date_debut: f.debut, date_fin: f.fin, montant: f.montant ?? 0, commentaire: f.commentaire.trim() };
}

/** Recherche insensible à la casse et aux accents. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Montant : centimes seulement s'il y en a. */
export const fmtMontant = (v: number) => fmtEur(v, !Number.isInteger(v));
