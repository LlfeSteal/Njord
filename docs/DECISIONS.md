# Décisions & écarts aux SPEC

Validées avec le métier (2026-10-05) ou retenues par l'intégrateur. Tout agent qui rencontre une ambiguïté nouvelle l'ajoute ici (section « À arbitrer ») plutôt que de trancher en silence.

## Validé par l'utilisateur
1. **Deux formats Excel supportés** pour chaque source : format **démo** (fichiers `test_data_demo/`, prioritaire) et format **spec**. Détection de l'onglet (préféré : `Plan de charge` / `Réalisé`, sinon tout onglet) et de la ligne d'en-tête (20 premières lignes) **par noms de colonnes** normalisés (`xlsxutil.NormHeader`), puis mapping par nom (pas par position, sauf détection layout B qui est positionnelle par nature).
2. **Pas de rôles** : tout le monde peut tout faire (purge comprise). Restent : purge si archivée depuis ≥ `purge_delai_jours` + saisie exacte de l'intitulé. Masquage des colonnes sensibles = toggle d'affichage (paramètre `mask_sensitive`). Jamais de donnée sensible dans les logs.
3. **Heures MO** : `heures = QUANTITE` seulement si `TYPE ∈ mo_types` **et** `CATEGORIE = "MAIN D'OEUVRE"` ; sinon `heures = 0, eur = TOTAL EN €`. (Dans la démo, des lignes `CAPACITE SUR SITE` de catégorie `PRESTATION` portent des montants dans `Quantité`.) Les lignes MO ont `eur = 0` (spec §3.1, évite le double comptage) ; leur coût est exposé à titre informatif (`BudgetCT.cout_mo_eur`).

## Format démo — Plan de charge
- Onglet `Style par défaut`, en-tête ligne 3, 16 colonnes (12 de la spec + `Quantité affectée`, `Taux fixe`, `Depuis`, `Pendant`). Les colonnes en plus ne font pas échouer le contrôle d'en-tête : la règle « 12 colonnes conformes » = les 12 colonnes attendues présentes **dans l'ordre** en tête de ligne.
- Lignes ignorées (non comptées) : lignes vides, **lignes de groupe** (seule la 1re cellule remplie, ex. `Squad Alpha — Plateforme`), **lignes `Somme`**.
- **Squads imbriqués** : un groupe est suivi de sa ligne `Somme` (charge totale du groupe). Pile de groupes ouverts ; chaque ligne de données ajoute sa charge à tous les groupes ouverts ; un groupe se ferme quand son cumul atteint sa `Somme` (±0.01). Squad de la ligne = groupe ouvert le plus interne ; `groupe` = chemin `Parent > Enfant`. Squads créés avec `parent_id`. Sans `Somme` : le dernier groupe rencontré.
- CT de 9 **ou 10** caractères acceptés (`Y99F900010`).
- Ressource : `[inactif]` → strip + `inactive`; motif `^[A-Z0-9_]{1,12}$` sans `_` long → `internal` (ex. `DURANDC`, `R_001`) ; préfixe `2GI_` / `RES_ext_` ou longueur > 12 → `external` ; sinon `unknown` (warn).

## Format démo — Réalisé
Onglet `MyWorkSheet-1`, en-tête ligne 1, ligne `Totaux` ignorée, 16 colonnes. Mapping :

| Démo | Champ |
|---|---|
| `Tâche code et description` | `tg` (code avant ` - `), `tg_libelle` (texte complet) |
| `WP code et description` | `wp`, `wp_libelle` |
| `Description de dépense` | `description_depenses` |
| `Catégorie de dépense` / `Type de dépense` / `Catégorie de dépense des FNP` | `categorie` / `type` / `categorie_fnp` |
| `Nom ressource` | `nom_ressource` et `employe_fournisseur` |
| `Fournisseur` | `fournisseur` et `employe_fournisseur` si pas de nom ressource |
| `Quantité` | `quantite` |
| `Coût détaillé` (**k€**) | `total_eur = × 1000` |
| `Date de dépense` | `date_depense` |
| `Date Comptable` | `periode_comptable` |
| `Mois-Année Comptable` | `mois_comptable` |
| `Numéro facture` / `Numéro commande` / `Code article` | `num_facture` / `num_commande` / `code_article` |
| absents | ENTITE, ACTIVITE, SOUS-ACTIVITE, TRIGRAMME, MATRICULE, FPC, CEA, COMPTE, n° LIGNE, LOT → vides |

- Règle 8 (doublons) : clé testée seulement si `num_facture` ou `num_commande` non vide.
- Valeurs `-` → vide partout. Avoirs négatifs conservés.

## Analyse — interprétations
- **⚫ Absence** : tuple `réel = 0 ∧ prévu > 0` **et** la personne a `Σ réel = 0` sur toute la période analysée (§9). Sinon le tuple est évalué par l'écart.
- **Calendrier** : jours ouvrés = lun–ven ∩ [date_début, date_fin] de la ligne − `jours_feries` ; semaines ISO dont le numéro ∈ `semaines_verrouillees` → 0 jour. `charge_hebdo = charge_totale × jo(ligne ∩ semaine) / jo(ligne)`. Le tableau §4.1 de la spec n'est pas codé en dur (année différente, incohérent). Contrôle §4.2 : Σ hebdo vs charge_totale (±0.5 h) — l'écart vient des semaines verrouillées / lignes sans jour ouvré → warn qualité `plan_repartition`.
- **Période d'analyse** en semaines ISO `YYYY-Www` ; défaut = semaines communes au plan (date_début min → date_fin max) et au réalisé (date_dépense min → max).
- **Correspondance** (écritures `heures > 0` uniquement) : 1) `matricule` réalisé ∈ `personne_matricules` ; 2) `Normalize(employe_fournisseur)` = alias de source `manuel`/`confirme` → `alias` ; 3) = alias de source `import` ou nom normalisé d'une personne ou `names.PersonKey(libellé)` d'une ligne du plan retenu → `fuzzy` ; 4) sinon `none` → 🟠 Hors plan.
- **Jointure** `(ct, personne_id, semaine)`. Personne résolue mais non planifiée sur ce CT → prévu 0. Réel sur semaine verrouillée → 🟠.
- **Ressource** d'un tuple : code ressource PDC de la personne (sinon nom réalisé).
- **Taux de conformité** : `nb 🟢 / nb tuples comparés` où tuples comparés = tuples hors 🟠, en excluant les ressources `inactive` sauf `include_inactive`.
- **Dérive de provision** : écritures non rattachées (`none`) sur un CT dont le plan porte une ligne `PROVISIONS POUR ALEAS`, ou de TYPE `PROVISIONS POUR ALEAS`.
- **Qualité §10.1** : |Σ € réalisé par TG − Σ PPS plan du CT| > `seuil_ecart_tg_eur` → warn.

## À arbitrer
_(vide)_
