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
/** Fonds disponibles non engagés. Charge max d'un CT = Σ PPS du plan + Σ provisions ; budget = Σ charge max. */
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
  diviseur_hors_plan_h: number;
  semaines_verrouillees: number[];
  jours_feries: string[];
  mo_types: string[];
  securise: string[];
  non_securise: string[];
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

/** Analyse budgétaire : budget (PPS + provisions) et réalisé (Σ TOTAL EN €) d'une nature de coût (DECISIONS n° 10, 16). */
export interface BudgetNature {
  nature: 'provision' | 'mo' | 'capacite' | 'frais' | 'autres';
  libelle: string;
  /** Σ PPS du plan. */
  pps: number;
  /** Σ provisions importées, ventilées selon leur ligne de coût. */
  provisions: number;
  /** pps + provisions ; Σ budget = previsions.global.budget. */
  budget: number;
  realise: number;
  /** realise ÷ budget, 0..100+, null si budget nul. */
  pct_consomme: number | null;
}

export interface BudgetCT {
  ct: string;
  ct_libelle: string;
  securise: number;
  non_securise: number;
  non_classe: number;
  pct_securite: number | null; // 0..100
  pps_plan: number;
  /** Σ provisions du CT. */
  provisions: number;
  /** pps_plan + provisions (budget du CT). */
  charge_max: number;
  heures_mo: number;
  cout_mo_eur: number;
  risque: boolean;
}

export interface BudgetGlobal {
  securise: number;
  non_securise: number;
  non_classe: number;
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
}

export type PrevisionStatut = 'ok' | 'vigilance' | 'depassement';

export interface PrevisionCT {
  ct: string;
  ct_libelle: string;
  /** Charge max = pps + provisions : référence des écarts et du statut. */
  budget: number;
  /** Σ PPS du plan (segments de la timeline). */
  pps: number;
  /** Σ provisions restantes. */
  provisions: number;
  consomme: number;
  pct_consomme: number | null;
  reste_a_faire: number;
  atterrissage_plan: number;
  atterrissage_tendance: number;
  ecart_plan: number;
  ecart_tendance: number;
  rythme_hebdo: number;
  semaines_restantes: number;
  fin_plan: string;
  statut: PrevisionStatut;
  series: PrevisionPoint[];
}

export interface Previsions {
  as_of: string;
  as_of_week: string;
  global: PrevisionCT;
  par_ct: PrevisionCT[];
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
