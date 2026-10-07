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

## Plan de charge (`internal/plan`) et Réalisé (`internal/realise`) — symétriques, `{kind}` = `plan` | `realise`

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

## Analyse (`internal/analyse`)

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/analyse/context` | `AnalyseContext` (`default_plan_id` = version active, sinon la plus récente non purgée ; période par défaut = timeline ∩ réalisé ; `weeks[].couverture`) |
| GET | `/analyse?plan_version_id=&realise_version_id=&week_from=2026-W36&week_to=2026-W40&include_inactive=false` | `AnalyseResult` (paramètres absents → défauts du contexte). 409 `precondition` si aucun plan (non purgé ou choisi) ou aucun réalisé |
| GET | `/analyse/plan-timeline?plan_version_id=` | `PlanTimeline` `{plan_version, windows, segments}` (mêmes règles de version que `/analyse`) |
| GET | `/analyse/plan-timeline.csv?plan_version_id=` | segments : Ressource, CT, Libellé CT, Squad, Ligne de coût, %, Début, Fin, Charge (h), PPS, Version |
| GET | `/analyse/ecarts.csv` | mêmes params + filtres `ct`, `ressource`, `flag`, `squad_id` |
| GET | `/analyse/realise-enrichi.csv` | mêmes params + `mask_sensitive` : écritures + `iso_week`, `heures`, `eur`, `classification` |
| PUT | `/analyse/anomalies/suivi` | `AnomalieSuiviInput` `{key, fingerprint, statut: traitee\|ignoree, commentaire, operateur?}` → `AnomalieSuivi` (upsert ; audit `anomalie.traitee` / `anomalie.ignoree`) |
| DELETE | `/analyse/anomalies/suivi?key=` | rouvre l'anomalie (supprime le suivi ; audit `anomalie.rouverte`) → 204 |

**Timeline du plan** (DECISIONS n° 13) : `plan_version_id` ne désigne plus « la » version croisée mais **la timeline connue à la date de cette version** = toutes les versions de plan non purgées importées au plus tard avec elle (`importee_le ≤`). Triées par `(date_effet, importee_le)`, chacune fait référence sur `[date_effet, min(date_effet suivante − 1 j, periode_fin)]` (fenêtre vide si un import plus récent a la même date d'effet). Chaque ligne non rejetée est coupée à la fenêtre de sa version (charge et PPS × jours ouvrés coupés ÷ jours ouvrés de la ligne). Hors fenêtres = **non couvert** : les écritures réalisées de ces jours ne produisent ni `EcartRow` ni anomalie, leurs heures MO de la période vont dans `kpis.heures_non_couvertes` ; `WeekInfo.couverture` / `PrevisionPoint.couverture` ∈ `totale|partielle|aucune` (jours ouvrés de la semaine couverts) ; `meta.timeline` liste les fenêtres ; `EcartRow.plan_version_id` = version qui régit la semaine. `meta.archived_warning` = plan choisi ≠ dernière version, ou réalisé archivé. Budget (Σ PPS), prévisions, natures et règle qualité 1 portent sur les segments.

**Prévisions** (`AnalyseResult.previsions`, SPEC_analyse §7.7) : horizon = tout le plan (indépendant de `week_from/to`). `as_of` = dernière date de dépense du réalisé. Par CT et global : `budget` = Σ PPS, `consomme` = Σ TOTAL EN € brut (MO comprise), `reste_a_faire` = PPS des semaines > `as_of` (prorata des heures réparties en jours ouvrés), `atterrissage_plan` = consommé + reste à faire, `atterrissage_tendance` = consommé + moyenne € des 4 dernières semaines × semaines restantes, `statut` ok/vigilance/depassement, `series` hebdomadaires cumulées (`budget_cumul`, `reel_cumul` jusqu'à `as_of`, `plan_cumul`/`tendance_cumul` à partir de `as_of`, `heures_plan`, `heures_reel`).

**Anomalies** (`AnalyseResult.anomalies`, SPEC_analyse §7.8) : catégories `ecart` (regroupé ressource × CT × flag sur la période, hors conformes), `ct_risque`, `derive`, `qualite`, `budget` (statut prévision ≠ ok). `key` stable, `fingerprint` = empreinte des chiffres ; `statut` = `a_traiter` sauf suivi enregistré de même empreinte (`traitee`/`ignoree`) ; empreinte différente → `a_traiter` + `suivi.obsolete = true`. Tri : gravité desc, catégorie, montant/heures desc.

**Analyse budgétaire** (`AnalyseResult.budget.par_nature`, DECISIONS n° 10) : 5 lignes fixes `{nature: provision|mo|capacite|frais|autres, libelle, pps, realise, pct_consomme}` ; `pps` = Σ PPS du plan, `realise` = Σ TOTAL EN € de toute la version (avoirs compris) ; Σ = `previsions.global.budget` / `consomme`.

**Correspondances** (`AnalyseResult.correspondances`) : une par nom réalisé des écritures MO, `{nom_realise, nom_prenom, personne_id, personne_nom, confidence, nb_ecritures, heures}`. `confidence` = `nom` (clé NOM + Prénom présente au plan) ou `none` (hors plan). `EcartRow.confidence` ∈ `nom | none | plan`. `EcartRow.ressource` = « NOM Prénom » (libellé pour une ligne non nominative). Plus de contrôle qualité « fuzzy » ni de réglage `seuil_fuzzy_count`.
