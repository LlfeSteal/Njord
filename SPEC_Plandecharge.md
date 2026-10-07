# SPEC_Plandecharge — Gestion du plan de charge

Module `njord` · volet **cycle de vie** des plans de charge.
Ne calcule rien, ne compare rien : voir `SPEC_analyse.md`.

## 0. Conventions

- Encodage UTF-8 · dates `YYYY-MM-DD` · décimal `.`.
- Placeholders : `CT_xxx`, `R_###`, `RES_ext_##`, `U_####`, `PRG_[A-Z]`, `A#####`.
- Enums génériques conservées : `Standard`, `Dates fixes`, `MAIN D'OEUVRE SUR SITE`, `CAPACITE SUR SITE`, `FRAIS DE MISSION`, `PROVISIONS POUR ALEAS`.
- Champs affichés aux utilisateurs, jamais loggés en clair : nom de personne, matricule, montant € individuel.

## 1. Rôle

Permettre à un utilisateur métier de **gérer le cycle de vie complet** d'un plan de charge : le déposer, le consulter, l'archiver, le purger. Toute logique d'exploitation (hebdo, écarts, budget) est hors périmètre.

## 2. Source attendue

| Attribut | Valeur |
|---|---|
| Format | `.xlsx` |
| Onglet attendu | `Plan de charge` |
| Ligne 1 | en-tête |
| Largeur logique | 12 colonnes |
| Granularité | 1 ligne = 1 affectation `(CT × Ressource × période)` |

## 3. Schéma brut de la ligne de plan

| # | Colonne | Type | Req. | Distincts | Exemple | Règle |
|---|---|---|---|---|---|---|
| 0 | Tâche ou sous-projet | `str` | ✓ | ~20 | `CT_A1` | 9 car., préfixe trigramme |
| 1 | Ressource | `str` | ✓ | ~87 | `R_001` \| `RES_ext_##` | peut porter préfixe `[inactif]` |
| 2 | Libellé | `str` | ✗ | ~51 | `<Prénom NOM>` \| `<Squad>` \| `<Squad> / <Prénom NOM>` | source de **NOM Prénom** (règles 9–11) |
| 3 | Type d'affectation | `str` | ✗ | 1 | `Standard` | absent en layout B |
| 4 | Ligne de coût | `enum` | ✓ | 2+ | `MAIN D'OEUVRE SUR SITE` \| `CAPACITE SUR SITE` | classification |
| 5 | Charge totale | `float` h | ✓ | 70–800 | 219.0 | heures période complète |
| 6 | .PPS | `float` € | ✓ | 0 possible | 25093.02 | budget associé |
| 7 | Pourcentage | `int` | ✓ | 7 | 40 | entier (toute valeur acceptée) |
| 8 | Unité | `str` | ✓ | ~25 | `U_####` | org unit |
| 9 | Calcul de la durée | `str` | ✓ | 1 | `Dates fixes` | constant |
| 10 | Date début | `date` | ✓ | — | `2026-09-01` | sériel Excel à convertir |
| 11 | Date fin | `date` | ✓ | — | `2027-01-31` | sériel Excel à convertir |

## 4. Règles de parsing

### 4.1 Double layout

L'onglet mélange deux formats coexistants. Algorithme de détection à appliquer ligne par ligne :

```
soit v3 = cellule en position 3 (0-based) de la ligne
si v3 == "Standard"                                 → layout A (mapping direct)
sinon si v3 est en majuscules et contient l'un de
   {"OEUVRE","CAPACITE","MISSION","PROVISION","ACHATS","STOCK"}
                                                    → layout B
sinon                                               → rejet "layout inconnu"
```

LAYOUT_B = la colonne 3 (Type d'affectation) est absente, tout est décalé d'une position vers la gauche à partir de là, et une colonne poubelle de valeur `1` termine la ligne.

### 4.2 Normalisation ressource

Le code `Ressource` **n'identifie plus personne** (DECISIONS n° 8) : il est conservé brut pour l'export CSV ; seul le préfixe `[inactif]` est exploité (strip + flag `inactive = true`). L'identité d'une ligne est le **NOM Prénom** extrait du `Libellé` (§8 règle 9).

### 4.3 Conversions

- Sériels Excel → `date` : epoch `1899-12-30 + n jours`.
- Décimaux : normaliser virgule → point.

## 5. Modèle métier

### 5.1 Version de plan

| Champ | Type | Notes |
|---|---|---|
| `id` | identifiant | généré à l'import |
| `intitulé` | texte | saisi ou déduit du nom de fichier |
| `importée_le` | horodatage | |
| `importeur` | utilisateur | |
| `statut` | enum | `active` \| `archivée` \| `purgée` |
| `archivée_le` | horodatage ? | renseigné au passage en archivée |
| `purgée_le` | horodatage ? | renseigné à la purge |
| `nb_lignes` | entier | lignes acceptées |
| `nb_warn` / `nb_drop` | entiers | issues du parsing |
| `layout_détecté` | enum | `A`, `B`, `mixte` |
| `période_couverte` | (date_min, date_max) | dérivée des lignes |
| `date_effet` | date | à partir de laquelle la version remplace les précédentes dans la timeline (SPEC_analyse §4.3) ; saisie à l'import, défaut = `date_min`, modifiable (journalisé) |

**Timeline** (2026-10-07) : le plan étant réactualisé chaque mois, l'analyse consolide toutes les versions non purgées selon leur date d'effet (SPEC_analyse §4.3) ; le statut `active` désigne la dernière version importée.

**Règle** : au plus **une** version `active` à la fois. Importer une nouvelle version **archive automatiquement** l'ancienne si l'utilisateur le confirme (comportement par défaut), sinon la nouvelle naît en `archivée`.

### 5.2 Ligne de plan

Les 12 colonnes du §3, plus :

| Champ | Type | Notes |
|---|---|---|
| `version_id` | référence | rattache à la version |
| `statut_parsing` | enum | `ok` \| `warn` \| `drop` |
| `motif_rejet` | texte ? | motif fonctionnel lisible |
| `inactive` | booléen | préfixe `[inactif]` |
| `personne_id` | référence ? | vers référentiel personnes si résolue |
| `squad_id` | référence ? | vers référentiel squads si résolue |

## 6. Référentiels rattachés à ce module

### 6.1 Squad

Entité d'organisation (équipe projet). Champs : `id`, `nom_canonique`, `alias[]`, `entité_rattachée`.
Peuplée automatiquement à l'import (détection dans la colonne `Libellé` du bloc B), enrichissable manuellement.

### 6.2 Personne

Identité humaine identifiée **uniquement par NOM + Prénom** (DECISIONS n° 8) : `Libellé` côté PDC, `EMPLOYE/FOURNISSEUR` sans civilité côté Réalisé. Ni code ressource, ni matricule, ni alias. Champs :

| Champ | Rôle |
|---|---|
| `id` | identifiant technique |
| `display_name` | « NOM Prénom » (non modifiable : c'est l'identité) |
| `nom_normalisé` | clé `NOM\|PRÉNOM` (majuscules, sans accents ni ponctuation, ordre conservé), unique |
| `squad_id` ? | rattachement hiérarchique |

**Règle de création** : à l'import, un NOM Prénom nouveau → création d'une fiche personne `brouillon` ; un NOM Prénom connu → rattachement à la fiche existante. Ligne sans NOM Prénom → non nominative, sans fiche.

## 7. Fonctionnalités (cycle de vie)

### 7.1 Importer un plan

**Entrée utilisateur** : fichier `.xlsx` + intitulé optionnel + date d'effet (pré-remplie avec la plus petite date de début du fichier).

**Comportement attendu** :
1. Lecture de l'onglet `Plan de charge`. Si absent → erreur bloquante "onglet introuvable".
2. Parse ligne à ligne avec détection layout A/B.
3. Application des règles §4 (normalisation ressource, conversion dates).
4. Enrichissement référentiels : création/rattachement `personne` et `squad`.
5. Bilan affiché à l'utilisateur :
   - lignes totales, `ok`, `warn`, `drop` ;
   - layout détecté (A / B / mixte) ;
   - % ressources marquées `[inactif]` ;
   - période couverte ;
   - nouvelles personnes/squads créées.
6. Demande de confirmation si une autre version `active` existe : "Archiver la version active `<intitulé>` ?".
7. Écriture de la nouvelle version en `active` (ou `archivée` si l'utilisateur refuse l'archivage automatique).

**Rejets** : aucune ligne écrite si l'en-tête ne contient pas les 12 colonnes attendues dans l'ordre.

### 7.2 Consulter la liste des versions

Vue par défaut : table triée, **actives en tête**, puis archivées (grisées), purgées masquées par défaut (toggle admin "afficher purgées").

Colonnes visibles : intitulé, importée_le, importeur, statut, nb_lignes, warn, drop, layout, période.

Actions en ligne : consulter, archiver/réactiver, purger (visible admin, condition §7.5).

### 7.3 Consulter le détail d'une version

Affiche la table des lignes avec :

- **Filtres** : CT, NOM Prénom, ligne de coût, statut parsing, inactive, squad, période.
- **Recherche plein-texte** sur Libellé / NOM Prénom / CT.
- **Indicateurs visuels** : badge `[inactif]`, badge `warn` avec tooltip motif, badge `drop` striqué.
- **Actions** : export CSV des lignes filtrées.
- **Pied de page** : sous-totaux `Σ charge totale` et `Σ PPS` par filtre courant.

### 7.4 Archiver (soft delete)

Action sur une version `active` ou déjà `archivée`.

- Passe `statut = archivée`, renseigne `archivée_le = now()`.
- **Empêche** la sélection implicite par le module Analyse (qui retombe sur la version active suivante).
- **Réversible** : réactiver archive la version active courante (règle d'unicité de l'active).
- Les lignes restent intégralement consultables et exportables.
- Journalisation de l'action (opérateur, horodatage).

### 7.5 Purger (hard delete différé)

Action **réservée rôle admin**, soumise à conditions cumulatives :

1. la version est en statut `archivée` ;
2. `archivée_le < now() − N jours` (N paramétrable, défaut **30**) ;
3. confirmation explicite avec saisie de l'intitulé exact.

Effet : suppression définitive des lignes + de la version.
Les référentiels `personne` / `squad` créés par cette version **ne sont pas supprimés** (ils peuvent être partagés).
Journalisation obligatoire.

## 8. Contrôles de parsing

Appliqués **à l'import uniquement**, le module Analyse gère ses propres contrôles métier.

| # | Règle | Comportement |
|---|---|---|
| 1 | en-tête 12 colonnes conformes | sinon rejet total |
| 2 | layout détecté ≠ inconnu | sinon `statut_parsing = drop` |
| 3 | ~~`pct ∈ {20,30,40,50,70,80,100}`~~ | **supprimée** (2026-10-05) : toute valeur numérique acceptée |
| 4 | `charge_totale ≥ 0` | sinon `drop` |
| 5 | `date_fin ≥ date_début` | sinon `warn` |
| 6 | `(CT, NOM Prénom, date_début, date_fin)` unique dans la version (libellé pour une ligne non nominative) | doublon → `warn` + agrégation implicite |
| 7 | CT non vide | sinon `drop` |
| 8 | ~~Ressource non vide~~ | **supprimée** (2026-10-06) : le code n'identifie plus personne |
| 9 | NOM Prénom extrait de la partie personne du Libellé (mots en MAJUSCULES = NOM ; sinon ordre `<Prénom NOM>`) | non identifiable (vide, un seul mot, code) → `warn` « ligne non nominative », ligne conservée au budget, sans personne |
| 10 | Libellé tout en majuscules (`ROBERT MICHEL`) | ordre `<NOM Prénom>` : dernier mot = prénom |
| 11 | ~~Ressource = NOM + initiale du prénom~~ | **supprimée** (2026-10-06, DECISIONS n° 8) |

## 9. Hors périmètre

Ce module **ne fait pas** :

- répartition hebdomadaire des heures → `SPEC_analyse.md` ;
- comparaison avec le réalisé, flags, seuils → `SPEC_analyse.md` ;
- classification budgétaire SECURISE/NON_SECURISE → `SPEC_analyse.md` ;
- jointure avec les écritures du Réalisé → `SPEC_analyse.md` (qui **lit** les référentiels §6).
