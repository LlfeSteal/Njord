// Définition des colonnes de la table des écritures du réalisé.
import type { ReactNode } from 'react';
import { Text, Tooltip } from '@mantine/core';
import type { RealiseEntry } from '../../api/types';
import type { RealiseEntriesQuery } from '../../api/client';
import { ParsingBadge } from '../../components/badges';
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
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : v);

/** Texte tronqué sur une ligne, complet en infobulle. */
function Truncated({ value, maw = 240 }: { value: string; maw?: number }) {
  if (!value) return <>—</>;
  return (
    <Tooltip label={value} multiline maw={420} withArrow openDelay={300}>
      <Text size="sm" truncate="end" maw={maw}>
        {value}
      </Text>
    </Tooltip>
  );
}

function TgCell({ e }: { e: RealiseEntry }) {
  // tg_libelle = « CT_xxx - libellé » : on affiche le libellé seul sous le code.
  const lib = e.tg_libelle && e.tg_libelle.startsWith(e.tg) ? e.tg_libelle.slice(e.tg.length).replace(/^\s*-\s*/, '') : e.tg_libelle;
  return (
    <div style={{ minWidth: 120 }}>
      <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
        {txt(e.tg)}
      </Text>
      {lib ? (
        <Tooltip label={e.tg_libelle} multiline maw={420} withArrow openDelay={300}>
          <Text size="xs" c="dimmed" truncate="end" maw={220}>
            {lib}
          </Text>
        </Tooltip>
      ) : null}
    </div>
  );
}

const nowrap = (v: ReactNode) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>;

export const COLUMNS: EntryColumn[] = [
  { key: 'row_num', label: 'Ligne', render: (e) => e.row_num, align: 'right', sort: 'row_num' },
  { key: 'date_depense', label: 'Date dépense', render: (e) => nowrap(fmtDate(e.date_depense)), main: true, sort: 'date_depense' },
  { key: 'entite', label: 'Entité', render: (e) => txt(e.entite) },
  { key: 'activite', label: 'Activité', render: (e) => txt(e.activite) },
  { key: 'sous_activite', label: 'Sous-activité', render: (e) => txt(e.sous_activite) },
  { key: 'trigramme', label: 'Trigramme', render: (e) => txt(e.trigramme) },
  { key: 'tg', label: 'TG', render: (e) => <TgCell e={e} />, main: true, sort: 'tg' },
  {
    key: 'wp',
    label: 'WP',
    render: (e) =>
      e.wp ? (
        <Tooltip label={e.wp_libelle || e.wp} multiline maw={420} withArrow openDelay={300} disabled={!e.wp_libelle}>
          <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
            {e.wp}
          </Text>
        </Tooltip>
      ) : (
        '—'
      ),
    main: true,
  },
  { key: 'wp_libelle', label: 'WP libellé', render: (e) => <Truncated value={e.wp_libelle} /> },
  { key: 'categorie', label: 'Catégorie', render: (e) => nowrap(txt(e.categorie)), main: true },
  { key: 'type', label: 'Type', render: (e) => <Truncated value={e.type} maw={200} />, main: true },
  { key: 'categorie_fnp', label: 'Catégorie FNP', render: (e) => txt(e.categorie_fnp) },
  { key: 'employe_fournisseur', label: 'Employé / fournisseur', render: (e) => <Truncated value={e.employe_fournisseur} maw={200} />, main: true, sensitive: true },
  { key: 'nom_ressource', label: 'Nom ressource', render: (e) => <Truncated value={e.nom_ressource} maw={200} />, sensitive: true },
  { key: 'fournisseur', label: 'Fournisseur', render: (e) => <Truncated value={e.fournisseur} maw={200} />, sensitive: true },
  { key: 'matricule', label: 'Matricule', render: (e) => txt(e.matricule), sensitive: true },
  { key: 'description_depenses', label: 'Description', render: (e) => <Truncated value={e.description_depenses} maw={280} />, sensitive: true },
  { key: 'quantite', label: 'Quantité', render: (e) => nowrap(fmtNumber(e.quantite)), main: true, align: 'right' },
  {
    key: 'total_eur',
    label: 'Total €',
    render: (e) => (
      <Text size="sm" c={e.total_eur < 0 ? 'red' : undefined} style={{ whiteSpace: 'nowrap' }} fw={500}>
        {fmtEur(e.total_eur, true)}
      </Text>
    ),
    main: true,
    sort: 'total_eur',
    align: 'right',
  },
  { key: 'periode_comptable', label: 'Période comptable', render: (e) => nowrap(fmtDate(e.periode_comptable)), main: true },
  { key: 'mois_comptable', label: 'Mois comptable', render: (e) => txt(e.mois_comptable) },
  { key: 'compte_comptable', label: 'Compte comptable', render: (e) => txt(e.compte_comptable) },
  { key: 'fpc', label: 'FPC', render: (e) => <Truncated value={e.fpc} maw={180} /> },
  { key: 'cea', label: 'CEA', render: (e) => txt(e.cea) },
  { key: 'num_facture', label: 'N° facture', render: (e) => txt(e.num_facture), sensitive: true },
  { key: 'num_commande', label: 'N° commande', render: (e) => txt(e.num_commande), sensitive: true },
  { key: 'num_ligne', label: 'N° ligne', render: (e) => txt(e.num_ligne), align: 'right' },
  { key: 'code_article', label: 'Code article', render: (e) => txt(e.code_article) },
  { key: 'lot_ifrs15', label: 'Lot IFRS15', render: (e) => txt(e.lot_ifrs15) },
  {
    key: 'statut_parsing',
    label: 'Statut',
    render: (e) => (e.statut_parsing === 'ok' ? <Text size="xs" c="dimmed">ok</Text> : <ParsingBadge statut={e.statut_parsing} motif={e.motif_rejet} />),
    main: true,
  },
  { key: 'motif_rejet', label: 'Motif', render: (e) => <Truncated value={e.motif_rejet} maw={260} /> },
];

export const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.main).map((c) => c.key);
