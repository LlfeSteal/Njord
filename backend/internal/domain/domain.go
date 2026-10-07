// Package domain holds the types shared by every Njord module and exposed by
// the HTTP API. It is the contract between modules: change it only through the
// integrator. JSON is snake_case; dates are "YYYY-MM-DD" strings ("" = absent).
package domain

import "time"

// ---------------------------------------------------------------------------
// Versions (cycle de vie commun plan / réalisé)

type Kind string

const (
	KindPlan    Kind = "plan"
	KindRealise Kind = "realise"
)

type VersionStatut string

const (
	StatutActive   VersionStatut = "active"
	StatutArchivee VersionStatut = "archivee"
	StatutPurgee   VersionStatut = "purgee"
)

type ParsingStatut string

const (
	ParsingOK   ParsingStatut = "ok"
	ParsingWarn ParsingStatut = "warn"
	ParsingDrop ParsingStatut = "drop"
)

// Source formats recognised by the parsers.
const (
	FormatSpec = "spec" // format décrit dans les SPEC (12 / 25 colonnes)
	FormatDemo = "demo" // format d'export des fichiers test_data_demo
)

// Version is an import of a plan de charge or of a réalisé.
type Version struct {
	ID           string        `json:"id"`
	Kind         Kind          `json:"kind"`
	Intitule     string        `json:"intitule"`
	ImporteeLe   time.Time     `json:"importee_le"`
	Importeur    string        `json:"importeur"`
	Statut       VersionStatut `json:"statut"`
	ArchiveeLe   *time.Time    `json:"archivee_le"`
	PurgeeLe     *time.Time    `json:"purgee_le"`
	NbLignes     int           `json:"nb_lignes"` // lignes acceptées (ok + warn)
	NbWarn       int           `json:"nb_warn"`
	NbDrop       int           `json:"nb_drop"`
	PeriodeDebut string        `json:"periode_debut"`
	PeriodeFin   string        `json:"periode_fin"`
	SourceFormat string        `json:"source_format"`
	Filename     string        `json:"filename"`
	// Plan uniquement : "A" | "B" | "mixte".
	Layout string `json:"layout,omitempty"`
	// Réalisé uniquement : Σ TOTAL EN € des lignes acceptées.
	MontantTotalEur *float64 `json:"montant_total_eur,omitempty"`
	// Plan uniquement : date (YYYY-MM-DD) à partir de laquelle la version
	// remplace les précédentes dans la timeline (DECISIONS n° 13).
	DateEffet string `json:"date_effet,omitempty"`
}

// ParseIssue describes a warn/drop line in an import report.
type ParseIssue struct {
	RowNum int           `json:"row_num"` // numéro de ligne Excel (1-based)
	Statut ParsingStatut `json:"statut"`
	Motif  string        `json:"motif"`
}

// ImportReport is the "bilan" returned by preview and commit.
type ImportReport struct {
	Kind         Kind   `json:"kind"`
	Intitule     string `json:"intitule"`
	Filename     string `json:"filename"`
	SourceFormat string `json:"source_format"`
	SheetName    string `json:"sheet_name"`
	HeaderRow    int    `json:"header_row"` // 1-based
	Total        int    `json:"total"`      // lignes de données considérées
	OK           int    `json:"ok"`
	Warn         int    `json:"warn"`
	Drop         int    `json:"drop"`
	PeriodeDebut string `json:"periode_debut"`
	PeriodeFin   string `json:"periode_fin"`
	// Plan uniquement.
	Layout             string   `json:"layout,omitempty"`
	PctInactifs        *float64 `json:"pct_inactifs,omitempty"` // 0..100
	NouvellesPersonnes []string `json:"nouvelles_personnes,omitempty"`
	NouveauxSquads     []string `json:"nouveaux_squads,omitempty"`
	DateEffetProposee  string   `json:"date_effet_proposee,omitempty"` // = periode_debut (pré-remplissage)
	// Réalisé uniquement.
	MontantTotalEur *float64 `json:"montant_total_eur,omitempty"`
	// Détail (tronqué à 500 entrées) et comptage par motif.
	Issues        []ParseIssue   `json:"issues"`
	MotifsCount   map[string]int `json:"motifs_count"`
	ActiveVersion *Version       `json:"active_version"` // version active existante (null sinon)
}

// ImportResult is returned by POST /{kind}/imports.
type ImportResult struct {
	Version Version      `json:"version"`
	Report  ImportReport `json:"report"`
}

// ---------------------------------------------------------------------------
// Plan de charge

type PlanLine struct {
	ID        int64  `json:"id"`
	VersionID string `json:"version_id"`
	RowNum    int    `json:"row_num"`
	Layout    string `json:"layout"` // "A" | "B" | "" (inconnu)
	// Les 12 colonnes de la SPEC.
	CT              string  `json:"ct"`
	Ressource       string  `json:"ressource"` // code brut du fichier sans le préfixe [inactif] ; n'identifie personne
	Libelle         string  `json:"libelle"`
	NomPrenom       string  `json:"nom_prenom"` // identité : « NOM Prénom » extrait du libellé ("" = ligne non nominative)
	TypeAffectation string  `json:"type_affectation"`
	LigneCout       string  `json:"ligne_cout"`
	ChargeTotale    float64 `json:"charge_totale"`
	PPS             float64 `json:"pps"`
	Pourcentage     int     `json:"pourcentage"`
	Unite           string  `json:"unite"`
	CalculDuree     string  `json:"calcul_duree"`
	DateDebut       string  `json:"date_debut"`
	DateFin         string  `json:"date_fin"`
	// Colonnes supplémentaires du format démo.
	QuantiteAffectee *float64 `json:"quantite_affectee"`
	TauxFixe         string   `json:"taux_fixe"`
	Depuis           string   `json:"depuis"`
	Pendant          string   `json:"pendant"`
	// Enrichissement import.
	StatutParsing ParsingStatut `json:"statut_parsing"`
	MotifRejet    string        `json:"motif_rejet"`
	RessourceKind string        `json:"-"` // colonne héritée, plus exposée
	Inactive      bool          `json:"inactive"`
	PersonneID    *string       `json:"personne_id"`
	SquadID       *string       `json:"squad_id"`
	Groupe        string        `json:"groupe"` // chemin des groupes Excel, ex. "Squad Alpha — Plateforme > Alpha Core Team"
}

type PlanLineTotals struct {
	ChargeTotale float64 `json:"charge_totale"`
	PPS          float64 `json:"pps"`
}

type PlanLinesPage struct {
	Items  []PlanLine     `json:"items"`
	Total  int            `json:"total"`
	Totals PlanLineTotals `json:"totals"`
}

// ---------------------------------------------------------------------------
// Réalisé

type RealiseEntry struct {
	ID        int64  `json:"id"`
	VersionID string `json:"version_id"`
	RowNum    int    `json:"row_num"`
	// Les 25 colonnes de la SPEC ("" = vide / "-").
	Entite              string  `json:"entite"`
	Activite            string  `json:"activite"`
	SousActivite        string  `json:"sous_activite"`
	Trigramme           string  `json:"trigramme"`
	TG                  string  `json:"tg"`
	TGLibelle           string  `json:"tg_libelle"`
	WP                  string  `json:"wp"`
	WPLibelle           string  `json:"wp_libelle"`
	DescriptionDepenses string  `json:"description_depenses"` // sensible
	Categorie           string  `json:"categorie"`
	Type                string  `json:"type"`
	CategorieFNP        string  `json:"categorie_fnp"`
	EmployeFournisseur  string  `json:"employe_fournisseur"` // sensible
	NomPrenom           string  `json:"nom_prenom"`          // sensible ; « NOM Prénom » d'EMPLOYE/FOURNISSEUR sans civilité ("" si non identifiable)
	Matricule           string  `json:"matricule"`           // sensible
	FPC                 string  `json:"fpc"`
	CEA                 string  `json:"cea"`
	Quantite            float64 `json:"quantite"`
	TotalEur            float64 `json:"total_eur"`
	DateDepense         string  `json:"date_depense"`
	PeriodeComptable    string  `json:"periode_comptable"`
	CompteComptable     string  `json:"compte_comptable"`
	NumFacture          string  `json:"num_facture"`  // sensible
	NumCommande         string  `json:"num_commande"` // sensible
	NumLigne            *int    `json:"num_ligne"`
	LotIFRS15           string  `json:"lot_ifrs15"`
	// Colonnes supplémentaires du format démo.
	NomRessource  string `json:"nom_ressource"` // sensible
	Fournisseur   string `json:"fournisseur"`   // sensible
	CodeArticle   string `json:"code_article"`
	MoisComptable string `json:"mois_comptable"`
	// Parsing.
	StatutParsing ParsingStatut `json:"statut_parsing"`
	MotifRejet    string        `json:"motif_rejet"`
}

type RealiseEntryTotals struct {
	Quantite     float64        `json:"quantite"`
	TotalEur     float64        `json:"total_eur"`
	ParCategorie map[string]int `json:"par_categorie"` // nb lignes par CATEGORIE
}

type RealiseEntriesPage struct {
	Items  []RealiseEntry     `json:"items"`
	Total  int                `json:"total"`
	Totals RealiseEntryTotals `json:"totals"`
}

// Facets: valeurs distinctes par nom de filtre, pour peupler les selects.
type Facets map[string][]string

// ---------------------------------------------------------------------------
// Référentiels

// Personne : identité humaine, identifiée uniquement par NOM + Prénom (DECISIONS n° 8).
type Personne struct {
	ID           string    `json:"id"`
	DisplayName  string    `json:"display_name"`  // « NOM Prénom »
	NomNormalise string    `json:"nom_normalise"` // names.Key, ex. "DE LA TOUR|ANTOINE" (unique)
	Statut       string    `json:"statut"`        // brouillon | validee
	SquadID      *string   `json:"squad_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type Squad struct {
	ID              string    `json:"id"`
	NomCanonique    string    `json:"nom_canonique"`
	Alias           []string  `json:"alias"`
	EntiteRattachee string    `json:"entite_rattachee"`
	ParentID        *string   `json:"parent_id"`
	CreatedAt       time.Time `json:"created_at"`
}

// ---------------------------------------------------------------------------
// Paramètres & journal

type Settings struct {
	SeuilSurImputationH   float64  `json:"seuil_sur_imputation_h"`   // 15 : écart > +15 h → 🔴
	SeuilSousImputationH  float64  `json:"seuil_sous_imputation_h"`  // 30 : écart < −30 h → 🟣
	SeuilCTRisqueEur      float64  `json:"seuil_ct_risque_eur"`      // 10 000
	SeuilNonSecurisePct   float64  `json:"seuil_non_securise_pct"`   // 15
	PurgeDelaiJours       int      `json:"purge_delai_jours"`        // 30
	SeuilQuantiteSemaineH float64  `json:"seuil_quantite_semaine_h"` // 200
	SeuilEcartTGEur       float64  `json:"seuil_ecart_tg_eur"`       // 50 000
	DiviseurHorsPlanH     float64  `json:"diviseur_hors_plan_h"`     // 12
	SemainesVerrouillees  []int    `json:"semaines_verrouillees"`    // [51, 52] (numéros ISO, toute année)
	JoursFeries           []string `json:"jours_feries"`             // dates YYYY-MM-DD
	MOTypes               []string `json:"mo_types"`
	Securise              []string `json:"securise"`
	NonSecurise           []string `json:"non_securise"`
}

type AuditEntry struct {
	ID        int64     `json:"id"`
	At        time.Time `json:"at"`
	Operateur string    `json:"operateur"`
	Action    string    `json:"action"`     // import | archive | reactivate | purge | alias_add | ...
	ObjetType string    `json:"objet_type"` // plan_version | realise_version | personne | squad | settings
	ObjetID   string    `json:"objet_id"`
	Details   string    `json:"details"` // jamais de donnée sensible
}

// ---------------------------------------------------------------------------
// Analyse

type Flag string

const (
	FlagAbsence        Flag = "absence"         // ⚫
	FlagHorsPlan       Flag = "hors_plan"       // 🟠
	FlagSurImputation  Flag = "sur_imputation"  // 🔴
	FlagSousImputation Flag = "sous_imputation" // 🟣
	FlagConforme       Flag = "conforme"        // 🟢
)

// FlagSeverity orders flags for the default sort (higher = more severe).
var FlagSeverity = map[Flag]int{
	FlagAbsence: 5, FlagHorsPlan: 4, FlagSurImputation: 3, FlagSousImputation: 2, FlagConforme: 1,
}

type Classification string

const (
	ClassSecurise    Classification = "SECURISE"
	ClassNonSecurise Classification = "NON_SECURISE"
	ClassNonClasse   Classification = "NON_CLASSE"
)

type Confidence string

const (
	ConfNom  Confidence = "nom"  // même NOM + Prénom dans le plan et le réalisé
	ConfNone Confidence = "none" // non apparié → hors plan
	ConfPlan Confidence = "plan" // tuple issu du plan seul (aucun réel)
)

type WeekInfo struct {
	Week        string `json:"week"` // "2026-W37"
	Debut       string `json:"debut"`
	Fin         string `json:"fin"`
	JoursOuvres int    `json:"jours_ouvres"`
	Verrouillee bool   `json:"verrouillee"`
	// Couverture par la timeline du plan (jours ouvrés de la semaine) :
	// "totale" | "partielle" | "aucune" (DECISIONS n° 13).
	Couverture Couverture `json:"couverture"`
}

type Couverture string

const (
	CouvertureTotale    Couverture = "totale"
	CouverturePartielle Couverture = "partielle"
	CouvertureAucune    Couverture = "aucune"
)

type AnalyseContext struct {
	PlanVersions     []Version  `json:"plan_versions"`    // non purgées
	RealiseVersions  []Version  `json:"realise_versions"` // non purgées
	DefaultPlanID    *string    `json:"default_plan_id"`
	DefaultRealiseID *string    `json:"default_realise_id"`
	DefaultWeekFrom  string     `json:"default_week_from"`
	DefaultWeekTo    string     `json:"default_week_to"`
	Weeks            []WeekInfo `json:"weeks"`   // union des semaines couvertes par les versions par défaut
	Message          string     `json:"message"` // ex. "Aucun plan actif : importez ou réactivez un plan"
}

type AnalyseMeta struct {
	PlanVersion     *Version   `json:"plan_version"`
	RealiseVersion  *Version   `json:"realise_version"`
	ArchivedWarning bool       `json:"archived_warning"` // une version archivée est utilisée
	WeekFrom        string     `json:"week_from"`
	WeekTo          string     `json:"week_to"`
	Weeks           []WeekInfo `json:"weeks"`
	IncludeInactive bool       `json:"include_inactive"`
	GeneratedAt     time.Time  `json:"generated_at"`
	// Timeline du plan : fenêtres des versions retenues (versions importées
	// jusqu'à plan_version), triées par date. Hors fenêtres = non couvert.
	Timeline []TimelineWindow `json:"timeline"`
}

// TimelineWindow is the period during which a plan version is the reference
// (DECISIONS n° 13). Debut/Fin are "" when the version is entirely replaced.
type TimelineWindow struct {
	VersionID string        `json:"version_id"`
	Intitule  string        `json:"intitule"`
	Statut    VersionStatut `json:"statut"`
	DateEffet string        `json:"date_effet"`
	Debut     string        `json:"debut"` // YYYY-MM-DD
	Fin       string        `json:"fin"`   // YYYY-MM-DD
}

// TimelineSegment is a plan line cut to the window of its version.
type TimelineSegment struct {
	VersionID   string  `json:"version_id"`
	LineID      int64   `json:"line_id"`
	RowNum      int     `json:"row_num"`
	CT          string  `json:"ct"`
	CTLibelle   string  `json:"ct_libelle"`
	NomPrenom   string  `json:"nom_prenom"` // "" = ligne non nominative
	Ressource   string  `json:"ressource"`  // « NOM Prénom » ou libellé (ligne non nominative)
	PersonneID  *string `json:"personne_id"`
	SquadID     *string `json:"squad_id"`
	SquadNom    string  `json:"squad_nom"`
	LigneCout   string  `json:"ligne_cout"`
	Pourcentage int     `json:"pourcentage"`
	Debut       string  `json:"debut"`  // YYYY-MM-DD, borne coupée
	Fin         string  `json:"fin"`    // YYYY-MM-DD, borne coupée
	Charge      float64 `json:"charge"` // heures du segment (charge × jo(segment) / jo(ligne))
	PPS         float64 `json:"pps"`    // PPS du segment (même prorata)
	Inactive    bool    `json:"inactive"`
}

// PlanTimeline is returned by GET /analyse/plan-timeline.
type PlanTimeline struct {
	PlanVersion *Version          `json:"plan_version"` // version de référence (dernière retenue)
	Windows     []TimelineWindow  `json:"windows"`
	Segments    []TimelineSegment `json:"segments"` // tri : ressource, CT, début
}

// EcartRow is one tuple (CT × ressource × semaine) of the écarts table (§7.1).
type EcartRow struct {
	PersonneID     *string    `json:"personne_id"`     // null si hors plan non résolu
	Ressource      string     `json:"ressource"`       // « NOM Prénom » ; libellé d'une ligne non nominative ; nom réalisé brut si illisible
	RessourceLabel string     `json:"ressource_label"` // nom affichable (= nom de la fiche personne si elle existe)
	CT             string     `json:"ct"`
	CTLibelle      string     `json:"ct_libelle"`
	Semaine        string     `json:"semaine"` // "2026-W37"
	Prevu          float64    `json:"prevu"`
	Reel           float64    `json:"reel"`
	Ecart          float64    `json:"ecart"` // reel − prevu
	Flag           Flag       `json:"flag"`
	Confidence     Confidence `json:"confidence"`
	Inactive       bool       `json:"inactive"`
	SquadID        *string    `json:"squad_id"`
	SquadNom       string     `json:"squad_nom"`
	Warn           bool       `json:"warn"`            // une ligne source est en statut warn
	PlanVersionID  *string    `json:"plan_version_id"` // version de plan qui régit la semaine (null si non couverte)
}

type KPIs struct {
	TauxConformite        *float64 `json:"taux_conformite"` // 0..1, null si aucun tuple comparé
	NbTuplesCompares      int      `json:"nb_tuples_compares"`
	NbConformes           int      `json:"nb_conformes"`
	NbSurImputation       int      `json:"nb_sur_imputation"`
	NbSousImputation      int      `json:"nb_sous_imputation"`
	NbAbsence             int      `json:"nb_absence"`
	NbHorsPlan            int      `json:"nb_hors_plan"`
	PointsSurImputation   int      `json:"points_sur_imputation"`
	PointsSousImputation  int      `json:"points_sous_imputation"`
	PointsAbsence         int      `json:"points_absence"`
	PointsHorsPlan        int      `json:"points_hors_plan"`
	PointsTotal           int      `json:"points_total"`
	HeuresHorsPlan        float64  `json:"heures_hors_plan"`
	TauxAbsence           *float64 `json:"taux_absence"` // 0..1
	NbPersonnesAbsentes   int      `json:"nb_personnes_absentes"`
	NbPersonnesPlanifiees int      `json:"nb_personnes_planifiees"`
	PctSecurise           *float64 `json:"pct_securise"` // 0..100
	NbCTRisque            int      `json:"nb_ct_risque"`
	TotalPrevuH           float64  `json:"total_prevu_h"`
	TotalReelH            float64  `json:"total_reel_h"`
	HeuresNonCouvertes    float64  `json:"heures_non_couvertes"` // heures MO de la période imputées hors couverture du plan (non analysées)
}

type BudgetCT struct {
	CT          string   `json:"ct"`
	CTLibelle   string   `json:"ct_libelle"`
	Securise    float64  `json:"securise"`
	NonSecurise float64  `json:"non_securise"`
	NonClasse   float64  `json:"non_classe"`
	PctSecurite *float64 `json:"pct_securite"` // 0..100, null si dénominateur nul
	PPSPlan     float64  `json:"pps_plan"`     // Σ PPS du plan sur ce CT (info)
	HeuresMO    float64  `json:"heures_mo"`    // Σ heures MO réalisées (info)
	CoutMOEur   float64  `json:"cout_mo_eur"`  // Σ TOTAL EN € des lignes MO (info, hors budget)
	Risque      bool     `json:"risque"`       // non_securise > seuil
}

type BudgetGlobal struct {
	Securise       float64  `json:"securise"`
	NonSecurise    float64  `json:"non_securise"`
	NonClasse      float64  `json:"non_classe"`
	PctSecurite    *float64 `json:"pct_securite"`     // 0..100
	PctNonSecurise *float64 `json:"pct_non_securise"` // 0..100
}

type Budget struct {
	ParCT     []BudgetCT     `json:"par_ct"`
	Global    BudgetGlobal   `json:"global"`
	ParNature []BudgetNature `json:"par_nature"` // analyse budgétaire, 5 lignes fixes (DECISIONS n° 10)
}

// BudgetNature : PPS du plan et réalisé (Σ TOTAL EN €, avoirs compris) d'une nature de coût.
type BudgetNature struct {
	Nature      string   `json:"nature"`  // provision | mo | capacite | frais | autres
	Libelle     string   `json:"libelle"` // « Provision », « Main d'œuvre »…
	PPS         float64  `json:"pps"`
	Realise     float64  `json:"realise"`
	PctConsomme *float64 `json:"pct_consomme"` // 0..100+, null si PPS nul
}

type AlerteCT struct {
	CT          string  `json:"ct"`
	CTLibelle   string  `json:"ct_libelle"`
	NonSecurise float64 `json:"non_securise"`
}

type DeriveProvision struct {
	CT                 string  `json:"ct"`
	RowNum             int     `json:"row_num"`
	EmployeFournisseur string  `json:"employe_fournisseur"`
	Type               string  `json:"type"`
	DateDepense        string  `json:"date_depense"`
	Heures             float64 `json:"heures"`
	Eur                float64 `json:"eur"`
}

type Alertes struct {
	CTRisque        []AlerteCT        `json:"ct_risque"`
	AlerteGlobale   bool              `json:"alerte_globale"`
	PctNonSecurise  *float64          `json:"pct_non_securise"`
	DeriveProvision []DeriveProvision `json:"derive_provision"`
}

type QualiteWarning struct {
	Code    string   `json:"code"`  // ex. "tg_ecart_budget", "mo_quantite_semaine", "sans_tg", "cloture", "plan_repartition", "mo_sans_nom", "plan_warn", "realise_warn"
	Regle   int      `json:"regle"` // n° §10 de la SPEC analyse, 0 si autre
	Message string   `json:"message"`
	Count   int      `json:"count"`
	Details []string `json:"details"` // au plus 50
}

type Correspondance struct {
	NomRealise  string     `json:"nom_realise"` // EMPLOYE/FOURNISSEUR brut
	NomPrenom   string     `json:"nom_prenom"`  // « NOM Prénom » sans civilité ("" si illisible)
	PersonneID  *string    `json:"personne_id"`
	PersonneNom string     `json:"personne_nom"`
	Confidence  Confidence `json:"confidence"` // nom | none
	NbEcritures int        `json:"nb_ecritures"`
	Heures      float64    `json:"heures"`
}

// ---------------------------------------------------------------------------
// Prévisions (SPEC_analyse §7.7) — horizon = tout le plan, indépendant de la période.

// PrevisionPoint is one week of a cumulative forecast series (€ cumulés depuis le début du plan).
type PrevisionPoint struct {
	Week          string     `json:"week"`           // "2026-W37"
	Debut         string     `json:"debut"`          // lundi, YYYY-MM-DD
	BudgetCumul   float64    `json:"budget_cumul"`   // dépense prévue cumulée (PPS réparti au prorata des heures)
	ReelCumul     *float64   `json:"reel_cumul"`     // € réalisés cumulés ; null après as_of
	PlanCumul     *float64   `json:"plan_cumul"`     // projection plan ; null avant as_of (= réel à as_of)
	TendanceCumul *float64   `json:"tendance_cumul"` // projection au rythme récent ; null avant as_of
	HeuresPlan    float64    `json:"heures_plan"`    // heures MO planifiées sur la semaine
	HeuresReel    *float64   `json:"heures_reel"`    // heures MO réalisées ; null après as_of
	Couverture    Couverture `json:"couverture"`     // couverture de la semaine par la timeline du plan
}

// PrevisionCT is the landing forecast of one CT (or of the whole perimeter for Global, CT = "").
type PrevisionCT struct {
	CT                   string           `json:"ct"`
	CTLibelle            string           `json:"ct_libelle"`
	Budget               float64          `json:"budget"`                // Σ PPS des lignes de plan
	Consomme             float64          `json:"consomme"`              // Σ TOTAL EN € brut (MO comprise) jusqu'à as_of
	PctConsomme          *float64         `json:"pct_consomme"`          // 0..100, null si budget nul
	ResteAFaire          float64          `json:"reste_a_faire"`         // PPS des semaines postérieures à as_of
	AtterrissagePlan     float64          `json:"atterrissage_plan"`     // consomme + reste_a_faire
	AtterrissageTendance float64          `json:"atterrissage_tendance"` // consomme + rythme_hebdo × semaines_restantes
	EcartPlan            float64          `json:"ecart_plan"`            // atterrissage_plan − budget
	EcartTendance        float64          `json:"ecart_tendance"`        // atterrissage_tendance − budget
	RythmeHebdo          float64          `json:"rythme_hebdo"`          // moyenne € des 4 dernières semaines réalisées
	SemainesRestantes    int              `json:"semaines_restantes"`    // semaines après as_of jusqu'à fin_plan
	FinPlan              string           `json:"fin_plan"`              // max date_fin des lignes du CT
	Statut               PrevisionStatut  `json:"statut"`
	Series               []PrevisionPoint `json:"series"`
}

// PrevisionStatut: depassement si atterrissage plan > budget ; vigilance si
// atterrissage tendance > budget ou atterrissage plan > 95 % du budget ; ok sinon.
type PrevisionStatut string

const (
	PrevisionOK          PrevisionStatut = "ok"
	PrevisionVigilance   PrevisionStatut = "vigilance"
	PrevisionDepassement PrevisionStatut = "depassement"
)

type Previsions struct {
	AsOf     string        `json:"as_of"`      // dernière date de dépense du réalisé (YYYY-MM-DD), "" si aucune
	AsOfWeek string        `json:"as_of_week"` // semaine ISO de as_of
	Global   PrevisionCT   `json:"global"`     // agrégat (CT = "")
	ParCT    []PrevisionCT `json:"par_ct"`     // tri : statut (dépassement d'abord) puis ecart_plan desc
}

// ---------------------------------------------------------------------------
// Anomalies (SPEC_analyse §7.8) : boîte de réception du contrôleur de gestion.

type AnomalieCategorie string

const (
	AnomalieEcart    AnomalieCategorie = "ecart"     // écart d'imputation regroupé par ressource × CT × flag
	AnomalieCTRisque AnomalieCategorie = "ct_risque" // Σ € non sécurisé > seuil
	AnomalieDerive   AnomalieCategorie = "derive"    // dérive de provision
	AnomalieQualite  AnomalieCategorie = "qualite"   // contrôle qualité §10
	AnomalieBudget   AnomalieCategorie = "budget"    // atterrissage prévu au-delà du budget
)

type AnomalieStatut string

const (
	AnomalieATraiter AnomalieStatut = "a_traiter"
	AnomalieTraitee  AnomalieStatut = "traitee"
	AnomalieIgnoree  AnomalieStatut = "ignoree"
)

type Anomalie struct {
	// Key : identifiant stable entre deux analyses (sans « / »), ex. "ecart|Y99F90001|DURAND Claire|sous_imputation".
	Key       string            `json:"key"`
	Categorie AnomalieCategorie `json:"categorie"`
	Gravite   int               `json:"gravite"` // 3 haute · 2 moyenne · 1 basse
	Titre     string            `json:"titre"`   // une ligne, ex. "DURAND Claire · Y99F90001 : sous-imputation"
	Detail    string            `json:"detail"`  // phrase explicative
	Flag      *Flag             `json:"flag,omitempty"`
	CT        string            `json:"ct,omitempty"`
	CTLibelle string            `json:"ct_libelle,omitempty"`
	Ressource string            `json:"ressource,omitempty"` // « NOM Prénom » (cf. EcartRow.Ressource)
	Montant   *float64          `json:"montant,omitempty"`   // € concernés
	Heures    *float64          `json:"heures,omitempty"`    // heures concernées (écart signé pour un écart)
	Semaines  []string          `json:"semaines,omitempty"`
	Details   []string          `json:"details,omitempty"` // au plus 50 lignes
	// Lien : route front vers les données concernées, ex. "/ecarts?ct=Y99F90001&ressource=DURAND+Claire".
	Lien string `json:"lien"`
	// Fingerprint : empreinte des chiffres (arrondis) ; un traitement dont l'empreinte diffère redevient « à traiter ».
	Fingerprint string         `json:"fingerprint"`
	Statut      AnomalieStatut `json:"statut"`
	Suivi       *AnomalieSuivi `json:"suivi,omitempty"`
}

// AnomalieSuivi is the stored treatment of an anomaly (table anomalie_suivi).
type AnomalieSuivi struct {
	Key         string         `json:"key"`
	Fingerprint string         `json:"fingerprint"`
	Statut      AnomalieStatut `json:"statut"` // traitee | ignoree
	Commentaire string         `json:"commentaire"`
	Operateur   string         `json:"operateur"`
	UpdatedAt   time.Time      `json:"updated_at"`
	Obsolete    bool           `json:"obsolete"` // empreinte changée depuis le traitement (l'anomalie est revenue à traiter)
}

// AnomalieSuiviInput is the body of PUT /analyse/anomalies/suivi.
type AnomalieSuiviInput struct {
	Key         string         `json:"key"`
	Fingerprint string         `json:"fingerprint"`
	Statut      AnomalieStatut `json:"statut"` // traitee | ignoree
	Commentaire string         `json:"commentaire"`
	Operateur   string         `json:"operateur"`
}

type AnalyseResult struct {
	Meta            AnalyseMeta      `json:"meta"`
	KPIs            KPIs             `json:"kpis"`
	Ecarts          []EcartRow       `json:"ecarts"` // tri par défaut : gravité desc puis |écart| desc
	Budget          Budget           `json:"budget"`
	Alertes         Alertes          `json:"alertes"`
	Qualite         []QualiteWarning `json:"qualite"`
	Correspondances []Correspondance `json:"correspondances"`
	Previsions      Previsions       `json:"previsions"`
	// Anomalies : tri gravité desc puis catégorie ; statut fusionné avec anomalie_suivi par le handler.
	Anomalies []Anomalie `json:"anomalies"`
}

// ---------------------------------------------------------------------------
// Dérive du plan (DECISIONS n° 12) : GET /plan/compare

type DeriveStatut string

const (
	DeriveAjoute   DeriveStatut = "ajoute"   // absent de la référence
	DeriveRetire   DeriveStatut = "retire"   // absent de la version comparée
	DeriveModifie  DeriveStatut = "modifie"  // |Δ PPS| ou |Δ charge| ≥ 0,01
	DeriveInchange DeriveStatut = "inchange" //
)

type PlanCompareTotaux struct {
	PPSFrom         float64 `json:"pps_from"`
	PPSTo           float64 `json:"pps_to"`
	ChargeFrom      float64 `json:"charge_from"`
	ChargeTo        float64 `json:"charge_to"`
	NbCTFrom        int     `json:"nb_ct_from"`
	NbCTTo          int     `json:"nb_ct_to"`
	NbPersonnesFrom int     `json:"nb_personnes_from"`
	NbPersonnesTo   int     `json:"nb_personnes_to"`
}

type PlanCompareCT struct {
	CT         string       `json:"ct"`
	Groupe     string       `json:"groupe"` // groupe Excel de la version la plus récente qui porte le CT
	PPSFrom    float64      `json:"pps_from"`
	PPSTo      float64      `json:"pps_to"`
	ChargeFrom float64      `json:"charge_from"`
	ChargeTo   float64      `json:"charge_to"`
	Statut     DeriveStatut `json:"statut"`
}

type PlanComparePersonne struct {
	NomPrenom  string       `json:"nom_prenom"` // « (non nominatif) » pour les lignes sans NOM Prénom
	PPSFrom    float64      `json:"pps_from"`
	PPSTo      float64      `json:"pps_to"`
	ChargeFrom float64      `json:"charge_from"`
	ChargeTo   float64      `json:"charge_to"`
	Statut     DeriveStatut `json:"statut"`
}

// PlanCompare : référence (From) vs version comparée (To), lignes non rejetées.
type PlanCompare struct {
	From        Version               `json:"from"`
	To          Version               `json:"to"`
	Totaux      PlanCompareTotaux     `json:"totaux"`
	ParCT       []PlanCompareCT       `json:"par_ct"`       // |Δ PPS| décroissant, puis CT
	ParPersonne []PlanComparePersonne `json:"par_personne"` // |Δ charge| décroissant, puis nom
}
