// Colonnes de la table des écritures du réalisé (sélecteur) et champs de l'inspecteur.
import { createElement, type ReactNode } from 'react';
import type { RealiseEntry } from '../../api/types';
import type { RealiseEntriesQuery } from '../../api/client';
import { CodeCell, TruncatedText } from './cells';
import { fmtDate, fmtEur, fmtNumber } from '../../lib/format';

export type SortField = NonNullable<RealiseEntriesQuery['sort']>;

export interface EntryColumn {
  key: string;
  label: string;
  render: (e: RealiseEntry) => ReactNode;
  /** Colonne affichée par défaut. */
  main?: boolean;
  /** Donnée sensible : masquée quand « Masquer les colonnes sensibles » est actif. */
  sensitive?: boolean;
  /** Tri serveur associé. */
  sort?: SortField;
  align?: 'left' | 'right';
  /** Cellule en police monospace (codes). */
  mono?: boolean;
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v);

/** Libellé TG sans le code en préfixe (« CT_xxx - libellé » → « libellé »). */
export function tgLabel(e: RealiseEntry): string {
  if (!e.tg_libelle) return '';
  return e.tg_libelle.startsWith(e.tg) ? e.tg_libelle.slice(e.tg.length).replace(/^\s*-\s*/, '') : e.tg_libelle;
}

const truncated = (get: (e: RealiseEntry) => string, maw: number) => (e: RealiseEntry) =>
  createElement(TruncatedText, { value: get(e), maw });
const codeCell = (code: string, label: string) => createElement(CodeCell, { code, label });

export const COLUMNS: EntryColumn[] = [
  { key: 'date_depense', label: 'Date', render: (e) => fmtDate(e.date_depense), main: true, sort: 'date_depense' },
  { key: 'tg', label: 'TG', render: (e) => codeCell(e.tg, e.tg_libelle), main: true, sort: 'tg', mono: true },
  { key: 'tg_libelle', label: 'Libellé TG', render: truncated(tgLabel, 240) },
  { key: 'wp', label: 'WP', render: (e) => codeCell(e.wp, e.wp_libelle), mono: true },
  { key: 'wp_libelle', label: 'WP libellé', render: truncated((e) => e.wp_libelle, 240) },
  { key: 'categorie', label: 'Catégorie', render: (e) => txt(e.categorie), main: true },
  { key: 'type', label: 'Type', render: truncated((e) => e.type, 200) },
  { key: 'entite', label: 'Entité', render: (e) => txt(e.entite) },
  { key: 'activite', label: 'Activité', render: (e) => txt(e.activite) },
  { key: 'sous_activite', label: 'Sous-activité', render: (e) => txt(e.sous_activite) },
  { key: 'trigramme', label: 'Trigramme', render: (e) => txt(e.trigramme) },
  { key: 'categorie_fnp', label: 'Catégorie FNP', render: (e) => txt(e.categorie_fnp) },
  {
    key: 'employe_fournisseur',
    label: 'Employé / fournisseur',
    render: truncated((e) => e.employe_fournisseur, 200),
    sensitive: true,
  },
  { key: 'nom_ressource', label: 'Nom ressource', render: truncated((e) => e.nom_ressource, 200), sensitive: true },
  { key: 'fournisseur', label: 'Fournisseur', render: truncated((e) => e.fournisseur, 200), sensitive: true },
  { key: 'matricule', label: 'Matricule', render: (e) => txt(e.matricule), sensitive: true, mono: true },
  {
    key: 'description_depenses',
    label: 'Description',
    render: truncated((e) => e.description_depenses, 280),
    sensitive: true,
  },
  { key: 'quantite', label: 'Quantité', render: (e) => fmtNumber(e.quantite), main: true, align: 'right' },
  {
    key: 'total_eur',
    label: 'Total €',
    render: (e) => fmtEur(e.total_eur, true),
    main: true,
    sort: 'total_eur',
    align: 'right',
  },
  { key: 'periode_comptable', label: 'Période comptable', render: (e) => fmtDate(e.periode_comptable) },
  { key: 'mois_comptable', label: 'Mois comptable', render: (e) => txt(e.mois_comptable) },
  { key: 'compte_comptable', label: 'Compte comptable', render: (e) => txt(e.compte_comptable) },
  { key: 'fpc', label: 'FPC', render: truncated((e) => e.fpc, 180) },
  { key: 'cea', label: 'CEA', render: (e) => txt(e.cea) },
  { key: 'num_facture', label: 'N° facture', render: (e) => txt(e.num_facture), sensitive: true },
  { key: 'num_commande', label: 'N° commande', render: (e) => txt(e.num_commande), sensitive: true },
  { key: 'num_ligne', label: 'N° ligne', render: (e) => txt(e.num_ligne), align: 'right' },
  { key: 'code_article', label: 'Code article', render: (e) => txt(e.code_article) },
  { key: 'lot_ifrs15', label: 'Lot IFRS15', render: (e) => txt(e.lot_ifrs15) },
  { key: 'row_num', label: 'Ligne du fichier', render: (e) => e.row_num, align: 'right', sort: 'row_num' },
  { key: 'motif_rejet', label: 'Motif', render: truncated((e) => e.motif_rejet, 260) },
];

export const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.main).map((c) => c.key);

// ------------------------------------------------------------------ inspecteur

export interface DetailField {
  label: string;
  value: (e: RealiseEntry) => ReactNode;
  sensitive?: boolean;
  mono?: boolean;
  numeric?: boolean;
}

/** Toutes les colonnes d'une écriture, groupées pour l'inspecteur (texte complet, sans troncature). */
export const DETAIL_GROUPS: { title: string; fields: DetailField[] }[] = [
  {
    title: 'Imputation',
    fields: [
      { label: 'TG', value: (e) => txt(e.tg), mono: true },
      { label: 'Libellé TG', value: (e) => txt(tgLabel(e)) },
      { label: 'WP', value: (e) => txt(e.wp), mono: true },
      { label: 'WP libellé', value: (e) => txt(e.wp_libelle) },
      { label: 'Entité', value: (e) => txt(e.entite) },
      { label: 'Activité', value: (e) => txt(e.activite) },
      { label: 'Sous-activité', value: (e) => txt(e.sous_activite) },
      { label: 'Trigramme', value: (e) => txt(e.trigramme) },
      { label: 'CEA', value: (e) => txt(e.cea) },
      { label: 'FPC', value: (e) => txt(e.fpc) },
      { label: 'Lot IFRS15', value: (e) => txt(e.lot_ifrs15) },
    ],
  },
  {
    title: 'Dépense',
    fields: [
      { label: 'Date', value: (e) => fmtDate(e.date_depense), numeric: true },
      { label: 'Catégorie', value: (e) => txt(e.categorie) },
      { label: 'Type', value: (e) => txt(e.type) },
      { label: 'Catégorie FNP', value: (e) => txt(e.categorie_fnp) },
      { label: 'Quantité', value: (e) => fmtNumber(e.quantite), numeric: true },
      { label: 'Total', value: (e) => fmtEur(e.total_eur, true), numeric: true },
      { label: 'Employé / fournisseur', value: (e) => txt(e.employe_fournisseur), sensitive: true },
      { label: 'Nom ressource', value: (e) => txt(e.nom_ressource), sensitive: true },
      { label: 'Fournisseur', value: (e) => txt(e.fournisseur), sensitive: true },
      { label: 'Matricule', value: (e) => txt(e.matricule), sensitive: true, mono: true },
      { label: 'Description', value: (e) => txt(e.description_depenses), sensitive: true },
      { label: 'Période comptable', value: (e) => fmtDate(e.periode_comptable), numeric: true },
      { label: 'Mois comptable', value: (e) => txt(e.mois_comptable) },
      { label: 'Compte comptable', value: (e) => txt(e.compte_comptable), mono: true },
      { label: 'N° facture', value: (e) => txt(e.num_facture), sensitive: true },
      { label: 'N° commande', value: (e) => txt(e.num_commande), sensitive: true },
      { label: 'N° ligne', value: (e) => txt(e.num_ligne), numeric: true },
      { label: 'Code article', value: (e) => txt(e.code_article) },
    ],
  },
];
