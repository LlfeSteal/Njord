// Enveloppes par CT (DECISIONS n° 18, 19, 27) : liste, saisie (création, modification, suppression), regroupement par catégorie.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { enveloppeApi } from '../../api/client';
import type { EnveloppeCT, EnveloppeInput, EnveloppesListe } from '../../api/types';
import { fmtEur } from '../../lib/format';
import { qk } from '../../lib/queryKeys';

/** CT (triés côté serveur) ; l'inspecteur lit sa ligne ici (pas de route unitaire). */
export function useEnveloppes() {
  return useQuery({ queryKey: qk.enveloppes(), queryFn: enveloppeApi.list });
}

/** Après une écriture : la page, l'analyse (l'enveloppe est le budget du CT, DECISIONS n° 19, 20) et le journal. */
function invalidateAfterWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.enveloppes() });
  void qc.invalidateQueries({ queryKey: ['analyse'] });
  void qc.invalidateQueries({ queryKey: ['audit'] });
}

/** Remplace (ou ajoute) la ligne d'un CT dans la liste en cache, pour que l'inspecteur ne revienne pas aux anciennes valeurs. */
function patchRow(qc: QueryClient, ct: string, next: EnveloppeCT | null) {
  qc.setQueryData<EnveloppesListe>(qk.enveloppes(), (old) => {
    if (!old) return old;
    const found = old.cts.some((r) => r.ct === ct);
    const cts = next
      ? found
        ? old.cts.map((r) => (r.ct === ct ? next : r))
        : [...old.cts, next]
      : old.cts.filter((r) => r.ct !== ct);
    return { ...old, cts };
  });
}

/** Crée ou remplace l'enveloppe d'un CT (PUT /enveloppes/:ct). Erreurs (400) affichées par l'appelant. */
export function useSaveEnveloppe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ct, input }: { ct: string; input: EnveloppeInput }) => enveloppeApi.put(ct, input),
    onSuccess: (row, { ct }) => {
      patchRow(qc, ct, row);
      invalidateAfterWrite(qc);
    },
  });
}

/** Supprime l'enveloppe d'un CT (DELETE /enveloppes/:ct) : le CT reste listé « sans enveloppe » s'il figure dans une source. */
export function useDeleteEnveloppe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ct, operateur }: { ct: string; operateur?: string; row: EnveloppeCT }) => enveloppeApi.remove(ct, operateur),
    onSuccess: (_void, { ct, row }) => {
      const { plan, realise, provisions } = row.sources;
      patchRow(qc, ct, plan || realise || provisions ? { ...row, enveloppe: null } : null);
      invalidateAfterWrite(qc);
    },
  });
}

// ------------------------------------------------------------------ Groupes

export type GroupKind = 'categorie' | 'hors_categorie' | 'sans_enveloppe';

export interface EnveloppeGroup {
  /** Libellé de catégorie normalisé, ou clé fixe des deux groupes de fin. */
  key: string;
  kind: GroupKind;
  label: string;
  /** Code hérité de l'ancien import (…00) ; '' sinon et pour les groupes de fin. */
  code: string;
  rows: EnveloppeCT[];
  /** Σ montants des enveloppes du groupe. */
  montant: number;
}

export const HORS_CATEGORIE = '__hors_categorie';
export const SANS_ENVELOPPE = '__sans_enveloppe';

/** Clé de regroupement d'un libellé de catégorie : espaces réduits, casse et accents ignorés. */
export const categorieKey = (libelle: string) => norm(libelle.trim().replace(/\s+/g, ' '));

/**
 * Catégories (par libellé normalisé) dans l'ordre du serveur, puis « Hors catégorie », puis « Sans enveloppe » ;
 * groupes vides omis. Libellé affiché = premier rencontré.
 */
export function groupByCategorie(rows: EnveloppeCT[]): EnveloppeGroup[] {
  const cats = new Map<string, EnveloppeGroup>();
  const horsCat: EnveloppeGroup = { key: HORS_CATEGORIE, kind: 'hors_categorie', label: 'Hors catégorie', code: '', rows: [], montant: 0 };
  const sans: EnveloppeGroup = { key: SANS_ENVELOPPE, kind: 'sans_enveloppe', label: 'Sans enveloppe', code: '', rows: [], montant: 0 };
  for (const r of rows) {
    let g: EnveloppeGroup;
    const key = categorieKey(r.categorie_libelle);
    if (!r.enveloppe) g = sans;
    else if (!key) g = horsCat;
    else {
      const found = cats.get(key);
      if (found) g = found;
      else {
        g = { key, kind: 'categorie', label: r.categorie_libelle.trim(), code: '', rows: [], montant: 0 };
        cats.set(key, g);
      }
      if (!g.code && r.categorie) g.code = r.categorie;
    }
    g.rows.push(r);
    g.montant += r.enveloppe?.montant ?? 0;
  }
  return [...cats.values(), horsCat, sans].filter((g) => g.rows.length > 0);
}

/** Libellés de catégorie distincts (normalisés, premier libellé rencontré gardé), triés. */
export function categoriesOf(rows: EnveloppeCT[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const key = categorieKey(r.categorie_libelle);
    if (key && !seen.has(key)) seen.set(key, r.categorie_libelle.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
}

/** Recherche insensible à la casse et aux accents. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Montant : centimes seulement s'il y en a. */
export const fmtMontant = (v: number) => fmtEur(v, !Number.isInteger(v));

/** « 1 enveloppe » / « 3 enveloppes ». */
export const nEnveloppes = (n: number) => `${n.toLocaleString('fr-FR')} enveloppe${n > 1 ? 's' : ''}`;
