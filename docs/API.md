# API Njord — contrat

Préfixe `/api`, JSON **snake_case**. Types : `backend/internal/domain/domain.go` = `frontend/src/api/types.ts` (miroirs). Client front : `frontend/src/api/client.ts` (fait foi pour les noms de paramètres).

- Dates `YYYY-MM-DD` (`""` = absente), horodatages RFC 3339 UTC.
- Erreurs : `{"error": {"code": "...", "message": "..."}}` via `httpx.Error` — 400 `bad_request`, 404 `not_found`, 409 `precondition` (refus métier : purge trop tôt, confirmation invalide…), 422 erreur bloquante d'import (`sheet_not_found`, `header_invalid`, `file_invalid`), 500 `internal`.
- Pas d'authentification : `operateur`/`importeur` = texte libre optionnel (champ de formulaire/JSON, sinon header `X-User`, sinon `"local"`) → `httpx.Operateur`.
- CSV : `;` séparateur, UTF-8 avec BOM → `httpx.CSV`.

## Commun (`internal/core`, fait)

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` |
| GET / PUT | `/settings` | `Settings` |
| GET | `/audit?objet_type=&limit=` | `AuditEntry[]` (récents d'abord) |

## Plan de charge (`internal/plan`), Réalisé (`internal/realise`) et Provisions (`internal/provision`) — symétriques, `{kind}` = `plan` | `realise` | `provision`

| Méthode | Chemin | Entrée | Réponse |
|---|---|---|---|
| POST | `/{kind}/imports/preview` | multipart `file`, `intitule?` | `ImportReport` (rien n'est écrit ; `nouvelles_personnes`/`nouveaux_squads` = ce qui serait créé ; plan : `date_effet_proposee` = `periode_debut`) |
| POST | `/{kind}/imports` | multipart `file`, `intitule?`, `importeur?`, `archive_active` (`true` défaut), plan : `date_effet?` (`YYYY-MM-DD`, défaut `periode_debut`, invalide → 400) | 201 `ImportResult` |
| PATCH | `/plan/versions/:id` | JSON `{date_effet, operateur?}` | `Version` — `store.SetDateEffet` (400 format invalide, 404 inconnue, 409 purgée ; audit `date_effet`) |
| GET | `/{kind}/versions?include_purged=false` | | `Version[]` (actives, archivées, purgées) — `store.ListVersions` |
| GET | `/{kind}/versions/:id` | | `Version` |
| POST | `/{kind}/versions/:id/archive` | JSON `{operateur?}` | `Version` — `store.Archive` |
| POST | `/{kind}/versions/:id/reactivate` | JSON `{operateur?}` | `Version` — `store.Reactivate` |
| POST | `/{kind}/versions/:id/purge` | JSON `{confirm_intitule, operateur?}` | `Version` — `store.Purge` (409 si conditions non remplies) |
| GET | `/{kind}/versions/:id/facets` | | `Facets` (valeurs distinctes des colonnes filtrables) |

`intitule` absent → nom du fichier sans extension. Erreur bloquante (onglet/en-tête) → 422, aucune écriture. Version/lignes créées via `store.CreateVersion(ctx, &v, archiveActive, fill)`.

### Plan : lignes
`GET /plan/compare?from=<id>&to=<id>` → `PlanCompare` (DECISIONS n° 12) : `{from, to, totaux{pps_from, pps_to, charge_from, charge_to, nb_ct_from, nb_ct_to, nb_personnes_from, nb_personnes_to}, par_ct[{ct, groupe, pps_from, pps_to, charge_from, charge_to, statut}], par_personne[{nom_prenom, …même champs}]}` ; `statut` ∈ `ajoute|retire|modifie|inchange`. Défauts (DECISIONS n° 13) : `to` = dernière version de la timeline (date d'effet, puis import), `from` = celle qui la précède dans la timeline (dernière de date d'effet antérieure, sinon celle qu'un réimport à même date remplace, sinon la suivante). Lignes `drop` exclues. 404 version inconnue/purgée ; 409 `precondition` si `from` = `to` ou moins de deux versions. Tri `par_ct` : |Δ PPS| desc puis CT ; `par_personne` : |Δ charge| desc puis nom.

`GET /plan/versions/:id/lines` → `PlanLinesPage` ; `GET /plan/versions/:id/lines.csv` (mêmes filtres, sans pagination ; colonne `nom_prenom` après `libelle`). **Identité = NOM + Prénom uniquement** (DECISIONS n° 8) : `PlanLine.nom_prenom` = « NOM Prénom » extrait du libellé ; `""` = ligne **non nominative** (warn à l'import, comptée au budget, jamais rapprochée du réalisé). `PlanLine.ressource` = code brut du fichier, conservé pour l'export CSV, n'identifie personne ; `ressource_kind` n'est plus exposé.
Filtres : `ct`, `nom_prenom`, `ligne_cout`, `statut` (ok|warn|drop), `inactive` (bool), `squad_id`, `date_from`/`date_to` (chevauchement avec [date_debut, date_fin]), `q` (plein-texte sur libellé/nom_prenom/CT, insensible casse/accents), `sort` (`row_num`|`ct`|`nom_prenom`|`charge_totale`|`pps`|`date_debut`), `order`, `limit`, `offset`. `totals` = Σ sur **tout** le filtre courant (pas seulement la page). Facets : `ct`, `nom_prenom`, `ligne_cout`, `squad_id` (valeur = id ; libellé via `/squads`), `statut`.

### Provisions : lignes (DECISIONS n° 16)
Format : export Planisware « Dépenses prévues » (onglet préféré `Provisions`, sinon `Style par défaut` ou tout onglet ; en-tête dans les 20 premières lignes : `Tâche ou sous-projet | Libellé | Quantité | Unité | Ligne de coût | Type de dépense | Date de début | Date de fin | Calcul de la durée | Depuis | Pendant | .PPS`, repéré par `quantite`, `ligne de cout`, `type de depense`, `pps`). Lignes de groupe (seule la colonne A remplie) et `Somme` (total en colonne C) comme le plan démo ; `groupe` = chemin des groupes. `ct` = colonne A (TrimSpace) ; `montant` = `.PPS`, à défaut `Quantité`. Drop : CT vide, montant non numérique ; warn : unité ≠ `EURO`, date illisible, doublon (CT, libellé, ligne de coût, date, montant). `source_format = "provisions"`, `Version.montant_total_eur` / `ImportReport.montant_total_eur` = Σ montants acceptés ; `periode_debut/fin` = min/max des dates. Un fichier de plan importé comme provisions (et réciproquement) → 422 `header_invalid`.
`GET /provision/versions/:id/lines` → `ProvisionLinesPage` ; `GET /provision/versions/:id/lines.csv` (mêmes filtres, sans pagination). Filtres : `ct`, `ligne_cout`, `groupe`, `statut`, `q` (CT, libellé, groupe ; insensible casse/accents), `sort` (`row_num`|`ct`|`montant`|`date_debut`), `order`, `limit`, `offset`. `totals.montant` = Σ sur tout le filtre courant. Facets : `ct`, `ligne_cout`, `groupe`, `statut`.

### Réalisé : écritures
`GET /realise/versions/:id/entries` → `RealiseEntriesPage` ; `GET /realise/versions/:id/entries.csv` (colonne `NOM PRENOM` après `EMPLOYE/FOURNISSEUR`).
`RealiseEntry.nom_prenom` = « NOM Prénom » d'EMPLOYE/FOURNISSEUR (`<NOM Prénom Civilité>`) après retrait de la civilité finale (M., Mr., Mme., Mlle.…) ; `""` si non identifiable. C'est la seule clé de rapprochement avec le plan ; `matricule` reste une donnée brute.
Filtres : `entite`, `activite`, `trigramme`, `tg`, `wp`, `categorie`, `type`, `lot`, `statut`, `date_from`/`date_to` (sur date_depense), `montant_min`/`montant_max` (total_eur), `q` (TG, TG-libellé, nom_prenom, + description si `search_description=true`), `mask_sensitive` (bool : vide `employe_fournisseur`, `nom_prenom`, `matricule`, `num_facture`, `num_commande`, `description_depenses`, `nom_ressource`, `fournisseur`), `sort` (`date_depense`|`total_eur`|`tg`|`row_num`), `order`, `limit`, `offset`. `totals` = Σ quantité, Σ €, nb lignes par catégorie sur le filtre courant.

## Référentiels (`internal/referentiel`)

`Personne` = `{id, display_name (« NOM Prénom »), nom_normalise (clé names.Key, ex. « DE LA TOUR|ANTOINE », unique), statut, squad_id, created_at}`. Plus de matricules, d'alias ni de fusion : deux fiches ne peuvent pas porter le même NOM + Prénom.

| Méthode | Chemin | Entrée | Réponse |
|---|---|---|---|
| GET | `/personnes?q=` | | `Personne[]` (`q` sur le nom) |
| GET / PATCH | `/personnes/:id` | `{statut?, squad_id?}` (le nom est l'identité : non modifiable, `display_name` → 400) | `Personne` |
| GET / POST | `/squads` | `{nom_canonique, entite_rattachee?, parent_id?}` | `Squad[]` / `Squad` |
| PATCH | `/squads/:id` | `{nom_canonique?, entite_rattachee?, parent_id?}` | `Squad` |
| POST | `/squads/:id/alias` | `{alias}` | `Squad` |

## Enveloppes (`internal/enveloppe`, DECISIONS n° 18 et 27)

Saisies dans l'interface, une par CT (plus d'import de fichier). Les enveloppes importées avant le n° 27 sont conservées.

`EnveloppeCT` = `{ct, ct_libelle, categorie, categorie_libelle, sources{plan, realise, provisions}, enveloppe}` ; `enveloppe` = `{date_debut, date_fin, montant}` ou `null` (« sans enveloppe »). `categorie_libelle` = libellé libre de la catégorie (`''` = hors catégorie) ; `categorie` = code hérité de l'ancien import (…00), `''` sinon. CT = union des lignes non rejetées des versions de plan non purgées, des écritures du réalisé actif, des lignes des provisions actives et des CT ayant une enveloppe. Libellé : `tg_libelle` du réalisé (préfixe CT retiré), sinon dernier segment du groupe des provisions, sinon groupe du plan.

| Méthode | Chemin | Entrée | Réponse |
|---|---|---|---|
| GET | `/enveloppes` | | `{cts: EnveloppeCT[]}` ; triés par libellé de catégorie puis CT, hors catégorie puis sans enveloppe en dernier |
| PUT | `/enveloppes/:ct` | `EnveloppeInput` `{date_debut, date_fin, montant, categorie, operateur?}` | `EnveloppeCT` du CT ; crée ou remplace l'enveloppe ; `categorie` (libellé) stocké dans `categorie_libelle`, code repris d'une enveloppe de même libellé sinon `''` ; audit `create` ou `update` / `enveloppe` (`objet_id` = CT, `details` = champs modifiés, jamais de montant) |
| DELETE | `/enveloppes/:ct?operateur=` | | 204 ; audit `delete` / `enveloppe` ; 404 si le CT n'a pas d'enveloppe |

Erreurs : 400 `bad_request` si une date n'est pas `YYYY-MM-DD`, si `date_fin` < `date_debut`, si `montant` est absent, négatif ou non fini, ou si le CT est vide.

## Analyse (`internal/analyse`)

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/analyse/context` | `AnalyseContext` (`default_plan_id` = version active, sinon la plus récente non purgée ; `default_provision_id` = version de provisions active, sinon null ; période par défaut = timeline ∩ réalisé ; `weeks[].couverture`) |
| GET | `/analyse?plan_version_id=&realise_version_id=&provision_version_id=&week_from=2026-W36&week_to=2026-W40&include_inactive=false` | `AnalyseResult` (paramètres absents → défauts du contexte). 409 `precondition` si aucun plan (non purgé ou choisi) ou aucun réalisé ; les provisions sont facultatives (aucune version → `meta.provision_version = null`, budget = Σ PPS ; id inconnu ou purgé → 404) |
| GET | `/analyse/previsions?<mêmes params>&annee=2026` | `Previsions` coupées à l'année ISO `annee` (DECISIONS n° 24) ; `annee` absente ou 0 = Tout (= `AnalyseResult.previsions`) ; 400 si `annee` n'est pas un entier |
| GET | `/analyse/plan-timeline?plan_version_id=` | `PlanTimeline` `{plan_version, windows, segments}` (mêmes règles de version que `/analyse`) |
| GET | `/analyse/plan-timeline.csv?plan_version_id=` | segments : Ressource, CT, Libellé CT, Squad, Ligne de coût, %, Début, Fin, Charge (h), PPS, Version |
| GET | `/analyse/ecarts.csv` | mêmes params + filtres `ct`, `ressource`, `flag`, `squad_id`, `masquer_traites` (DECISIONS n° 26 : sans les tuples dont toutes les anomalies sont traitées / ignorées) ; dernière colonne « CT liés » (erreur de CT) |
| GET | `/analyse/realise-enrichi.csv` | mêmes params + `mask_sensitive` : écritures + `iso_week`, `heures`, `eur` (plus de `classification`, DECISIONS n° 23) |
| PUT | `/analyse/anomalies/suivi` | `AnomalieSuiviInput` `{key, fingerprint, statut: traitee\|ignoree, commentaire, operateur?}` → `AnomalieSuivi` (upsert ; audit `anomalie.traitee` / `anomalie.ignoree`) |
| DELETE | `/analyse/anomalies/suivi?key=` | rouvre l'anomalie (supprime le suivi ; audit `anomalie.rouverte`) → 204 |

**Timeline du plan** (DECISIONS n° 13) : `plan_version_id` ne désigne plus « la » version croisée mais **la timeline connue à la date de cette version** = toutes les versions de plan non purgées importées au plus tard avec elle (`importee_le ≤`). Triées par `(date_effet, importee_le)`, chacune fait référence sur `[date_effet, min(date_effet suivante − 1 j, periode_fin)]` (fenêtre vide si un import plus récent a la même date d'effet). Chaque ligne non rejetée est coupée à la fenêtre de sa version (charge et PPS × jours ouvrés coupés ÷ jours ouvrés de la ligne). Hors fenêtres = **non couvert** : les écritures réalisées de ces jours ne produisent ni `EcartRow` ni anomalie, leurs heures MO de la période vont dans `kpis.heures_non_couvertes` ; `WeekInfo.couverture` / `PrevisionPoint.couverture` ∈ `totale|partielle|aucune` (jours ouvrés de la semaine couverts) ; `meta.timeline` liste les fenêtres ; `EcartRow.plan_version_id` = version qui régit la semaine. `meta.archived_warning` = plan choisi ≠ dernière version, ou réalisé archivé. Budget (Σ PPS), prévisions, natures et règle qualité 1 portent sur les segments.

**Prévisions** (`AnalyseResult.previsions`, SPEC_analyse §7.7, DECISIONS n° 19 et 20) : `as_of` = dernière date de dépense du réalisé. **Le budget d'un CT est le montant de son enveloppe importée, rien d'autre.** Par CT : `pps` (Σ PPS des segments) et `provisions` (Σ provisions de la version retenue) sont informatifs ; `consomme` = Σ TOTAL EN € brut (MO comprise) ; `rythme_hebdo` = moyenne € des 4 dernières semaines réalisées ; `series` hebdomadaires cumulées (`budget_cumul` = dépense prévue cumulée du plan seul, `reel_cumul` jusqu'à `as_of`, `plan_cumul`/`tendance_cumul` à partir de `as_of`, `heures_plan`, `heures_reel`).

- **CT avec enveloppe** (`budget_source = "enveloppe"`) : `budget` = `budget_echeance` = `enveloppe.montant`, `echeance` = `enveloppe.date_fin` ; tout le prévisionnel porte sur la période [WD, WE] (semaines ISO de `date_debut` et `date_fin`, incluses entières) : `consomme` = € datés dans [date_debut, date_fin] + écritures sans date, `consomme_hors_enveloppe` = € datés hors période ; `reste_a_faire` = prévu des semaines ]as_of, WE] ∩ ≥ WD ; `plan_hors_enveloppe` = prévu des semaines < WD ou > WE + PPS hors série ; `atterrissage_plan` = `projection_plan_echeance` = consommé + reste ; `atterrissage_tendance` = `projection_tendance_echeance` = consommé + rythme (4 dernières semaines du réel de la période) × semaines ]as_of, WE] (`semaines_restantes` = `semaines_echeance`) ; `ecart_plan`/`ecart_tendance` = atterrissage − budget ; `pct_consomme` = consommé ÷ budget ; `statut` = `depassement` si atterrissage plan > budget, `vigilance` si atterrissage tendance > budget ou atterrissage plan > 95 %, `ok` sinon ; `non_consomme` = max(0, budget − atterrissage plan) : plan de charge seul, la tendance n'entre jamais dans un non-consommé (DECISIONS n° 21) ; une semaine que le plan ne couvre pas contribue 0 au prévu ; `rythme_necessaire` = (budget − consommé) ÷ semaines_echeance ; `sous_consommation` = non_consomme > `seuil_sous_conso_pct` % du budget **et** > `seuil_sous_conso_eur` ; **`cible_min`** = budget − max(`seuil_sous_conso_pct` % × budget, `seuil_sous_conso_eur`), plancher 0 (zone cible [cible_min, budget]) ; `series` sur la période seule (0 avant WD, plates après WE). Une enveloppe aux dates illisibles ou inversées est ignorée (CT sans enveloppe).
- **CT sans enveloppe** (`budget_source = "aucun"`) : `budget`, `statut`, `ecart_plan`, `ecart_tendance`, `pct_consomme`, `budget_echeance`, `non_consomme`, `rythme_necessaire`, `cible_min`, `enveloppe` = null ; `echeance` = "" ; `sous_consommation` = false ; `projection_*_echeance` = 0. Horizon = tout le plan : `reste_a_faire` = PPS des semaines > `as_of`, `atterrissage_plan` = consommé + reste, `atterrissage_tendance` = consommé + rythme × semaines restantes jusqu'à `fin_plan`.
- **Global** (`ct = ""`) = **périmètre des CT avec enveloppe**, chacun sur son budget et son horizon : budget, consommé, reste, atterrissages, projections, non consommé et séries = sommes de ces CT ; `echeance` = la plus tardive de leurs `date_fin` ; `statut`, écarts, `pct_consomme`, `sous_consommation` et `cible_min` = mêmes formules sur les sommes ; `budget_source` = `enveloppe`, ou `aucun` (champs de budget null, séries vides) si aucun CT n'a d'enveloppe. L'axe des séries couvre l'union des périodes.
- **Provisions sécurisées** (DECISIONS n° 23) : `provisions_aleas` = Σ provisions de ligne de coût `PROVISIONS POUR ALEAS` (jamais dans l'atterrissage) ; `provisions_securisees` = Σ des autres, comptées si datées (date de début, sinon de fin) dans la période de l'enveloppe ou sans date (sans enveloppe : toutes) ; `provisions_hors_enveloppe` = sécurisées datées hors période. **`atterrissage_plan` = `projection_plan_echeance` = consommé + `reste_a_faire` + `provisions_securisees`** (atterrissage sécurisé) : `ecart_plan`, `statut`, `non_consomme`, `sous_consommation` en découlent. `plan_cumul` ajoute chaque provision sécurisée comptée dans sa semaine (sans date : semaine de l'échéance, sinon dernière semaine de l'axe).
- **ETP** (DECISIONS n° 25) : `series[].etp` = Σ `pourcentage`/100 des segments MO (ligne de coût ∈ `mo_types`) × jours ouvrés (segment ∩ semaine) ÷ jours ouvrés de la semaine (0 sans jour ouvré) ; global = Σ des CT du périmètre.
- **Année** (DECISIONS n° 24) : `annee` = 0 (Tout) dans `AnalyseResult.previsions` ; `annees` = années proposées (année d'`as_of` → année de la fin d'enveloppe la plus tardive, `[]` sans enveloppe). Avec `annee` = N (`/analyse/previsions`) : chaque enveloppe recoupant les semaines ISO de N est coupée à ces semaines (`enveloppe` = tranche, `montant` au prorata des jours calendaires), consommé = € datés dans la tranche (+ sans date au prorata), plan et provisions sécurisées de la tranche (sans date : au prorata) ; mêmes formules ensuite ; CT sans tranche hors du périmètre ; `hors_enveloppe` limité aux semaines de N ; séries sur les semaines de N, cumulées depuis 0.
- `previsions.hors_enveloppe` = `{nb_ct, consomme, atterrissage_plan, atterrissage_tendance}` des CT sans enveloppe (hors du global).
- `previsions.enveloppes` = `{nb_ct, nb_configures, montant, atterrissage, ecart, depassement, nb_depassement, non_consomme, nb_sous_consommation, plan_hors_enveloppe}` sur les CT avec enveloppe de `par_ct` (lecture brute, sans compensation : `depassement` = Σ `ecart_plan` des seuls CT au statut `depassement`, d'où `depassement > 0 ⇔ nb_depassement > 0` (DECISIONS n° 22) ; `non_consomme` = Σ non consommés CT par CT (DECISIONS n° 21)).
- Tri de `par_ct` : statut (dépassement d'abord), puis `ecart_plan` décroissant ; CT sans enveloppe en dernier (atterrissage plan décroissant).
- Règle qualité `tg_ecart_budget` : seulement pour les CT avec enveloppe (référence = montant). Anomalies `budget` (`budget|CT`, `budget_sous_conso|CT`) : seulement pour les CT avec enveloppe.

**Anomalies** (`AnalyseResult.anomalies`, SPEC_analyse §7.8) : catégories `ecart` (regroupé ressource × CT × flag sur la période, hors conformes), `ct_risque`, `derive`, `qualite`, `budget` (statut prévision ≠ ok). `key` stable, `fingerprint` = empreinte des chiffres ; `statut` = `a_traiter` sauf suivi enregistré de même empreinte (`traitee`/`ignoree`) ; empreinte différente → `a_traiter` + `suivi.obsolete = true`. Tri : gravité desc, catégorie, montant/heures desc.

**Erreur de CT** (DECISIONS n° 14, SPEC_analyse §6.2) : `flag` ∈ `absence | hors_plan | erreur_ct | sur_imputation | sous_imputation | conforme` (gravité dans cet ordre). `EcartRow.reaffecte` = heures réaffectées entre le tuple et `EcartRow.cts_lies` (même personne × semaine ; 0 et `[]` sinon, jamais null) : tuple à `prevu = 0` = CT imputé à tort, `cts_lies` = CT planifiés en manque ; sinon l'inverse. Renseignés aussi sur un tuple resté sur/sous-imputé (cas partiel). KPI `nb_erreur_ct`, `points_erreur_ct` (inclus dans `points_total`), `heures_erreur_ct`. `EcartRow.anomalies` (DECISIONS n° 26) = clés des anomalies qui citent le tuple, triées, jamais null. Anomalie `ecart` unique par ressource × CT imputé à tort : `key` = `ecart|<CT imputé>|<ressource>|erreur_ct`, `flag` = `erreur_ct`, `heures` = Σ réaffecté, `lien` = `/ecarts?ressource=…&flag=erreur_ct`.

**Analyse par nature** (`AnalyseResult.budget.par_nature`, DECISIONS n° 10 et 20) : 5 lignes fixes `{nature: provision|mo|capacite|frais|autres, libelle, pps, provisions, prevu, realise, pct_consomme}` (`prevu` = pps + provisions : dépense prévue, pas un budget ; `pct_consomme` = realise ÷ prevu) ; `pps` = Σ PPS du plan, `provisions` = Σ provisions importées ventilées selon leur ligne de coût (même classifieur), `realise` = Σ TOTAL EN € de toute la version (avoirs compris) ; Σ `realise` = `consomme` de tous les CT. `BudgetCT` : `pps_plan`, `provisions` (plus de `charge_max`). Classification (DECISIONS n° 23) : `securise` = `reste_a_faire` + `provisions_securisees` de la prévision « Tout », `non_securise` = `provisions_aleas`, `pct_securite` = sécurisé ÷ (sécurisé + non sécurisé) ; `risque` = non sécurisé > `seuil_ct_risque_eur` ; `budget.global` = sommes ; `alertes.alerte_globale` = `pct_non_securise` > `seuil_non_securise_pct`. Plus de `non_classe`.

**Correspondances** (`AnalyseResult.correspondances`) : une par nom réalisé des écritures MO, `{nom_realise, nom_prenom, personne_id, personne_nom, confidence, nb_ecritures, heures}`. `confidence` = `nom` (clé NOM + Prénom présente au plan) ou `none` (hors plan). `EcartRow.confidence` ∈ `nom | none | plan`. `EcartRow.ressource` = « NOM Prénom » (libellé pour une ligne non nominative). Plus de contrôle qualité « fuzzy » ni de réglage `seuil_fuzzy_count`.
