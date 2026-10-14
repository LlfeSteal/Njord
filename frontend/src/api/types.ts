// Miroir exact de backend/internal/domain/domain.go (contrat API).
// Ne modifier qu'en même temps que le Go (intégrateur).
// Dates : "YYYY-MM-DD" ("" = absent) ; horodatages : ISO 8601.

export type Kind = 'plan' | 'realise' | 'provision';
export type VersionStatut = 'active' | 'archivee' | 'purgee';
export type ParsingStatut = 'ok' | 'warn' | 'drop';

export interface Version {
  id: string;
  kind: Kind;
  intitule: string;
  importee_le: string;
  importeur: string;
  statut: VersionStatut;
  archivee_le: string | null;
  purgee_le: string | null;
  nb_lignes: number;
  nb_warn: number;
  nb_drop: number;
  periode_debut: string;
  periode_fin: string;
  source_format: string; // 'spec' | 'demo' | 'provisions'
  filename: string;
  layout?: string; // plan : 'A' | 'B' | 'mixte'
  montant_total_eur?: number; // réalisé, provisions : Σ € des lignes acceptées
  /** Plan : date à partir de laquelle la version remplace les précédentes (timeline, DECISIONS n° 13). */
  date_effet?: string;
}

export interface ParseIssue {
  row_num: number;
  statut: ParsingStatut;
  motif: string;
}

export interface ImportReport {
  kind: Kind;
  intitule: string;
  filename: string;
  source_format: string;
  sheet_name: string;
  header_row: number;
  total: number;
  ok: number;
  warn: number;
  drop: number;
  periode_debut: string;
  periode_fin: string;
  layout?: string;
  pct_inactifs?: number;
  nouvelles_personnes?: string[];
  nouveaux_squads?: string[];
  /** Plan : date d'effet proposée (= periode_debut) pour pré-remplir l'import. */
  date_effet_proposee?: string;
  montant_total_eur?: number;
  issues: ParseIssue[];
  motifs_count: Record<string, number>;
  active_version: Version | null;
}

export interface ImportResult {
  version: Version;
  report: ImportReport;
}

// ---------------------------------------------------------------- Provisions (DECISIONS n° 16)
/** Fonds disponibles non engagés (informatif : le budget est l'enveloppe, DECISIONS n° 20). */
export interface ProvisionLine {
  id: number;
  version_id: string;
  row_num: number;
  ct: string;
  libelle: string;
  /** € : colonne « .PPS », à défaut « Quantité ». */
  montant: number;
  unite: string;
  ligne_cout: string;
  type_depense: string;
  /** Informative : le budget ne dépend pas de la date. */
  date_debut: string;
  date_fin: string;
  groupe: string;
  statut_parsing: ParsingStatut;
  motif_rejet: string;
}

export interface ProvisionLinesPage {
  items: ProvisionLine[];
  total: number;
  totals: { montant: number };
}

// ---------------------------------------------------------------- Plan
export interface PlanLine {
  id: number;
  version_id: string;
  row_num: number;
  layout: string;
  ct: string;
  /** Code brut du fichier : n'identifie personne (affiché nulle part, export CSV seulement). */
  ressource: string;
  libelle: string;
  /** Identité : « NOM Prénom » extrait du libellé ('' = ligne non nominative). */
  nom_prenom: string;
  type_affectation: string;
  ligne_cout: string;
  charge_totale: number;
  pps: number;
  pourcentage: number;
  unite: string;
  calcul_duree: string;
  date_debut: string;
  date_fin: string;
  quantite_affectee: number | null;
  taux_fixe: string;
  depuis: string;
  pendant: string;
  statut_parsing: ParsingStatut;
  motif_rejet: string;
  inactive: boolean;
  personne_id: string | null;
  squad_id: string | null;
  groupe: string;
}

export interface PlanLinesPage {
  items: PlanLine[];
  total: number;
  totals: { charge_totale: number; pps: number };
}

// ---------------------------------------------------------------- Réalisé
export interface RealiseEntry {
  id: number;
  version_id: string;
  row_num: number;
  entite: string;
  activite: string;
  sous_activite: string;
  trigramme: string;
  tg: string;
  tg_libelle: string;
  wp: string;
  wp_libelle: string;
  description_depenses: string;
  categorie: string;
  type: string;
  categorie_fnp: string;
  employe_fournisseur: string;
  /** « NOM Prénom » d'EMPLOYE/FOURNISSEUR, civilité retirée ('' si non identifiable). Sensible. */
  nom_prenom: string;
  matricule: string;
  fpc: string;
  cea: string;
  quantite: number;
  total_eur: number;
  date_depense: string;
  periode_comptable: string;
  compte_comptable: string;
  num_facture: string;
  num_commande: string;
  num_ligne: number | null;
  lot_ifrs15: string;
  nom_ressource: string;
  fournisseur: string;
  code_article: string;
  mois_comptable: string;
  statut_parsing: ParsingStatut;
  motif_rejet: string;
}

export interface RealiseEntriesPage {
  items: RealiseEntry[];
  total: number;
  totals: { quantite: number; total_eur: number; par_categorie: Record<string, number> };
}

export type Facets = Record<string, string[]>;

// ---------------------------------------------------------------- Référentiels
/** Présence d'un CT dans chaque source (DECISIONS n° 18). */
export interface EnveloppeSources {
  /** Lignes non rejetées d'une version de plan non purgée. */
  plan: boolean;
  /** Écritures du réalisé actif. */
  realise: boolean;
  /** Lignes de la version de provisions active. */
  provisions: boolean;
}

/** Enveloppe d'un CT, saisie dans l'interface (DECISIONS n° 27) : période d'utilisation + montant. */
export interface Enveloppe {
  /** YYYY-MM-DD */
  date_debut: string;
  /** YYYY-MM-DD, ≥ date_debut */
  date_fin: string;
  /** € ≥ 0 */
  montant: number;
}

/** CT connu des sources ou ayant une enveloppe ; `enveloppe` null = « sans enveloppe ». */
export interface EnveloppeCT {
  ct: string;
  ct_libelle: string;
  /** Code de catégorie hérité de l'ancien import (…00) ; '' sinon. */
  categorie: string;
  /** Libellé libre de la catégorie ; '' = hors catégorie. */
  categorie_libelle: string;
  sources: EnveloppeSources;
  enveloppe: Enveloppe | null;
}

/** Corps de PUT /enveloppes/:ct (saisie dans l'interface, DECISIONS n° 27). */
export interface EnveloppeInput {
  /** YYYY-MM-DD */
  date_debut: string;
  /** YYYY-MM-DD, ≥ date_debut */
  date_fin: string;
  /** € ≥ 0 */
  montant: number;
  /** Libellé libre de la catégorie ('' = hors catégorie). */
  categorie: string;
  operateur?: string;
}

/** GET /enveloppes : CT triés par libellé de catégorie puis CT, hors catégorie puis sans enveloppe en dernier. */
export interface EnveloppesListe {
  cts: EnveloppeCT[];
}

/** Personne identifiée uniquement par NOM + Prénom. */
export interface Personne {
  id: string;
  /** « NOM Prénom » */
  display_name: string;
  /** Clé d'identité, ex. « DE LA TOUR|ANTOINE » (unique). */
  nom_normalise: string;
  statut: 'brouillon' | 'validee';
  squad_id: string | null;
  created_at: string;
}

export interface Squad {
  id: string;
  nom_canonique: string;
  alias: string[];
  entite_rattachee: string;
  parent_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------- Paramètres
export interface Settings {
  seuil_sur_imputation_h: number;
  seuil_sous_imputation_h: number;
  seuil_ct_risque_eur: number;
  seuil_non_securise_pct: number;
  purge_delai_jours: number;
  seuil_quantite_semaine_h: number;
  seuil_ecart_tg_eur: number;
  /** Sous-consommation : non consommé > seuil_sous_conso_pct % de l'enveloppe et > seuil_sous_conso_eur (DECISIONS n° 20). */
  seuil_sous_conso_pct: number;
  seuil_sous_conso_eur: number;
  diviseur_hors_plan_h: number;
  semaines_verrouillees: number[];
  jours_feries: string[];
  mo_types: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  operateur: string;
  action: string;
  objet_type: string;
  objet_id: string;
  details: string;
}

// ---------------------------------------------------------------- Analyse
/** erreur_ct : heures imputées sur un CT non planifié au lieu d'un CT planifié de la même semaine (DECISIONS n° 14). */
export type Flag = 'absence' | 'hors_plan' | 'erreur_ct' | 'sur_imputation' | 'sous_imputation' | 'conforme';
export type Classification = 'SECURISE' | 'NON_SECURISE' | 'NON_CLASSE';
/** nom : même NOM + Prénom dans le plan et le réalisé ; none : hors plan ; plan : plan seul. */
export type Confidence = 'nom' | 'none' | 'plan';

export const FLAG_SEVERITY: Record<Flag, number> = {
  absence: 6,
  hors_plan: 5,
  erreur_ct: 4,
  sur_imputation: 3,
  sous_imputation: 2,
  conforme: 1,
};

export interface WeekInfo {
  week: string; // "2026-W37"
  debut: string;
  fin: string;
  jours_ouvres: number;
  verrouillee: boolean;
  /** Couverture de la semaine par la timeline du plan. */
  couverture: Couverture;
}

/** 'aucune' = semaine non couverte par le plan de charge : ni écart ni anomalie. */
export type Couverture = 'totale' | 'partielle' | 'aucune';

/** Période pendant laquelle une version de plan fait référence ('' / '' = entièrement remplacée). */
export interface TimelineWindow {
  version_id: string;
  intitule: string;
  statut: VersionStatut;
  date_effet: string;
  debut: string;
  fin: string;
}

/** Ligne de plan coupée à la fenêtre de sa version. */
export interface TimelineSegment {
  version_id: string;
  line_id: number;
  row_num: number;
  ct: string;
  ct_libelle: string;
  /** '' = ligne non nominative. */
  nom_prenom: string;
  /** « NOM Prénom » ou libellé (ligne non nominative). */
  ressource: string;
  personne_id: string | null;
  squad_id: string | null;
  squad_nom: string;
  ligne_cout: string;
  pourcentage: number;
  debut: string;
  fin: string;
  /** Heures du segment (charge × jours ouvrés du segment ÷ jours ouvrés de la ligne). */
  charge: number;
  pps: number;
  inactive: boolean;
}

export interface PlanTimeline {
  plan_version: Version | null;
  windows: TimelineWindow[];
  segments: TimelineSegment[];
}

export interface AnalyseContext {
  plan_versions: Version[];
  realise_versions: Version[];
  default_plan_id: string | null;
  default_realise_id: string | null;
  /** Provisions facultatives ; défaut = version active (null si aucune). */
  provision_versions: Version[];
  default_provision_id: string | null;
  default_week_from: string;
  default_week_to: string;
  weeks: WeekInfo[];
  message: string;
}

export interface AnalyseMeta {
  plan_version: Version | null;
  realise_version: Version | null;
  /** Version de provisions retenue (null : budget = Σ PPS seul). */
  provision_version: Version | null;
  archived_warning: boolean;
  week_from: string;
  week_to: string;
  weeks: WeekInfo[];
  include_inactive: boolean;
  generated_at: string;
  /** Fenêtres des versions de plan retenues ; hors fenêtres = non couvert. */
  timeline: TimelineWindow[];
}

export interface EcartRow {
  personne_id: string | null;
  ressource: string;
  ressource_label: string;
  ct: string;
  ct_libelle: string;
  semaine: string;
  prevu: number;
  reel: number;
  ecart: number;
  flag: Flag;
  confidence: Confidence;
  inactive: boolean;
  squad_id: string | null;
  squad_nom: string;
  warn: boolean;
  /** Version de plan qui régit la semaine (null si aucune). */
  plan_version_id: string | null;
  /**
   * Erreur de CT : heures réaffectées entre ce tuple et `cts_lies` (même personne × semaine), 0 sinon.
   * prevu = 0 → CT imputé à tort, cts_lies = CT planifiés en manque ; sinon l'inverse.
   */
  reaffecte: number;
  cts_lies: string[];
  /**
   * Clés des anomalies qui citent ce tuple (DECISIONS n° 26), jamais null : `ecart|CT|ressource|flag`, plus
   * `ecart|B|ressource|erreur_ct` par CT B imputé à tort lié. Masqué des écarts quand ≥ 1 clé et toutes traitées / ignorées.
   */
  anomalies: string[];
}

export interface KPIs {
  taux_conformite: number | null; // 0..1
  nb_tuples_compares: number;
  nb_conformes: number;
  nb_sur_imputation: number;
  nb_sous_imputation: number;
  nb_absence: number;
  nb_hors_plan: number;
  nb_erreur_ct: number;
  points_sur_imputation: number;
  points_sous_imputation: number;
  points_absence: number;
  points_hors_plan: number;
  points_erreur_ct: number;
  points_total: number;
  heures_hors_plan: number;
  /** Σ réel des tuples erreur_ct côté CT imputé à tort. */
  heures_erreur_ct: number;
  taux_absence: number | null; // 0..1
  nb_personnes_absentes: number;
  nb_personnes_planifiees: number;
  pct_securise: number | null; // 0..100
  nb_ct_risque: number;
  total_prevu_h: number;
  total_reel_h: number;
  /** Heures MO de la période imputées hors couverture du plan (non analysées). */
  heures_non_couvertes: number;
}

/** Analyse par nature : dépense prévue (PPS + provisions) et réalisé (Σ TOTAL EN €) d'une nature de coût (DECISIONS n° 10, 16). Le prévu n'est pas un budget (n° 20). */
export interface BudgetNature {
  nature: 'provision' | 'mo' | 'capacite' | 'frais' | 'autres';
  libelle: string;
  /** Σ PPS du plan. */
  pps: number;
  /** Σ provisions importées, ventilées selon leur ligne de coût. */
  provisions: number;
  /** pps + provisions (dépense prévue). */
  prevu: number;
  realise: number;
  /** realise ÷ prevu, 0..100+, null si prévu nul. */
  pct_consomme: number | null;
}

/** Classification prévisionnelle (DECISIONS n° 23) : sécurisé = PDC restant + provisions sécurisées, non sécurisé = provisions pour aléas. */
export interface BudgetCT {
  ct: string;
  ct_libelle: string;
  /** reste_a_faire + provisions_securisees (prévision « Tout »). */
  securise: number;
  /** provisions_aleas. */
  non_securise: number;
  pct_securite: number | null; // 0..100
  pps_plan: number;
  /** Σ provisions du CT. */
  provisions: number;
  heures_mo: number;
  cout_mo_eur: number;
  risque: boolean;
}

export interface BudgetGlobal {
  securise: number;
  non_securise: number;
  pct_securite: number | null;
  pct_non_securise: number | null;
}

export interface AlerteCT {
  ct: string;
  ct_libelle: string;
  non_securise: number;
}

export interface DeriveProvision {
  ct: string;
  row_num: number;
  employe_fournisseur: string;
  type: string;
  date_depense: string;
  heures: number;
  eur: number;
}

export interface QualiteWarning {
  code: string;
  regle: number;
  message: string;
  count: number;
  details: string[];
}

export interface Correspondance {
  /** EMPLOYE/FOURNISSEUR brut. */
  nom_realise: string;
  /** « NOM Prénom » sans civilité ('' si illisible). */
  nom_prenom: string;
  personne_id: string | null;
  personne_nom: string;
  confidence: Confidence;
  nb_ecritures: number;
  heures: number;
}

export interface AnalyseResult {
  meta: AnalyseMeta;
  kpis: KPIs;
  ecarts: EcartRow[];
  budget: { par_ct: BudgetCT[]; global: BudgetGlobal; par_nature: BudgetNature[] };
  alertes: {
    ct_risque: AlerteCT[];
    alerte_globale: boolean;
    pct_non_securise: number | null;
    derive_provision: DeriveProvision[];
  };
  qualite: QualiteWarning[];
  correspondances: Correspondance[];
  previsions: Previsions;
  /** Tri : gravité desc, catégorie, montant/heures desc ; statut fusionné avec le suivi enregistré. */
  anomalies: Anomalie[];
}

export interface AnalyseParams {
  plan_version_id?: string;
  realise_version_id?: string;
  /** Facultatif : défaut = version de provisions active. */
  provision_version_id?: string;
  week_from?: string;
  week_to?: string;
  include_inactive?: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ------------------------------------------------------------------ Prévisions (SPEC_analyse §7.7)
export interface PrevisionPoint {
  week: string;
  debut: string;
  /** Dépense prévue cumulée du plan (hors provisions). */
  budget_cumul: number;
  reel_cumul: number | null;
  plan_cumul: number | null;
  tendance_cumul: number | null;
  heures_plan: number;
  heures_reel: number | null;
  couverture: Couverture;
  /** ETP planifiés de la semaine : Σ pourcentage/100 des segments MO × jours ouvrés couverts ÷ jours ouvrés (DECISIONS n° 25). */
  etp: number;
}

export type PrevisionStatut = 'ok' | 'vigilance' | 'depassement';

/**
 * Prévision d'un CT (global : périmètre des CT avec enveloppe, `ct` = ''). Le budget est l'enveloppe saisie,
 * rien d'autre (DECISIONS n° 20) : sans enveloppe (`budget_source` = 'aucun'), tous les champs de budget sont null.
 */
export interface PrevisionCT {
  ct: string;
  ct_libelle: string;
  /** Montant de l'enveloppe (global : Σ enveloppes) ; null sans enveloppe. */
  budget: number | null;
  budget_source: 'enveloppe' | 'aucun';
  /** Σ PPS du plan (segments de la timeline), info. */
  pps: number;
  /** Σ provisions restantes, info. */
  provisions: number;
  /** Provisions sécurisées (ligne de coût ≠ PROVISIONS POUR ALEAS) comptées dans l'atterrissage : datées dans la période ou sans date (DECISIONS n° 23). */
  provisions_securisees: number;
  /** Provisions pour aléas (non sécurisées) : jamais dans l'atterrissage. */
  provisions_aleas: number;
  /** Provisions sécurisées datées hors de la période de l'enveloppe (exclues). */
  provisions_hors_enveloppe: number;
  consomme: number;
  /** consomme ÷ budget, 0..100+ ; null sans budget ou budget nul. */
  pct_consomme: number | null;
  reste_a_faire: number;
  /** Atterrissage sécurisé = consommé + reste_a_faire + provisions_securisees (DECISIONS n° 23). */
  atterrissage_plan: number;
  atterrissage_tendance: number;
  /** atterrissage_plan − budget ; null sans budget. */
  ecart_plan: number | null;
  ecart_tendance: number | null;
  rythme_hebdo: number;
  semaines_restantes: number;
  fin_plan: string;
  /** null sans budget. */
  statut: PrevisionStatut | null;
  // Échéance = fin de l'enveloppe (global : la plus tardive) ; vide / null sans enveloppe.
  /** YYYY-MM-DD, '' sans enveloppe. */
  echeance: string;
  /** = budget. */
  budget_echeance: number | null;
  /** Consommé + PPS prévu des semaines ]as_of, échéance] (0 sans enveloppe). */
  projection_plan_echeance: number;
  /** Consommé + rythme × semaines ]as_of, échéance] (0 sans enveloppe). */
  projection_tendance_echeance: number;
  /** max(0, budget − atterrissage sécurisé) : enveloppe que le plan de charge et les provisions sécurisées ne consommeront pas (DECISIONS n° 21, 23) ; null sans budget. */
  non_consomme: number | null;
  /** € / semaine à dépenser pour tout consommer à l'échéance ; null sans budget, 0 si aucune semaine. */
  rythme_necessaire: number | null;
  semaines_echeance: number;
  /** non_consomme > seuils (% et €) ; false sans budget. */
  sous_consommation: boolean;
  /**
   * Bas de la zone cible [cible_min, budget] : tout consommer sans surconsommer (DECISIONS n° 20).
   * budget − max(seuil_sous_conso_pct % × budget, seuil_sous_conso_eur), plancher 0 ; null sans budget.
   */
  cible_min: number | null;
  /** Enveloppe du CT (DECISIONS n° 19) : prévisionnel restreint à [date_debut, date_fin]. null sans enveloppe (global : toujours null). */
  enveloppe: Enveloppe | null;
  /** PPS prévu hors des semaines de la période (+ PPS hors série). */
  plan_hors_enveloppe: number;
  /** € réalisés datés hors de la période (exclus du consommé). */
  consomme_hors_enveloppe: number;
  /** € réalisés datés à partir de date_reference (DECISIONS n° 31) : affichés, hors consommé, rythme et atterrissage. */
  realise_depuis_reference: number;
  series: PrevisionPoint[];
}

/** CT sans enveloppe : aucun budget, hors du global (DECISIONS n° 20). */
export interface HorsEnveloppe {
  nb_ct: number;
  consomme: number;
  realise_depuis_reference: number;
  atterrissage_plan: number;
  atterrissage_tendance: number;
}

/** Plan de charge face aux enveloppes : lecture brute des CT configurés, chacun sur sa période. */
export interface EnveloppesSynthese {
  nb_ct: number;
  nb_configures: number;
  /** Σ montants des enveloppes. */
  montant: number;
  /** Σ atterrissage_plan des CT configurés. */
  atterrissage: number;
  /** atterrissage − montant (net : les CT se compensent). */
  ecart: number;
  /** Σ ecart_plan des CT au statut `depassement` (DECISIONS n° 22) : depassement > 0 ⇔ nb_depassement > 0. */
  depassement: number;
  nb_depassement: number;
  /** Σ non_consomme des CT configurés, CT par CT sans compensation (DECISIONS n° 21). */
  non_consomme: number;
  nb_sous_consommation: number;
  plan_hors_enveloppe: number;
}

export interface Previsions {
  /** Filtre d'année (DECISIONS n° 24) : 0 = Tout ; N = enveloppes coupées aux semaines ISO de N, montants au prorata. */
  annee: number;
  /** Années proposées : année de date_reference → année de la fin d'enveloppe la plus tardive. */
  annees: number[];
  /** Date d'effet de la dernière version de la timeline : base de tous les calculs (DECISIONS n° 31). */
  date_reference: string;
  /** Veille de date_reference : consommé = réalisé ≤ as_of, projections au-delà. */
  as_of: string;
  as_of_week: string;
  /** Dernière date de dépense du réalisé importé ('' si aucune). */
  dernier_realise: string;
  global: PrevisionCT;
  par_ct: PrevisionCT[];
  enveloppes: EnveloppesSynthese;
  hors_enveloppe: HorsEnveloppe;
}

// ------------------------------------------------------------------ Anomalies (SPEC_analyse §7.8)
export type AnomalieCategorie = 'ecart' | 'ct_risque' | 'derive' | 'qualite' | 'budget';
export type AnomalieStatut = 'a_traiter' | 'traitee' | 'ignoree';

export interface AnomalieSuivi {
  key: string;
  fingerprint: string;
  statut: Exclude<AnomalieStatut, 'a_traiter'>;
  commentaire: string;
  operateur: string;
  updated_at: string;
  /** Empreinte changée depuis le traitement : l'anomalie est revenue à traiter. */
  obsolete: boolean;
}

export interface Anomalie {
  key: string;
  categorie: AnomalieCategorie;
  /** 3 haute · 2 moyenne · 1 basse */
  gravite: 1 | 2 | 3;
  titre: string;
  detail: string;
  flag?: Flag;
  ct?: string;
  ct_libelle?: string;
  ressource?: string;
  montant?: number | null;
  heures?: number | null;
  semaines?: string[];
  details?: string[];
  /** Route front vers les données concernées. */
  lien: string;
  fingerprint: string;
  statut: AnomalieStatut;
  suivi?: AnomalieSuivi;
}

export interface AnomalieSuiviInput {
  key: string;
  fingerprint: string;
  statut: Exclude<AnomalieStatut, 'a_traiter'>;
  commentaire: string;
  operateur?: string;
}

// ---------------------------------------------------------------- Dérive du plan (DECISIONS n° 12)
export type DeriveStatut = 'ajoute' | 'retire' | 'modifie' | 'inchange';

export interface PlanCompareTotaux {
  pps_from: number;
  pps_to: number;
  charge_from: number;
  charge_to: number;
  nb_ct_from: number;
  nb_ct_to: number;
  nb_personnes_from: number;
  nb_personnes_to: number;
}

export interface PlanCompareCT {
  ct: string;
  /** Groupe Excel de la version la plus récente qui porte le CT (« Parent > Enfant »). */
  groupe: string;
  pps_from: number;
  pps_to: number;
  charge_from: number;
  charge_to: number;
  statut: DeriveStatut;
}

export interface PlanComparePersonne {
  /** « NOM Prénom » ; « (non nominatif) » regroupe les lignes sans nom. */
  nom_prenom: string;
  pps_from: number;
  pps_to: number;
  charge_from: number;
  charge_to: number;
  statut: DeriveStatut;
}

/** GET /plan/compare : référence (`from`) vs version comparée (`to`), lignes non rejetées. */
export interface PlanCompare {
  from: Version;
  to: Version;
  totaux: PlanCompareTotaux;
  /** Tri : |Δ PPS| décroissant, puis CT. */
  par_ct: PlanCompareCT[];
  /** Tri : |Δ charge| décroissant, puis nom. */
  par_personne: PlanComparePersonne[];
}
