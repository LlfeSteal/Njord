// Miroir exact de backend/internal/domain/domain.go (contrat API).
// Ne modifier qu'en même temps que le Go (intégrateur).
// Dates : "YYYY-MM-DD" ("" = absent) ; horodatages : ISO 8601.

export type Kind = 'plan' | 'realise';
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
  source_format: string; // 'spec' | 'demo'
  filename: string;
  layout?: string; // plan : 'A' | 'B' | 'mixte'
  montant_total_eur?: number; // réalisé
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
  montant_total_eur?: number;
  issues: ParseIssue[];
  motifs_count: Record<string, number>;
  active_version: Version | null;
}

export interface ImportResult {
  version: Version;
  report: ImportReport;
}

// ---------------------------------------------------------------- Plan
export interface PlanLine {
  id: number;
  version_id: string;
  row_num: number;
  layout: string;
  ct: string;
  ressource: string;
  libelle: string;
  /** « NOM Prénom » extrait du libellé ('' si non identifiable). */
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
  ressource_kind: 'internal' | 'external' | 'unknown';
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
export type AliasSource = 'import' | 'manuel' | 'confirme';

export interface PersonneAlias {
  id: number;
  alias: string;
  alias_normalise: string;
  source: AliasSource;
}

export interface Personne {
  id: string;
  display_name: string;
  nom_normalise: string;
  statut: 'brouillon' | 'validee';
  squad_id: string | null;
  matricules: string[];
  alias: PersonneAlias[];
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
  seuil_fuzzy_count: number;
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
export type Flag = 'absence' | 'hors_plan' | 'sur_imputation' | 'sous_imputation' | 'conforme';
export type Classification = 'SECURISE' | 'NON_SECURISE' | 'NON_CLASSE';
export type Confidence = 'matricule' | 'alias' | 'fuzzy' | 'none' | 'plan';

export const FLAG_SEVERITY: Record<Flag, number> = {
  absence: 5,
  hors_plan: 4,
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
}

export interface AnalyseContext {
  plan_versions: Version[];
  realise_versions: Version[];
  default_plan_id: string | null;
  default_realise_id: string | null;
  default_week_from: string;
  default_week_to: string;
  weeks: WeekInfo[];
  message: string;
}

export interface AnalyseMeta {
  plan_version: Version | null;
  realise_version: Version | null;
  archived_warning: boolean;
  week_from: string;
  week_to: string;
  weeks: WeekInfo[];
  include_inactive: boolean;
  generated_at: string;
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
}

export interface KPIs {
  taux_conformite: number | null; // 0..1
  nb_tuples_compares: number;
  nb_conformes: number;
  nb_sur_imputation: number;
  nb_sous_imputation: number;
  nb_absence: number;
  nb_hors_plan: number;
  points_sur_imputation: number;
  points_sous_imputation: number;
  points_absence: number;
  points_hors_plan: number;
  points_total: number;
  heures_hors_plan: number;
  taux_absence: number | null; // 0..1
  nb_personnes_absentes: number;
  nb_personnes_planifiees: number;
  pct_securise: number | null; // 0..100
  nb_ct_risque: number;
  total_prevu_h: number;
  total_reel_h: number;
}

export interface BudgetCT {
  ct: string;
  ct_libelle: string;
  securise: number;
  non_securise: number;
  non_classe: number;
  pct_securite: number | null; // 0..100
  pps_plan: number;
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
  nom_realise: string;
  nom_normalise: string;
  personne_id: string | null;
  personne_nom: string;
  ressource: string;
  confidence: Confidence;
  nb_ecritures: number;
  heures: number;
}

export interface AnalyseResult {
  meta: AnalyseMeta;
  kpis: KPIs;
  ecarts: EcartRow[];
  budget: { par_ct: BudgetCT[]; global: BudgetGlobal };
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
  budget_cumul: number;
  reel_cumul: number | null;
  plan_cumul: number | null;
  tendance_cumul: number | null;
  heures_plan: number;
  heures_reel: number | null;
}

export type PrevisionStatut = 'ok' | 'vigilance' | 'depassement';

export interface PrevisionCT {
  ct: string;
  ct_libelle: string;
  budget: number;
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
export type AnomalieCategorie = 'ecart' | 'ct_risque' | 'derive' | 'qualite' | 'correspondance' | 'budget';
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
  nom_realise?: string;
  personne_id?: string | null;
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
