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
	// Réalisé uniquement.
	MontantTotalEur *float64 `json:"montant_total_eur,omitempty"`
	// Détail (tronqué à 500 entrées) et comptage par motif.
	Issues       []ParseIssue   `json:"issues"`
	MotifsCount  map[string]int `json:"motifs_count"`
	ActiveVersion *Version      `json:"active_version"` // version active existante (null sinon)
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
	Ressource       string  `json:"ressource"` // sans le préfixe [inactif]
	Libelle         string  `json:"libelle"`
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
	RessourceKind string        `json:"ressource_kind"` // internal | external | unknown
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

type AliasSource string

const (
	AliasImport   AliasSource = "import"   // créé automatiquement à l'import du plan
	AliasManuel   AliasSource = "manuel"   // saisi par l'utilisateur
	AliasConfirme AliasSource = "confirme" // correspondance fuzzy confirmée depuis l'analyse
)

type PersonneAlias struct {
	ID             int64       `json:"id"`
	Alias          string      `json:"alias"`
	AliasNormalise string      `json:"alias_normalise"`
	Source         AliasSource `json:"source"`
}

type Personne struct {
	ID           string          `json:"id"`
	DisplayName  string          `json:"display_name"`
	NomNormalise string          `json:"nom_normalise"`
	Statut       string          `json:"statut"` // brouillon | validee
	SquadID      *string         `json:"squad_id"`
	Matricules   []string        `json:"matricules"`
	Alias        []PersonneAlias `json:"alias"`
	CreatedAt    time.Time       `json:"created_at"`
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
	SeuilFuzzyCount       int      `json:"seuil_fuzzy_count"`        // 10
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
	ConfMatricule Confidence = "matricule"
	ConfAlias     Confidence = "alias"
	ConfFuzzy     Confidence = "fuzzy"
	ConfNone      Confidence = "none" // non apparié → hors plan
	ConfPlan      Confidence = "plan" // tuple issu du plan seul (aucun réel)
)

type WeekInfo struct {
	Week        string `json:"week"` // "2026-W37"
	Debut       string `json:"debut"`
	Fin         string `json:"fin"`
	JoursOuvres int    `json:"jours_ouvres"`
	Verrouillee bool   `json:"verrouillee"`
}

type AnalyseContext struct {
	PlanVersions     []Version  `json:"plan_versions"`    // non purgées
	RealiseVersions  []Version  `json:"realise_versions"` // non purgées
	DefaultPlanID    *string    `json:"default_plan_id"`
	DefaultRealiseID *string    `json:"default_realise_id"`
	DefaultWeekFrom  string     `json:"default_week_from"`
	DefaultWeekTo    string     `json:"default_week_to"`
	Weeks            []WeekInfo `json:"weeks"` // union des semaines couvertes par les versions par défaut
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
}

// EcartRow is one tuple (CT × ressource × semaine) of the écarts table (§7.1).
type EcartRow struct {
	PersonneID     *string    `json:"personne_id"`     // null si hors plan non résolu
	Ressource      string     `json:"ressource"`       // code ressource PDC, ou nom réalisé si hors plan
	RessourceLabel string     `json:"ressource_label"` // nom affichable
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
	Warn           bool       `json:"warn"` // une ligne source est en statut warn
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
	ParCT  []BudgetCT   `json:"par_ct"`
	Global BudgetGlobal `json:"global"`
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
	Code    string   `json:"code"`  // ex. "tg_ecart_budget", "mo_quantite_semaine", "fuzzy", "sans_tg", "cloture", "plan_repartition", "mo_sans_nom", "plan_warn", "realise_warn"
	Regle   int      `json:"regle"` // n° §10 de la SPEC analyse, 0 si autre
	Message string   `json:"message"`
	Count   int      `json:"count"`
	Details []string `json:"details"` // au plus 50
}

type Correspondance struct {
	NomRealise   string     `json:"nom_realise"`
	NomNormalise string     `json:"nom_normalise"`
	PersonneID   *string    `json:"personne_id"`
	PersonneNom  string     `json:"personne_nom"`
	Ressource    string     `json:"ressource"` // code ressource PDC
	Confidence   Confidence `json:"confidence"`
	NbEcritures  int        `json:"nb_ecritures"`
	Heures       float64    `json:"heures"`
}

type AnalyseResult struct {
	Meta            AnalyseMeta      `json:"meta"`
	KPIs            KPIs             `json:"kpis"`
	Ecarts          []EcartRow       `json:"ecarts"` // tri par défaut : gravité desc puis |écart| desc
	Budget          Budget           `json:"budget"`
	Alertes         Alertes          `json:"alertes"`
	Qualite         []QualiteWarning `json:"qualite"`
	Correspondances []Correspondance `json:"correspondances"`
}
