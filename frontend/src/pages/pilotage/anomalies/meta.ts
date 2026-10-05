// Libellés, ordre et glyphes des anomalies ; utilitaires de recherche partagés avec la page Écarts.
import type { GlyphKind, StatusTone } from '../../../ui';
import type { Anomalie, AnomalieCategorie, AnomalieStatut } from '../../../api/types';
import type { UseAnalyse } from '../shared/context';
import { fmtEur, fmtHours, fmtHoursSigned, fmtWeek } from '../../../lib/format';

/** Ordre d'affichage des groupes (le plus coûteux d'abord). */
export const CATEGORIES: AnomalieCategorie[] = ['budget', 'ct_risque', 'ecart', 'derive', 'qualite', 'correspondance'];

export const CATEGORIE_LABEL: Record<AnomalieCategorie, string> = {
  budget: 'Budget',
  ct_risque: 'CT à risque',
  ecart: "Écarts d'imputation",
  derive: 'Dérive des provisions',
  qualite: 'Qualité des données',
  correspondance: 'Correspondances',
};

export const GRAVITE_LABEL: Record<Anomalie['gravite'], string> = { 3: 'Haute', 2: 'Moyenne', 1: 'Basse' };

/** Glyphe de gravité : la forme porte le sens (octogone, triangle, cercle). */
export const GRAVITE_GLYPH: Record<Anomalie['gravite'], { kind: GlyphKind; tone: StatusTone }> = {
  3: { kind: 'danger', tone: 'danger' },
  2: { kind: 'warning', tone: 'warning' },
  1: { kind: 'attention', tone: 'attention' },
};

export const STATUT_LABEL: Record<AnomalieStatut, string> = {
  a_traiter: 'À traiter',
  traitee: 'Traitée',
  ignoree: 'Ignorée',
};

/** Vues de la boîte (paramètre d'URL `vue`). */
export type Vue = 'a_traiter' | 'traitees' | 'ignorees' | 'toutes';
export const VUES: { value: Vue; label: string }[] = [
  { value: 'a_traiter', label: 'À traiter' },
  { value: 'traitees', label: 'Traitées' },
  { value: 'ignorees', label: 'Ignorées' },
  { value: 'toutes', label: 'Toutes' },
];
export const readVue = (v: string | null): Vue => VUES.find((x) => x.value === v)?.value ?? 'a_traiter';

export function inVue(a: Anomalie, vue: Vue): boolean {
  if (vue === 'toutes') return true;
  if (vue === 'traitees') return a.statut === 'traitee';
  if (vue === 'ignorees') return a.statut === 'ignoree';
  return a.statut === 'a_traiter';
}

/** Minuscules sans accents, pour la recherche. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Texte indexé par la recherche. */
export const searchText = (a: Anomalie) =>
  norm([a.titre, a.detail, a.ct, a.ct_libelle, a.ressource, a.nom_realise].filter(Boolean).join(' '));

/** Heures d'une anomalie : signées pour un écart. */
export const fmtAnomalieHeures = (a: Anomalie) =>
  a.heures == null ? null : a.categorie === 'ecart' ? fmtHoursSigned(a.heures) : fmtHours(a.heures);

/** Sous-ligne de la liste : montant ou heures, puis CT. */
export function subline(a: Anomalie): string {
  const parts = [a.montant != null ? fmtEur(a.montant) : fmtAnomalieHeures(a), a.ct].filter(Boolean);
  return parts.length ? parts.join(' · ') : CATEGORIE_LABEL[a.categorie];
}

/** « S36 » (sans l'année). */
export const shortWeek = (w: string) => fmtWeek(w).split(' ')[0];

/** Liste de semaines compacte : « S36 → S40 » si contiguës, sinon énumération. */
export function fmtWeeks(weeks: string[] | undefined): string | null {
  if (!weeks?.length) return null;
  const s = [...weeks].sort();
  if (s.length === 1) return shortWeek(s[0]);
  const num = (w: string) => {
    const m = /^(\d{4})-W(\d{2})$/.exec(w);
    return m ? Number(m[1]) * 53 + Number(m[2]) : NaN;
  };
  const contiguous = s.every((w, i) => i === 0 || num(w) - num(s[i - 1]) === 1);
  return contiguous ? `${shortWeek(s[0])} → ${shortWeek(s[s.length - 1])}` : s.map(shortWeek).join(', ');
}

/** Lien vers une anomalie d'écart (clé stable « ecart|CT|ressource|flag »), visible quel que soit son statut. */
export const ecartAnomalieLink = (ct: string, ressource: string, flag: string) =>
  `/anomalies?vue=toutes&key=${encodeURIComponent(`ecart|${ct}|${ressource}|${flag}`)}`;

/** Le résultat peut être affiché (aucun état d'AnalyseGate en cours). */
export const isAnalyseShown = (a: UseAnalyse) =>
  !a.context.isLoading && !a.context.error && a.ready && !a.result.error && !!a.result.data;

/** « Écarts d'imputation · Gravité haute » (+ statut s'il est réglé). */
export const anomalySubtitle = (a: Anomalie) =>
  [CATEGORIE_LABEL[a.categorie], `Gravité ${GRAVITE_LABEL[a.gravite].toLowerCase()}`, a.statut !== 'a_traiter' && STATUT_LABEL[a.statut]]
    .filter(Boolean)
    .join(' · ');
