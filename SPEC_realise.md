# SPEC_realise — Gestion du réalisé

Module `njord` · volet **cycle de vie** des écritures du réalisé.
Ne classe rien, ne calcule rien, ne joint rien : voir `SPEC_analyse.md`.

## 0. Conventions

- Encodage UTF-8 · dates `YYYY-MM-DD` · décimal `.`.
- Placeholders : `ENTITE_[A-Z]`, `ACTIVITE_[A-Z]`, `SA_[A-Z]`, `PRG_[A-Z]`, `CT_xxxxxxxxx`, `WP_xxxxxxxxx`, `CCP_########`, `LOT_#`, `FPC_##`, `CEA_xxxx`, `A#####`, `F_###########`, `CMD_#######`.
- Champs **sensibles** jamais loggés en clair : `DESCRIPTION DEPENSES`, `EMPLOYE/FOURNISSEUR`, `MATRICULE`, `N° FACTURE`, `n° COMMANDE`, montant unitaire.

## 1. Rôle

Gérer le dépôt, la consultation, l'archivage et la purge des écritures du réalisé, sans aucun traitement analytique.

## 2. Source attendue

| Attribut | Valeur |
|---|---|
| Format | `.xlsx` |
| Onglet attendu | `Réalisé` |
| Ligne 1 | en-tête |
| Largeur logique | 25 colonnes |
| Granularité | 1 ligne = 1 écriture comptable |
| Valeur de nullité littérale | `-` à convertir en champ vide |

## 3. Schéma brut de l'écriture réalisé

| # | Colonne | Type | Req. | Distincts | Exemple | Règle de parsing |
|---|---|---|---|---|---|---|
| 0 | ENTITE | `enum` | ✓ | 3 | `ENTITE_A` | |
| 1 | ACTIVITE | `enum` | ✓ | 5 | `ACTIVITE_A` | |
| 2 | SOUS-ACTIVITE | `enum` | ✓ | 5 | `SA_A` | |
| 3 | TRIGRAMME | `enum` | ✓ | 5 | `PRG_A` | 3 car. |
| 4 | TG | `str` | ✓ | 47 | `CT_xxxxxxxxx` | 9 car. |
| 5 | TG - LIBELLE | `str` | ✓ | 47 | `CT_xxxxxxxxx - <libellé>` | affichage |
| 6 | WP | `str` | ✗ | 11 | `WP_xxxxxxxxx` | `-` → vide |
| 7 | WP LIBELLE | `str` | ✓ | 12 | idem | |
| 8 | DESCRIPTION DEPENSES | `str` | ✗ | ~466 | texte libre | sensible |
| 9 | CATEGORIE | `enum` | ✓ | 6 | `MAIN D'OEUVRE`… | |
| 10 | TYPE | `enum` | ✓ | 13 | `CAPACITE SUR SITE`… | brut, non classé ici |
| 11 | CATEGORIE DEPENSES POUR FNP AUTOMATIQUES | `enum` | ✓ | 6 | idem §9 | brut |
| 12 | EMPLOYE/FOURNISSEUR | `str` | ✗ | 200 | `<NOM Prénom M.>` | sensible |
| 13 | MATRICULE | `str` | ✗ | 181 | `A#####` | sensible |
| 14 | FPC | `enum` | ✗ | 10 | `FPC_## <libellé>` | |
| 15 | CEA | `enum` | ✗ | 26 | `CEA_xxxx` | |
| 16 | QUANTITE | `float` | ✓ | 530 | 350.0 | heures MO **ou** unité matière |
| 17 | TOTAL EN € | `float` signé | ✓ | 677 | −61 800.0 | avoirs < 0, **ne pas filtrer** |
| 18 | DATE DEPENSE | `date` | ✓ | 215 | `2026-XX-XX` | sériel Excel |
| 19 | PERIODE COMPTABLE | `date` | ✓ | 9 | `2026-XX-XX` | sériel Excel **float**, à arrondir |
| 20 | COMPTE COMPTABLE | `enum` | ✓ | 21 | `CCP_########` | |
| 21 | N° FACTURE | `str` | ✗ | 244 | `F_###########` | sensible |
| 22 | n° COMMANDE | `str` | ✗ | 26 | `CMD_#######` | sensible |
| 23 | n° LIGNE | `int` | ✗ | 6 | 1 | |
| 24 | LOT DE PROGRAMME IFRS15 | `enum` | ✗ | 4 | `LOT_1` | |

Enum `TYPE` observées : `MAIN D'OEUVRE SUR SITE`, `CAPACITE SUR SITE`, `FRAIS DE MISSION`, `FRAIS ACHATS MATIERE`, `FRAIS ACHATS PRESTATIONS`, `AUTRES PRESTATIONS`, `IMMOBILISATIONS`, `NON STOCKABLE`, `MATIERE`, `PRESTATION`, `FNP AUTOMATIQUES`, `FNP MANUELLES`, `OD PRESTATION`, `OD AUTRES DEPENSES`, `OD FRAIS DE MISSION`.

Enum `CATEGORIE` observées : `MAIN D'OEUVRE`, `PRESTATION`, `MATIERE`, `IMMOBILISATIONS`, `FRAIS DE MISSION`, `AUTRES DEPENSES`.

## 4. Règles de parsing

- Sériels Excel → dates : epoch `1899-12-30 + n jours`.
- `PERIODE COMPTABLE` est un **flottant** (ex. `46112.9999…`) → **arrondir** avant conversion.
- Toute cellule valant `-` (tiret seul) → `None`.
- Décimaux : normaliser virgule → point.
- Les montants négatifs (avoirs) sont **conservés tels quels**.

**Aucun enrichissement** n'est appliqué ici : pas de calcul `iso_week`, pas de classification budget, pas de distinction heures/€. Tout est dérivé côté Analyse.

## 5. Modèle métier

### 5.1 Version d'import réalisé

| Champ | Type | Notes |
|---|---|---|
| `id` | identifiant | |
| `intitulé` | texte | saisi ou déduit du nom de fichier |
| `importée_le` | horodatage | |
| `importeur` | utilisateur | |
| `statut` | enum | `active` \| `archivée` \| `purgée` |
| `archivée_le`, `purgée_le` | horodatage ? | cycle de vie |
| `nb_lignes` / `nb_warn` / `nb_drop` | entiers | bilan import |
| `période_couverte` | (date_min, date_max) | min/max DATE DEPENSE |
| `montant_total_eur` | float | `Σ TOTAL EN €` (toutes lignes acceptées) |

**Règle** : au plus une version `active` à la fois.

### 5.2 Écriture réalisé

Les 25 colonnes du §3 telles quelles + :

| Champ | Notes |
|---|---|
| `version_id` | rattachement |
| `statut_parsing` | `ok` \| `warn` \| `drop` |
| `motif_rejet` | motif lisible |

Aucune colonne dérivée (heures, €, classification, iso_week) n'est stockée ici : l'analyse les recalcule à la demande.

## 6. Fonctionnalités (cycle de vie)

### 6.1 Importer un réalisé

**Entrée** : fichier `.xlsx` + intitulé optionnel.

**Comportement attendu** :
1. Lecture de l'onglet `Réalisé`. Absent → erreur bloquante.
2. Parsing ligne à ligne avec les règles §4.
3. Bilan : lignes totales / `ok` / `warn` / `drop`, période couverte, montant total €.
4. Demande de confirmation si une version active existe déjà ("Archiver la version `<intitulé>` ?").
5. Écriture en `active` (ou `archivée` si refus).

Aucune enrichissement, aucune écriture dans les référentiels squads/personnes (réservé au module Plan de charge, alimentant l'analyse).

### 6.2 Consulter la liste des versions

Table triée : actives en tête, archivées grisées, purgées masquées par défaut.
Colonnes : intitulé, importée_le, importeur, statut, nb_lignes, warn, drop, période couverte, montant total €.
Actions : consulter, archiver/réactiver, purger (admin, conditions §6.5).

### 6.3 Consulter le détail

Table filtrable des écritures avec :

- **Filtres** : ENTITE, ACTIVITE, TRIGRAMME, TG, WP, CATEGORIE, TYPE, classification LOT IFRS15, période, plage de montant.
- **Recherche plein-texte** sur TG, TG-LIBELLE, DESCRIPTION (désactivable pour raison sensible).
- **Tri** par DATE DEPENSE, TOTAL EN €, TG.
- **Masquage sélectif** des colonnes sensibles (nom, matricule, facture) si l'utilisateur n'a pas le rôle habilité.
- **Pied de page** : sous-totaux `Σ QUANTITE`, `Σ TOTAL EN €` sur le filtre courant ; nb lignes par CATEGORIE.
- **Export CSV** des lignes filtrées (respecte le masquage).

### 6.4 Archiver (soft delete)

Identique au plan de charge :
- passe `statut = archivée`, renseigne `archivée_le`.
- la version n'est plus sélectionnable implicitement par le module Analyse.
- réversible (réactiver archive l'active courante).
- journalisée.

### 6.5 Purger (hard delete différé)

Réservé admin, conditions cumulatives :
1. statut `archivée` ;
2. `archivée_le < now() − N jours` (défaut **30**) ;
3. confirmation avec saisie de l'intitulé exact.

Supprime définitivement écritures + version. Journalisation obligatoire.

## 7. Contrôles de parsing

| # | Règle | Comportement |
|---|---|---|
| 1 | en-tête 25 colonnes conformes | sinon rejet total |
| 2 | `TG` non vide | sinon `drop` |
| 3 | `DATE DEPENSE` non vide et convertible | sinon `drop` |
| 4 | `TYPE` ∈ énuméré | sinon `warn`, ligne conservée |
| 5 | `CATEGORIE` ∈ énuméré | sinon `warn` |
| 6 | `TOTAL EN €` convertible en nombre | sinon `drop` |
| 7 | `PERIODE COMPTABLE < DATE DEPENSE − 7 j` | `warn` (clôture anormale) |
| 8 | doublon `(N° FACTURE, n° COMMANDE, n° LIGNE, TG, DATE DEPENSE)` | `warn` |

## 8. Hors périmètre

Ce module **ne fait pas** :

- distinction heures MO / montants € → `SPEC_analyse.md` ;
- classification SECURISE / NON_SECURISE / NON_CLASSE → `SPEC_analyse.md` ;
- rattachement à une semaine ISO → `SPEC_analyse.md` ;
- jointure avec les ressources du plan de charge → `SPEC_analyse.md` ;
- enrichissement des référentiels squads/personnes → `SPEC_Plandecharge.md` §6.
