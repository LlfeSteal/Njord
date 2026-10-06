# Décisions & écarts aux SPEC

Validées avec le métier (2026-10-05) ou retenues par l'intégrateur. Tout agent qui rencontre une ambiguïté nouvelle l'ajoute ici (section « À arbitrer ») plutôt que de trancher en silence.

## Validé par l'utilisateur
1. **Deux formats Excel supportés** pour chaque source : format **démo** (fichiers `test_data_demo/`, prioritaire) et format **spec**. Détection de l'onglet (préféré : `Plan de charge` / `Réalisé`, sinon tout onglet) et de la ligne d'en-tête (20 premières lignes) **par noms de colonnes** normalisés (`xlsxutil.NormHeader`), puis mapping par nom (pas par position, sauf détection layout B qui est positionnelle par nature).
2. **Pas de rôles** : tout le monde peut tout faire (purge comprise). Restent : purge si archivée depuis ≥ `purge_delai_jours` + saisie exacte de l'intitulé. Masquage des colonnes sensibles = toggle d'affichage (paramètre `mask_sensitive`). Jamais de donnée sensible dans les logs.
3. **Heures MO** : `heures = QUANTITE` seulement si `TYPE ∈ mo_types` **et** `CATEGORIE = "MAIN D'OEUVRE"` ; sinon `heures = 0, eur = TOTAL EN €`. (Dans la démo, des lignes `CAPACITE SUR SITE` de catégorie `PRESTATION` portent des montants dans `Quantité`.) Les lignes MO ont `eur = 0` (spec §3.1, évite le double comptage) ; leur coût est exposé à titre informatif (`BudgetCT.cout_mo_eur`).

4. **Refonte visuelle** (2026-10-05) : le front suit le guide `docs/STYLE.md` (HIG Apple transposées au web, adapté du guide Nornir). **Mantine et `@tabler/icons-react` sont retirés** au profit d'un kit maison `src/ui/` (CSS natif + tokens, thème Automatique / Clair / Sombre). Les flags et statuts n'utilisent plus d'emoji : glyphes dont la forme porte le sens, couleurs à sens unique (vert conforme, orange hors plan, rouge sur-imputation, violet sous-imputation, gris absence).
5. **Règle SPEC §8 r3 supprimée** (2026-10-05) : la liste des pourcentages autorisés {20,30,40,50,70,80,100} n'est plus contrôlée (60 % y manquait) ; toute valeur numérique est acceptée sans warn.
6. **NOM Prénom** (2026-10-05) : le plan affiche « NOM Prénom » extrait du Libellé (SPEC §8 règles 9–11) à la place du libellé brut ; le référentiel Personnes adopte ce format (fiches brouillon renommées au réimport, fiches validées intactes ; l'alias d'import garde la forme brute). Le code Ressource doit valoir NOM + initiale du prénom : sinon warn, code conservé. Démo : 30 ok, 6 warn (réserves sans libellé l. 50/51/52/55, « PO », « RTE »).
7. **Ergonomie « contrôleur de gestion »** (2026-10-05) : navigation en barre latérale (Pilotage : Vue d'ensemble, Anomalies, Écarts, Budget, Prévisions · Données : Plan de charge, Réalisé, Personnes, Squads · Réglages) ; gabarit de page unique (barre d'outils, inspecteur, filtres en popover) ; règles de densité (≤ 6 colonnes, une ligne par cellule, ≤ 3 chiffres clés). Prévisions = réalisé à date + reste à faire du plan, avec projection « tendance » sur 4 semaines ; budget de référence = Σ PPS. Anomalies traitables (traitée / ignorée + commentaire, table `anomalie_suivi`), réouvertes si leurs chiffres changent. Plan de charge : colonnes Unité, Statut, Ligne de coût et Libellé retirées, Ressource = « CODE (NOM Prénom) », ligne en anomalie teintée avec un glyphe.
8. **Identité = NOM + Prénom uniquement** (2026-10-06) : une ressource est identifiée par son seul NOM + Prénom, dans le plan (extrait du Libellé) comme dans le réalisé (EMPLOYE/FOURNISSEUR `<NOM Prénom Civilité>`, civilité finale M./Mr./Mme./Mlle.… retirée). Clé `names.Key` = `NOM|PRÉNOM` en majuscules sans accents ni ponctuation, **ordre conservé**, égalité stricte (« CLAIRE DURAND » ≠ « DURAND Claire »). Supprimés : code Ressource comme identifiant (règle 11, départage par le code, règle « ressource vide », classification du code), matricules (`personne_matricules`), alias (`personne_alias`), fusion de fiches, confiances `matricule`/`alias`/`fuzzy`, contrôle qualité « fuzzy », catégorie d'anomalie `correspondance`. Nom tout en majuscules → dernier mot = prénom. Ligne de plan sans NOM Prénom → **non nominative** : warn à l'import, conservée au budget, sans personne, jamais rapprochée. `personnes.nom_normalise` = clé, unique. Base existante migrée au démarrage (`PRAGMA user_version` 1) : nom_prenom recalculé, fiches illisibles supprimées, homonymes fusionnés dans la plus ancienne, lignes rattachées par clé ; statuts de parsing inchangés jusqu'au réimport.
9. **Synthèse des imputations** (2026-10-06) : en tête de la page Écarts, anneau des **heures** par flag — excédent (réel − prévu) des sur-imputations, manque (prévu − réel) des sous-imputations, réel hors plan, réel conforme — et chiffre « Jamais imputé » = personnes (lignes nominatives) planifiées sans aucune heure sur la période analysée (règle ⚫ Absence), sur le nombre de personnes planifiées. Suit les filtres de la page sauf le flag ; un clic sur une part filtre le tableau. `KPIs.nb_personnes_planifiees` / `nb_personnes_absentes` ne comptent plus les lignes non nominatives.
8. **Version courante par défaut** (2026-10-05) : Plan de charge et Réalisé ouvrent directement la version active (sinon la plus récente non purgée) ; le titre de la barre d'outils est un menu « Historique » pour changer de version, importer ou gérer les versions (`/…/versions`).

## Format démo — Plan de charge
- Onglet `Style par défaut`, en-tête ligne 3, 16 colonnes (12 de la spec + `Quantité affectée`, `Taux fixe`, `Depuis`, `Pendant`). Les colonnes en plus ne font pas échouer le contrôle d'en-tête : la règle « 12 colonnes conformes » = les 12 colonnes attendues présentes **dans l'ordre** en tête de ligne.
- Lignes ignorées (non comptées) : lignes vides, **lignes de groupe** (seule la 1re cellule remplie, ex. `Squad Alpha — Plateforme`), **lignes `Somme`**.
- **Squads imbriqués** : un groupe est suivi de sa ligne `Somme` (charge totale du groupe). Pile de groupes ouverts ; chaque ligne de données ajoute sa charge à tous les groupes ouverts ; un groupe se ferme quand son cumul atteint sa `Somme` (±0.01). Squad de la ligne = groupe ouvert le plus interne ; `groupe` = chemin `Parent > Enfant`. Squads créés avec `parent_id`. Sans `Somme` : le dernier groupe rencontré.
- CT de 9 **ou 10** caractères acceptés (`Y99F900010`).
- Ressource : `[inactif]` → strip + `inactive` ; le code est conservé brut, sans classification ni contrôle (décision n° 8).

- **Pourcentage** : pas de contrôle de valeur (voir « Validé par l'utilisateur » n° 5). Seul un pourcentage non numérique reste en warn. Sur la démo (fichier du 2026-10-06) : 31 ok, 5 warn (lignes non nominatives 50, 51, 53 « PO », 54 « RTE », 55), 25 personnes ; deux lignes non nominatives sans libellé ne sont jamais doublons entre elles.
- **Alias de squad** issus des libellés (`… / Squad Alpha`) : rattachés au groupe du chemin dont le nom contient tous les tokens de l'alias (sinon groupe le plus interne) → « Squad Alpha » → « Squad Alpha — Plateforme », « Cellule Qualité » → « Cellule Transverse Qualité ».
- Layout B : les colonnes démo additionnelles ne sont pas lues (position ambiguë avec la colonne poubelle).
- PPS vide/non numérique → warn (0) ; charge non numérique → drop ; pourcentage non numérique → warn.
- Les lignes drop sont stockées (consultables, filtre `statut=drop`) mais ne créent pas de personne ; l'analyse les exclut.
- Preview : l'enrichissement des référentiels est simulé dans une transaction annulée (résultat exact de ce que créerait l'import).
- Référentiels : plus d'alias personne ni de fusion (décision n° 8) ; le nom d'une fiche n'est pas modifiable (PATCH `display_name` → 400).

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
- Valeurs `-` → vide partout. Avoirs négatifs conservés (démo : 20 montants négatifs).
- Liste des TYPE reconnus = énuméré §3 + types de la classification budgétaire (`FRAIS ACHATS CAPACITE SUR SITE`, `PROVISIONS POUR ALEAS`, `Stockage`).
- Lignes drop stockées (consultables) ; `montant_total_eur` = Σ ok + warn. Doublons : 1re occurrence ok, suivantes warn.
- Démo : 482 écritures, 0 warn, 0 drop, 403 130,43 €.

## Analyse — interprétations
- **⚫ Absence** : tuple `réel = 0 ∧ prévu > 0` **et** la personne a `Σ réel = 0` sur toute la période analysée (§9). Sinon le tuple est évalué par l'écart.
- **Calendrier** : jours ouvrés = lun–ven ∩ [date_début, date_fin] de la ligne − `jours_feries` ; semaines ISO dont le numéro ∈ `semaines_verrouillees` → 0 jour. `charge_hebdo = charge_totale × jo(ligne ∩ semaine) / jo(ligne)`. Le tableau §4.1 de la spec n'est pas codé en dur (année différente, incohérent). Contrôle §4.2 : Σ hebdo vs charge_totale (±0.5 h) — l'écart vient des semaines verrouillées / lignes sans jour ouvré → warn qualité `plan_repartition`.
- **Période d'analyse** en semaines ISO `YYYY-Www` ; défaut = semaines communes au plan (date_début min → date_fin max) et au réalisé (date_dépense min → max).
- **Correspondance** (remplacée par la décision n° 8) : écriture MO dont `names.Key` (NOM + Prénom sans civilité) existe dans le plan retenu → `nom` ; sinon `none` → 🟠 Hors plan.
- **Jointure** `(ct, personne_id, semaine)`. Personne résolue mais non planifiée sur ce CT → prévu 0. Réel sur semaine verrouillée → 🟠.
- **Ressource** d'un tuple : code ressource PDC de la personne (sinon nom réalisé).
- **Taux de conformité** : `nb 🟢 / nb tuples comparés` où tuples comparés = tuples hors 🟠, en excluant les ressources `inactive` sauf `include_inactive`.
- **Dérive de provision** : écritures non rattachées (`none`) sur un CT dont le plan porte une ligne `PROVISIONS POUR ALEAS`, ou de TYPE `PROVISIONS POUR ALEAS`.
- **Qualité §10.1** : |Σ € réalisé par TG − Σ PPS plan du CT| > `seuil_ecart_tg_eur` → warn.

- **Lignes de plan comparées** : seules celles dont la `ligne_cout` ∈ `mo_types` sont dépliées en heures prévues (frais de mission, provisions, stockage, achats exclus de la comparaison ; ils restent dans le PPS).
- **Contre-passations** : toutes les écritures MO avec heures ≠ 0 sont appariées (les heures négatives diminuent le réel).
- **Portée de la période** : tableau d'écarts, KPI heures, correspondances, règles fuzzy / 200 h / MO sans nom → période choisie. Budget, alertes (dont dérive de provision), règles 1, 4, 5 → toute la version de réalisé.
- Semaines verrouillées : 0 jour au dénominateur (la charge est répartie sur les autres semaines) ; le contrôle ±0.5 h ne se déclenche donc que pour une ligne sans jour ouvré / dates invalides.
- Périodes plan/réalisé disjointes → période par défaut = union + warn `periode_disjointe`.
- Homonymes : la personne planifiée l'emporte si elle est seule, sinon ambigu → stratégie suivante.
- Confiance d'un tuple = la plus faible de ses écritures ; tuple sans réel = `plan`. Prévu/réel arrondis à 0,01 h avant flags.
- Inactifs : exclus uniquement du taux de conformité (comptés dans flags, points, taux d'absence).
- Règle 1 : CT présents dans les deux sources, Σ TOTAL EN € brut (MO comprise) vs Σ PPS. `DeriveProvision.eur` = TOTAL EN € brut.
- Export réalisé enrichi : filtré par semaines seulement si fournies ; ne requiert pas de plan.
- Erreurs analyse : version purgée → 409, id inconnu → 404, semaine invalide → 400.

## À arbitrer
_(vide)_
