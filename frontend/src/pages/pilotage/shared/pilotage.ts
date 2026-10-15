// Utilitaires des pages Pilotage (hors composants) : couleurs des graphiques, formats courts, tri,
// statuts de prévision. Les composants partagés sont dans charts.tsx et ContextControl.tsx.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAppearance, type GlyphKind, type SortDir, type StatusTone } from '../../../ui';
import { fmtDate, fmtHours } from '../../../lib/format';
import type {
  AnalyseResult,
  Anomalie,
  AnomalieCategorie,
  Enveloppe,
  EnveloppesSynthese,
  PrevisionCT,
  PrevisionStatut,
  Previsions,
} from '../../../api/types';

// ------------------------------------------------------------------ Couleurs
// Les attributs SVG de recharts n'acceptent pas var(--…) de façon fiable : on résout les tokens
// en valeurs calculées, recalculées à chaque changement d'apparence (data-theme sur <html>).
function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const themeSnapshot = () => document.documentElement.getAttribute('data-theme') ?? '';

/** Valeurs calculées des tokens CSS demandés (ex. `--blue`), à jour du thème courant. */
export function useTokenColors<N extends string>(names: readonly N[]): Record<N, string> {
  const { resolved } = useAppearance();
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);
  const key = names.join('|');
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {} as Record<N, string>;
    for (const n of key.split('|') as N[]) out[n] = cs.getPropertyValue(n).trim();
    return out;
    // `resolved` et `theme` ne servent qu'à invalider le calcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resolved, theme]);
}

// ------------------------------------------------------------------ Formats
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const nbsp = ' ';

/** Euros abrégés : « 840 k€ », « 1,02 M€ », « 950 € ». */
export function fmtEurShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${nf2.format(v / 1e6)}${nbsp}M€`;
  if (a >= 1e3) return `${nf0.format(v / 1e3)}${nbsp}k€`;
  return `${nf0.format(v)}${nbsp}€`;
}

/** Euros abrégés signés : « +12 k€ » / « −1,2 M€ ». */
export function fmtEurShortSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0.5 ? '+' : v < -0.5 ? '−' : '';
  return `${s}${fmtEurShort(Math.abs(v))}`;
}

/** Euros signés : « +12 345 € » / « −4 000 € ». */
export function fmtEurSigned(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${nf0.format(Math.abs(Math.round(v)))}${nbsp}€`;
}

const nfEtp = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** ETP planifiés d'une semaine (DECISIONS n° 25) : « 3,5 ETP », une décimale. */
export function fmtEtp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${nfEtp.format(v)}${nbsp}ETP`;
}

/** "2026-W37" → « S37 ». */
export function weekShort(w: string | null | undefined): string {
  const m = w ? /W(\d{2})$/.exec(w) : null;
  return m ? `S${m[1]}` : (w ?? '—');
}

// ------------------------------------------------------------------ Tri
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export function useSort<K extends string>(initial: SortState<K>) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  return { sort, toggle };
}

export function cmp(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

// ------------------------------------------------------------------ Non couvert par le plan (DECISIONS n° 13)
/** Heures MO imputées sur des jours couverts par aucune version du plan (non analysées). */
export const heuresNonCouvertes = (result: AnalyseResult | undefined) => result?.kpis?.heures_non_couvertes ?? 0;

/** Phrase complète de la mention « non couvert ». */
export const uncoveredSentence = (h: number) =>
  `${fmtHours(h)} imputées sur des périodes non couvertes par le plan (non analysées)`;

// ------------------------------------------------------------------ Prévisions
/**
 * Prévisions exploitables (le calcul peut être absent ou vide). Sans aucune enveloppe, le global (périmètre des CT
 * avec enveloppe, DECISIONS n° 20) n'a pas de séries : les prévisions restent exploitables s'il y a des CT.
 */
export function forecastOf(result: AnalyseResult): Previsions | null {
  return forecastFrom(result.previsions);
}

/** Même contrôle sur des prévisions servies seules (`GET /analyse/previsions?annee=`, DECISIONS n° 24). */
export function forecastFrom(p: Previsions | null | undefined): Previsions | null {
  if (!p || !p.global || !p.as_of) return null;
  if (!p.global.series?.length && !p.par_ct?.length) return null;
  return p;
}

// ------------------------------------------------------------------ Date de référence (DECISIONS n° 31)
type RefDates = Partial<Pick<Previsions, 'date_reference' | 'as_of'>>;

/**
 * « Référence : plan en effet au 01/10/2026 ». `short` : dates JJ/MM (sous-titres de barre d'outils). Serveur sans
 * date de référence : ancien libellé.
 */
export function referenceLabel(fc: RefDates | null | undefined, short = false): string {
  if (!fc) return '';
  const f = short ? fmtDayMonth : fmtDate;
  if (!fc.date_reference) return fc.as_of ? `Données arrêtées au ${f(fc.as_of)}` : '';
  return `Référence : plan en effet au ${f(fc.date_reference)}`;
}

/** Bulle du libellé de référence : ce qui part de cette date. */
export const REFERENCE_HELP =
  'Consommé, rythme et atterrissage partent de la date d’effet du dernier plan ; le réalisé daté ensuite n’est pas pris en compte (DECISIONS n° 32)';

// ------------------------------------------------------------------ Filtre d'année (DECISIONS n° 24)
/** Année des prévisions affichées (0 = Tout), lue sur les données elles-mêmes : les mots suivent toujours les chiffres. */
export const anneeOf = (fc: Pick<Previsions, 'annee'> | null | undefined): number => (fc?.annee && fc.annee > 0 ? fc.annee : 0);

/** « en 2027 » (avec l'espace initiale) quand une année est choisie, '' pour Tout. */
export const enAnnee = (annee: number | null | undefined): string => (annee && annee > 0 ? ` en ${annee}` : '');

export const STATUT_LABEL: Record<PrevisionStatut, string> = {
  ok: 'Dans le budget',
  vigilance: 'Vigilance',
  depassement: 'Dépassement',
};

export const SOUS_CONSO_LABEL = 'Sous-consommation';

/**
 * Ton d'une ligne CT : dépassement ou risque de sécurisation (rouge), vigilance ou sous-consommation (orange).
 * La sous-consommation est un indicateur séparé du statut (DECISIONS n° 17). Sans enveloppe (statut null,
 * DECISIONS n° 20) : aucun ton budgétaire.
 */
// Une ligne ne montre qu'un risque budgétaire ; la bulle cite tous les risques.
export function rowTone(statut: PrevisionStatut | null | undefined, risque = false, sousConso = false): 'danger' | 'warning' | undefined {
  if (risque) return 'danger';
  if (sousConso) return 'warning';
  if (statut === 'depassement') return 'danger';
  if (statut === 'vigilance') return 'warning';
  return undefined;
}

/**
 * Glyphe d'une ligne CT. Forme = sens : octogone (dépassement, risque), triangle (vigilance),
 * cercle « ! » (sous-consommation : budget perdu s'il n'est pas consommé, comme le cercle de la sous-imputation).
 */
export function rowGlyph(
  statut: PrevisionStatut | null | undefined,
  risque = false,
  sousConso = false,
): { kind: GlyphKind; tone: StatusTone } | null {
  if (risque) return { kind: 'danger', tone: 'danger' };
  if (sousConso) return SOUS_CONSO_GLYPH;
  if (statut === 'depassement') return { kind: 'danger', tone: 'danger' };
  if (statut === 'vigilance') return { kind: 'warning', tone: 'warning' };
  return null;
}

/** Glyphe du risque de sous-consommation (cercle « ! » orange). */
export const SOUS_CONSO_GLYPH: { kind: GlyphKind; tone: StatusTone } = { kind: 'attention', tone: 'attention' };

/**
 * Raison affichée en bulle du glyphe d'une ligne CT. Le budget est l'enveloppe (DECISIONS n° 20) : un CT sans
 * enveloppe n'a ni statut ni sous-consommation, seul le risque de sécurisation peut rester.
 */
export function rowReason(statut: PrevisionStatut | null | undefined, risque = false, sousConso = false): string {
  const parts: string[] = [];
  if (sousConso) parts.push('Enveloppe qui risque de ne pas être consommée (fin de l’enveloppe)');
  if (statut === 'depassement') parts.push('Atterrissage au-delà de l’enveloppe (sur-imputation)');
  if (statut === 'vigilance') parts.push('Atterrissage proche de l’enveloppe');
  if (risque) parts.push('Provisions pour aléas (non sécurisées) au-delà du seuil');
  return parts.join(' · ');
}

// ------------------------------------------------------------------ Échéance (fin de l'enveloppe, DECISIONS n° 19, 20)
/** CT (ou périmètre) qui a un budget, c'est-à-dire une enveloppe importée (DECISIONS n° 20). */
export const hasEnveloppe = (p: Pick<PrevisionCT, 'budget_source' | 'budget'> | null | undefined): boolean =>
  !!p && p.budget_source === 'enveloppe' && p.budget != null;

/** Situation à la fin de l'enveloppe d'un CT ou du périmètre : l'enveloppe non consommée à l'échéance est perdue. */
export interface Echeance {
  /**
   * `enveloppe` : un CT, échéance = fin de son enveloppe ; `perimetre` : global (CT avec enveloppe, chacun sur sa
   * période, montants sommés CT par CT), échéance = la plus tardive des fins.
   */
  kind: 'enveloppe' | 'perimetre';
  /** Enveloppe du CT (kind `enveloppe`), null sinon. */
  enveloppe: Enveloppe | null;
  /** Fin de l'enveloppe (YYYY-MM-DD). */
  date: string;
  /** Montant de l'enveloppe (périmètre : Σ enveloppes). */
  budget: number;
  /**
   * Atterrissage sécurisé à l'échéance (consommé + plan de charge restant + provisions sécurisées, DECISIONS n° 23) :
   * seule base du non consommé et du dépassement (DECISIONS n° 21).
   */
  projPlan: number;
  /** Projection tendance à l'échéance : repère (trace, vigilance), jamais source d'un montant (DECISIONS n° 21). */
  projTendance: number;
  /** Enveloppe que le plan de charge et les provisions sécurisées ne consommeront pas, donc perdue (≥ 0, DECISIONS n° 21, 23). */
  nonConsomme: number;
  /** Dépassement de l'enveloppe par l'atterrissage sécurisé (`ecart_plan`, DECISIONS n° 21), 0 sinon. */
  depassement: number;
  rythmeNecessaire: number;
  /** Rythme réalisé des 4 semaines avant la date de référence (`rythme_hebdo`). */
  rythmeActuel: number;
  /** Rythme prévu par le plan de charge : reste à faire ÷ semaines restantes (DECISIONS n° 33), 0 sans semaine. */
  rythmePdc: number;
  semaines: number;
  /** Au-delà des seuils de sous-consommation (Réglages). */
  sousConso: boolean;
  /** Année N : fin de l'enveloppe entière quand elle continue après N (DECISIONS n° 35), '' sinon. */
  poursuite: string;
  /**
   * Année du filtre (DECISIONS n° 24), 0 = Tout. Avec une année, l'enveloppe est la tranche de l'année et l'échéance
   * la fin de cette tranche : les mots disent « l'enveloppe en 2027 ».
   */
  annee: number;
}

/** Échéance de l'enveloppe (tranche de l'année `annee`, 0 = Tout) ; null sans enveloppe (aucun budget, DECISIONS n° 20). */
export function echeanceOf(p: PrevisionCT | null | undefined, annee = 0): Echeance | null {
  if (!p || !hasEnveloppe(p) || !p.echeance) return null;
  const budget = p.budget_echeance ?? p.budget ?? 0;
  const projPlan = p.projection_plan_echeance ?? 0;
  const projTendance = p.projection_tendance_echeance ?? 0;
  const nonConsomme = Math.max(0, p.non_consomme ?? 0);
  const semaines = p.semaines_echeance ?? 0;
  return {
    kind: p.enveloppe ? 'enveloppe' : 'perimetre',
    enveloppe: p.enveloppe ?? null,
    date: p.enveloppe?.date_fin ?? p.echeance,
    budget,
    projPlan,
    projTendance,
    nonConsomme,
    // Plan seul (DECISIONS n° 21). Ni un CT ni le périmètre (solde net, enveloppes fongibles, n° 34) n'ont les deux.
    depassement: nonConsomme > 0.5 ? 0 : Math.max(0, p.ecart_plan ?? projPlan - budget),
    rythmeNecessaire: p.rythme_necessaire ?? 0,
    rythmeActuel: p.rythme_hebdo ?? 0,
    rythmePdc: semaines > 0 ? p.reste_a_faire / semaines : 0,
    semaines,
    sousConso: p.sous_consommation ?? false,
    poursuite: p.poursuite ?? '',
    annee: annee > 0 ? annee : 0,
  };
}

/** "2026-12-31" → « 31/12 ». */
export function fmtDayMonth(d: string | null | undefined): string {
  const m = d ? /^\d{4}-(\d{2})-(\d{2})/.exec(d) : null;
  return m ? `${m[2]}/${m[1]}` : '—';
}

/** « il faudrait 12 k€/sem. (actuel 8 k€/sem.) », ou null s'il ne reste aucune semaine. */
export function paceText(e: Echeance): string | null {
  if (e.semaines <= 0) return null;
  return `il faudrait ${fmtEurShort(e.rythmeNecessaire)}/sem. (actuel ${fmtEurShort(e.rythmeActuel)}/sem.)`;
}

/** Mots de l'échéance : fin de l'enveloppe d'un CT, ou fin des enveloppes du périmètre. */
export interface EcheanceWords {
  /**
   * « à la fin de l'enveloppe (30/06) », « à la fin des enveloppes (31/12) » ; année choisie : « à la fin de
   * l'enveloppe en 2027 (31/12) » (fin de la tranche de l'année, DECISIONS n° 24).
   */
  when: string;
  /** Repère : « Fin de l'enveloppe 30/06 », « Fin des enveloppes 31/12 ». */
  marker: string;
  /** « enveloppe », « total des enveloppes ». */
  budget: string;
  /** « de l'enveloppe », « du total des enveloppes ». */
  of: string;
  /** « l'enveloppe », « le total des enveloppes ». */
  the: string;
  /** Accord : « l'enveloppe serait dépassée ». */
  fem: boolean;
}

export function echeanceWords(e: Echeance): EcheanceWords {
  const d = fmtDayMonth(e.date);
  const en = enAnnee(e.annee);
  const y = e.annee > 0 ? ` ${e.annee}` : '';
  if (e.kind === 'perimetre')
    return {
      when: `à la fin des enveloppes${en} (${d})`,
      marker: `Fin des enveloppes${en} ${d}`,
      budget: `total des enveloppes${y}`,
      of: `du total des enveloppes${y}`,
      the: `le total des enveloppes${y}`,
      fem: false,
    };
  return {
    when: `à la fin de l’enveloppe${en} (${d})`,
    marker: `Fin de l’enveloppe${en} ${d}`,
    budget: `enveloppe${y}`,
    of: `de l’enveloppe${y}`,
    the: `l’enveloppe${y}`,
    fem: true,
  };
}

/** Majuscule initiale. */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ Enveloppes (DECISIONS n° 19)
/**
 * Plan de charge face aux enveloppes : synthèse du backend, ou recalculée depuis `par_ct` (backend qui
 * fournit les enveloppes par CT sans la synthèse). Sans aucune enveloppe : nb_configures = 0.
 */
export function enveloppesOf(fc: Previsions | null | undefined): EnveloppesSynthese | null {
  if (!fc) return null;
  if (fc.enveloppes && typeof fc.enveloppes.nb_configures === 'number') return fc.enveloppes;
  const s: EnveloppesSynthese = {
    nb_ct: fc.par_ct.length,
    nb_configures: 0,
    montant: 0,
    atterrissage: 0,
    ecart: 0,
    depassement: 0,
    nb_depassement: 0,
    non_consomme: 0,
    nb_sous_consommation: 0,
    plan_hors_enveloppe: 0,
    nb_poursuite: 0,
    montant_poursuite: 0,
  };
  let ecart = 0;
  for (const p of fc.par_ct) {
    if (!p.enveloppe) continue;
    s.nb_configures += 1;
    s.montant += p.enveloppe.montant;
    s.atterrissage += p.atterrissage_plan;
    // DECISIONS n° 22 : montant et compteur sortent de la même règle (statut), un résidu d'arrondi n'est pas agrégé.
    if (p.statut === 'depassement') {
      s.depassement += p.ecart_plan ?? 0;
      s.nb_depassement += 1;
    }
    s.non_consomme += Math.max(0, p.non_consomme ?? 0);
    if (p.sous_consommation) s.nb_sous_consommation += 1;
    s.plan_hors_enveloppe += p.plan_hors_enveloppe ?? 0;
    // Écart à terminaison (DECISIONS n° 35) : une enveloppe qui se poursuit n'y porte que son dépassement.
    const e = p.atterrissage_plan - p.enveloppe.montant;
    ecart += p.poursuite ? Math.max(0, e) : e;
    if (p.poursuite) {
      s.nb_poursuite = (s.nb_poursuite ?? 0) + 1;
      s.montant_poursuite = (s.montant_poursuite ?? 0) + p.enveloppe.montant;
    }
  }
  s.ecart = ecart;
  return s;
}

// ------------------------------------------------------------------ Anomalies
export const CATEGORIE_LABEL: Record<AnomalieCategorie, string> = {
  ecart: 'Écarts de charge',
  ct_risque: 'CT à risque',
  derive: 'Dérives de provision',
  qualite: 'Qualité des données',
  budget: 'Prévisions budgétaires',
};

/** Anomalie de sous-consommation (clé `budget_sous_conso|CT`). */
export const isSousConsoAnomalie = (a: Pick<Anomalie, 'key'>) => a.key.startsWith('budget_sous_conso|');

/** Glyphe d'une anomalie hors écart : sous-consommation = cercle « ! » du risque de perte, sinon gravité. */
export function anomalieGlyph(a: Pick<Anomalie, 'key' | 'gravite'>): { kind: GlyphKind; tone: StatusTone } {
  return isSousConsoAnomalie(a) ? SOUS_CONSO_GLYPH : graviteGlyph(a.gravite);
}

/** Glyphe d'une gravité : 3 octogone rouge, 2 triangle orange, 1 cercle. */
export function graviteGlyph(g: number): { kind: GlyphKind; tone: StatusTone } {
  if (g >= 3) return { kind: 'danger', tone: 'danger' };
  if (g === 2) return { kind: 'warning', tone: 'warning' };
  return { kind: 'attention', tone: 'attention' };
}

/** Anomalies à traiter, regroupées par catégorie (ordre de première apparition = gravité). */
export function anomaliesATraiter(list: Anomalie[] | null | undefined) {
  const open = (list ?? []).filter((a) => a.statut === 'a_traiter');
  const byCat = new Map<AnomalieCategorie, { categorie: AnomalieCategorie; count: number; gravite: number }>();
  for (const a of open) {
    const c = byCat.get(a.categorie) ?? { categorie: a.categorie, count: 0, gravite: 0 };
    c.count += 1;
    c.gravite = Math.max(c.gravite, a.gravite);
    byCat.set(a.categorie, c);
  }
  const categories = [...byCat.values()].sort((a, b) => b.gravite - a.gravite || b.count - a.count);
  const top = [...open].sort((a, b) => b.gravite - a.gravite).slice(0, 3);
  return { total: open.length, categories, top };
}

/** Libellé de l'atterrissage (DECISIONS n° 23) et sa définition, pour les bulles. */
export const ATTERRISSAGE_LABEL = 'Atterrissage sécurisé';
export const ATTERRISSAGE_HELP = 'consommé + plan de charge restant + provisions sécurisées';

/**
 * CT sans enveloppe (DECISIONS n° 20) : « Sans enveloppe : 42 k€ consommés, atterrissage sécurisé 80 k€ » ;
 * année choisie : « Sans enveloppe en 2027 : … ».
 */
export const sansEnveloppeSentence = (p: Pick<PrevisionCT, 'consomme' | 'atterrissage_plan'>, annee = 0) =>
  `Sans enveloppe${enAnnee(annee)} : ${fmtEurShort(p.consomme)} consommés, atterrissage sécurisé ${fmtEurShort(p.atterrissage_plan)}`;

/**
 * Phrase de lecture de la trajectoire vers l'enveloppe (DECISIONS n° 20) : ce qui risque d'être perdu, sinon le
 * dépassement, sinon l'atterrissage sécurisé (DECISIONS n° 23) face à l'enveloppe. Sans enveloppe : consommé et
 * atterrissage seuls. `annee` (DECISIONS n° 24) : tranche de l'année, « à la fin de l'enveloppe en 2027 ».
 */
export function forecastSentence(p: PrevisionCT, annee = 0): string {
  const e = echeanceOf(p, annee);
  if (!e || p.budget == null) return `${sansEnveloppeSentence(p, annee)}.`;
  const w = echeanceWords(e);
  // Même lecture que le statut et le point d'arrivée de la trajectoire : dépassement, puis sous-consommation
  // (au-delà des seuils seulement : sous eux, l'atterrissage est dans la zone cible).
  if (p.ecart_plan != null && p.ecart_plan > 0.5)
    return `Atterrissage sécurisé ${fmtEurShort(p.atterrissage_plan)} ${w.when}, soit ${fmtEurShort(p.ecart_plan)} au-dessus ${w.of} (${fmtEurShort(p.budget)}).`;
  if (p.sous_consommation && e.nonConsomme > 0.5)
    return `${capitalize(w.when)}, ${fmtEurShort(e.nonConsomme)} ${w.of} (${fmtEurShort(e.budget)}) risquent d’être perdus (plan de charge + provisions sécurisées).`;
  const inTarget = p.cible_min != null && p.atterrissage_plan >= p.cible_min - 0.5 && p.atterrissage_plan <= p.budget + 0.5;
  const what = e.kind === 'perimetre' ? `des enveloppes${e.annee > 0 ? ` ${e.annee}` : ''}` : `une enveloppe${e.annee > 0 ? ` ${e.annee}` : ''}`;
  return `Atterrissage sécurisé ${fmtEurShort(p.atterrissage_plan)} ${w.when} pour ${what} de ${fmtEurShort(p.budget)}${inTarget ? ', dans la zone cible' : ''}.`;
}
