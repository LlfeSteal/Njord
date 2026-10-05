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

| Pattern | `kind` | Traitement |
|---|---|---|
| préfixe `[inactif]` | — | strip + flag `inactive = true` |
| court (matricule interne type `R_###`) | `internal` | clé conservée telle quelle |
| long type `2GI_…_Ollioules_…_` | `external` | clé conservée, rattachée au référentiel squads |
| autre | `unknown` | ligne conservée, warn |

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

**Règle** : au plus **une** version `active` à la fois. Importer une nouvelle version **archive automatiquement** l'ancienne si l'utilisateur le confirme (comportement par défaut), sinon la nouvelle naît en `archivée`.

### 5.2 Ligne de plan

Les 12 colonnes du §3, plus :

| Champ | Type | Notes |
|---|---|---|
| `version_id` | référence | rattache à la version |
| `statut_parsing` | enum | `ok` \| `warn` \| `drop` |
| `motif_rejet` | texte ? | motif fonctionnel lisible |
| `ressource_kind` | enum | `internal` \| `external` \| `unknown` |
| `inactive` | booléen | préfixe `[inactif]` |
| `personne_id` | référence ? | vers référentiel personnes si résolue |
| `squad_id` | référence ? | vers référentiel squads si résolue |

## 6. Référentiels rattachés à ce module

### 6.1 Squad

Entité d'organisation (équipe projet). Champs : `id`, `nom_canonique`, `alias[]`, `entité_rattachée`.
Peuplée automatiquement à l'import (détection dans la colonne `Libellé` du bloc B), enrichissable manuellement.

### 6.2 Personne

Identité humaine canonique servant à faire le pont entre PDC (`Ressource` court, `Libellé` humain) et Réalisé (`MATRICULE`, `EMPLOYE/FOURNISSEUR`). Champs :

| Champ | Rôle |
|---|---|
| `id` | identité canonique |
| `nom_normalisé` | clé de rapprochement (uppercase, ponctuation retirée, tokens triés) |
| `matricules[]` | un ou plusieurs identifiants métier (PDC court, matricule A##### du Réalisé…) |
| `alias[]` | variantes de nom vues dans les deux sources |
| `squad_id` ? | rattachement hiérarchique |

**Règle de création** : à l'import, si une ressource est nouvelle → création d'une fiche personne `brouillon` ; l'utilisateur peut la rattacher à une fiche existante depuis l'écran de détail.

## 7. Fonctionnalités (cycle de vie)

### 7.1 Importer un plan

**Entrée utilisateur** : fichier `.xlsx` + intitulé optionnel.

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

- **Filtres** : CT, ressource, ligne de coût, statut parsing, inactive, squad, période.
- **Recherche plein-texte** sur Libellé / CT / Ressource.
- **Indicateurs visuels** : badge `[inactif]`, badge `warn` avec tooltip motif, badge `drop` striqué.
- **Actions** : export CSV des lignes filtrées ; création manuelle d'un alias personne.
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
| 6 | `(CT, Ressource, date_début, date_fin)` unique dans la version | doublon → `warn` + agrégation implicite |
| 7 | CT non vide | sinon `drop` |
| 8 | Ressource non vide | sinon `drop` |
| 9 | NOM Prénom extrait de la partie personne du Libellé (mots en MAJUSCULES = NOM ; sinon ordre `<Prénom NOM>`) | non identifiable (vide, un seul mot, code) → `warn`, ligne conservée |
| 10 | Libellé tout en majuscules (`ROBERT MICHEL`) : ordre tranché par le code Ressource | aucun ordre ne correspond → `warn` « ordre nom/prénom ambigu », libellé gardé tel quel |
| 11 | Ressource = NOM (sans accents/espaces/tirets/apostrophes) + initiale du prénom (`DE LA TOUR Antoine` → `DELATOURA`) | sinon `warn` « attendu XXX », code du fichier conservé |

## 9. Hors périmètre

Ce module **ne fait pas** :

- répartition hebdomadaire des heures → `SPEC_analyse.md` ;
- comparaison avec le réalisé, flags, seuils → `SPEC_analyse.md` ;
- classification budgétaire SECURISE/NON_SECURISE → `SPEC_analyse.md` ;
- jointure avec les écritures du Réalisé → `SPEC_analyse.md` (qui **lit** les référentiels §6).
