package store

// schema is the complete SQLite schema. It is part of the inter-module contract:
// modules read/write their own tables directly with SQL, but only the
// integrator changes the DDL.
const schema = `
CREATE TABLE IF NOT EXISTS versions (
	id                TEXT PRIMARY KEY,
	kind              TEXT NOT NULL CHECK (kind IN ('plan','realise')),
	intitule          TEXT NOT NULL,
	importee_le       TEXT NOT NULL,          -- RFC3339
	importeur         TEXT NOT NULL DEFAULT 'local',
	statut            TEXT NOT NULL CHECK (statut IN ('active','archivee','purgee')),
	archivee_le       TEXT,
	purgee_le         TEXT,
	nb_lignes         INTEGER NOT NULL DEFAULT 0,
	nb_warn           INTEGER NOT NULL DEFAULT 0,
	nb_drop           INTEGER NOT NULL DEFAULT 0,
	periode_debut     TEXT NOT NULL DEFAULT '',
	periode_fin       TEXT NOT NULL DEFAULT '',
	source_format     TEXT NOT NULL DEFAULT '',
	filename          TEXT NOT NULL DEFAULT '',
	layout            TEXT NOT NULL DEFAULT '',
	montant_total_eur REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS versions_one_active ON versions(kind) WHERE statut = 'active';

CREATE TABLE IF NOT EXISTS squads (
	id               TEXT PRIMARY KEY,
	nom_canonique    TEXT NOT NULL,
	nom_normalise    TEXT NOT NULL UNIQUE,   -- names.NormalizeSquad(nom_canonique)
	entite_rattachee TEXT NOT NULL DEFAULT '',
	parent_id        TEXT REFERENCES squads(id) ON DELETE SET NULL,
	created_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS squad_alias (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	squad_id      TEXT NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
	alias         TEXT NOT NULL,
	alias_normalise TEXT NOT NULL,
	UNIQUE (alias_normalise)
);

CREATE TABLE IF NOT EXISTS personnes (
	id            TEXT PRIMARY KEY,
	display_name  TEXT NOT NULL,
	nom_normalise TEXT NOT NULL DEFAULT '',  -- names.Normalize(display_name)
	statut        TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','validee')),
	squad_id      TEXT REFERENCES squads(id) ON DELETE SET NULL,
	created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS personnes_nom ON personnes(nom_normalise);
-- Identifiants métier : code ressource PDC (ex. DURANDC, 2GI_...) ou matricule A##### du réalisé.
CREATE TABLE IF NOT EXISTS personne_matricules (
	personne_id TEXT NOT NULL REFERENCES personnes(id) ON DELETE CASCADE,
	matricule   TEXT NOT NULL UNIQUE,
	PRIMARY KEY (personne_id, matricule)
);
CREATE TABLE IF NOT EXISTS personne_alias (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	personne_id     TEXT NOT NULL REFERENCES personnes(id) ON DELETE CASCADE,
	alias           TEXT NOT NULL,
	alias_normalise TEXT NOT NULL,           -- names.Normalize(alias)
	source          TEXT NOT NULL CHECK (source IN ('import','manuel','confirme')),
	created_at      TEXT NOT NULL,
	UNIQUE (personne_id, alias_normalise)
);
CREATE INDEX IF NOT EXISTS personne_alias_norm ON personne_alias(alias_normalise);

CREATE TABLE IF NOT EXISTS plan_lines (
	id                INTEGER PRIMARY KEY AUTOINCREMENT,
	version_id        TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
	row_num           INTEGER NOT NULL,
	layout            TEXT NOT NULL DEFAULT '',
	ct                TEXT NOT NULL DEFAULT '',
	ressource         TEXT NOT NULL DEFAULT '',
	libelle           TEXT NOT NULL DEFAULT '',
	nom_prenom        TEXT NOT NULL DEFAULT '',  -- « NOM Prénom » extrait du libellé
	type_affectation  TEXT NOT NULL DEFAULT '',
	ligne_cout        TEXT NOT NULL DEFAULT '',
	charge_totale     REAL NOT NULL DEFAULT 0,
	pps               REAL NOT NULL DEFAULT 0,
	pourcentage       INTEGER NOT NULL DEFAULT 0,
	unite             TEXT NOT NULL DEFAULT '',
	calcul_duree      TEXT NOT NULL DEFAULT '',
	date_debut        TEXT NOT NULL DEFAULT '',
	date_fin          TEXT NOT NULL DEFAULT '',
	quantite_affectee REAL,
	taux_fixe         TEXT NOT NULL DEFAULT '',
	depuis            TEXT NOT NULL DEFAULT '',
	pendant           TEXT NOT NULL DEFAULT '',
	statut_parsing    TEXT NOT NULL CHECK (statut_parsing IN ('ok','warn','drop')),
	motif_rejet       TEXT NOT NULL DEFAULT '',
	ressource_kind    TEXT NOT NULL DEFAULT 'unknown',
	inactive          INTEGER NOT NULL DEFAULT 0,
	personne_id       TEXT REFERENCES personnes(id) ON DELETE SET NULL,
	squad_id          TEXT REFERENCES squads(id) ON DELETE SET NULL,
	groupe            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS plan_lines_version ON plan_lines(version_id);

-- Suivi des anomalies (SPEC_analyse §7.8) : traitement manuel par le contrôleur de gestion.
CREATE TABLE IF NOT EXISTS anomalie_suivi (
	key         TEXT PRIMARY KEY,
	fingerprint TEXT NOT NULL,
	statut      TEXT NOT NULL CHECK (statut IN ('traitee','ignoree')),
	commentaire TEXT NOT NULL DEFAULT '',
	operateur   TEXT NOT NULL DEFAULT '',
	updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS realise_entries (
	id                   INTEGER PRIMARY KEY AUTOINCREMENT,
	version_id           TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
	row_num              INTEGER NOT NULL,
	entite               TEXT NOT NULL DEFAULT '',
	activite             TEXT NOT NULL DEFAULT '',
	sous_activite        TEXT NOT NULL DEFAULT '',
	trigramme            TEXT NOT NULL DEFAULT '',
	tg                   TEXT NOT NULL DEFAULT '',
	tg_libelle           TEXT NOT NULL DEFAULT '',
	wp                   TEXT NOT NULL DEFAULT '',
	wp_libelle           TEXT NOT NULL DEFAULT '',
	description_depenses TEXT NOT NULL DEFAULT '',
	categorie            TEXT NOT NULL DEFAULT '',
	type                 TEXT NOT NULL DEFAULT '',
	categorie_fnp        TEXT NOT NULL DEFAULT '',
	employe_fournisseur  TEXT NOT NULL DEFAULT '',
	matricule            TEXT NOT NULL DEFAULT '',
	fpc                  TEXT NOT NULL DEFAULT '',
	cea                  TEXT NOT NULL DEFAULT '',
	quantite             REAL NOT NULL DEFAULT 0,
	total_eur            REAL NOT NULL DEFAULT 0,
	date_depense         TEXT NOT NULL DEFAULT '',
	periode_comptable    TEXT NOT NULL DEFAULT '',
	compte_comptable     TEXT NOT NULL DEFAULT '',
	num_facture          TEXT NOT NULL DEFAULT '',
	num_commande         TEXT NOT NULL DEFAULT '',
	num_ligne            INTEGER,
	lot_ifrs15           TEXT NOT NULL DEFAULT '',
	nom_ressource        TEXT NOT NULL DEFAULT '',
	fournisseur          TEXT NOT NULL DEFAULT '',
	code_article         TEXT NOT NULL DEFAULT '',
	mois_comptable       TEXT NOT NULL DEFAULT '',
	statut_parsing       TEXT NOT NULL CHECK (statut_parsing IN ('ok','warn','drop')),
	motif_rejet          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS realise_entries_version ON realise_entries(version_id);

CREATE TABLE IF NOT EXISTS audit_log (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	at         TEXT NOT NULL,
	operateur  TEXT NOT NULL,
	action     TEXT NOT NULL,
	objet_type TEXT NOT NULL,
	objet_id   TEXT NOT NULL DEFAULT '',
	details    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
	id   INTEGER PRIMARY KEY CHECK (id = 1),
	json TEXT NOT NULL
);

-- Seul le dernier rendu d'analyse est conservé (SPEC_analyse §11).
CREATE TABLE IF NOT EXISTS analyse_last_result (
	id         INTEGER PRIMARY KEY CHECK (id = 1),
	params     TEXT NOT NULL,
	json       TEXT NOT NULL,
	created_at TEXT NOT NULL
);
`
