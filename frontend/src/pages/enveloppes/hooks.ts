// Enveloppes par CT (DECISIONS n° 18, 19) : liste, import du fichier « CàT par CT », regroupement par catégorie.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enveloppeApi } from '../../api/client';
import type { EnveloppeCT } from '../../api/types';
import { fmtEur } from '../../lib/format';
import { qk } from '../../lib/queryKeys';

/** Dernier import + CT (triés côté serveur) ; l'inspecteur lit sa ligne ici (pas de route unitaire). */
export function useEnveloppes() {
  return useQuery({ queryKey: qk.enveloppes(), queryFn: enveloppeApi.list });
}

/** Aperçu du fichier : n'écrit rien. Erreurs (422 en-tête / fichier illisible) affichées par l'appelant. */
export function usePreviewEnveloppes() {
  return useMutation({ mutationFn: (file: File) => enveloppeApi.preview(file) });
}

/** Import confirmé : remplace toutes les enveloppes, puis rafraîchit la page, l'analyse (budget des CT) et le journal. */
export function useCommitEnveloppes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, importeur }: { file: File; importeur?: string }) => enveloppeApi.commit(file, importeur),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.enveloppes() });
      // L'enveloppe est le budget du CT dans l'analyse (DECISIONS n° 19, 20) : Budget et Prévisions à recalculer.
      void qc.invalidateQueries({ queryKey: ['analyse'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
}

// ------------------------------------------------------------------ Groupes

export type GroupKind = 'categorie' | 'hors_categorie' | 'hors_fichier';

export interface EnveloppeGroup {
  /** Code de catégorie, ou clé fixe des deux groupes de fin. */
  key: string;
  kind: GroupKind;
  label: string;
  /** Code de la ligne de catégorie (…00) ; '' pour les groupes de fin. */
  code: string;
  rows: EnveloppeCT[];
  /** Σ montants des enveloppes du groupe. */
  montant: number;
}

export const HORS_CATEGORIE = '__hors_categorie';
export const HORS_FICHIER = '__hors_fichier';

/** Catégories dans l'ordre du serveur, puis « Hors catégorie », puis « Hors fichier » ; groupes vides omis. */
export function groupByCategorie(rows: EnveloppeCT[]): EnveloppeGroup[] {
  const cats = new Map<string, EnveloppeGroup>();
  const horsCat: EnveloppeGroup = { key: HORS_CATEGORIE, kind: 'hors_categorie', label: 'Hors catégorie', code: '', rows: [], montant: 0 };
  const horsFichier: EnveloppeGroup = { key: HORS_FICHIER, kind: 'hors_fichier', label: 'Hors fichier', code: '', rows: [], montant: 0 };
  for (const r of rows) {
    let g: EnveloppeGroup;
    if (!r.enveloppe) g = horsFichier;
    else if (!r.categorie) g = horsCat;
    else {
      const found = cats.get(r.categorie);
      if (found) g = found;
      else {
        g = { key: r.categorie, kind: 'categorie', label: r.categorie_libelle || r.categorie, code: r.categorie, rows: [], montant: 0 };
        cats.set(r.categorie, g);
      }
    }
    g.rows.push(r);
    g.montant += r.enveloppe?.montant ?? 0;
  }
  return [...cats.values(), horsCat, horsFichier].filter((g) => g.rows.length > 0);
}

/** Recherche insensible à la casse et aux accents. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Montant : centimes seulement s'il y en a. */
export const fmtMontant = (v: number) => fmtEur(v, !Number.isInteger(v));

/** « 1 enveloppe » / « 3 enveloppes ». */
export const nEnveloppes = (n: number) => `${n.toLocaleString('fr-FR')} enveloppe${n > 1 ? 's' : ''}`;
