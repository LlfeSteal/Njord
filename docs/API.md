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
| POST | `/{kind}/imports/preview` | multipart `file`, `intitule?` | `ImportReport` (rien n'est écrit ; `nouvelles_personnes`/`nouveaux_squads` = ce qui serait créé) |
| POST | `/{kind}/imports` | multipart `file`, `intitule?`, `importeur?`, `archive_active` (`true` défaut) | 201 `ImportResult` |
| GET | `/{kind}/versions?include_purged=false` | | `Version[]` (actives, archivées, purgées) — `store.ListVersions` |
| GET | `/{kind}/versions/:id` | | `Version` |
| POST | `/{kind}/versions/:id/archive` | JSON `{operateur?}` | `Version` — `store.Archive` |
| POST | `/{kind}/versions/:id/reactivate` | JSON `{operateur?}` | `Version` — `store.Reactivate` |
| POST | `/{kind}/versions/:id/purge` | JSON `{confirm_intitule, operateur?}` | `Version` — `store.Purge` (409 si conditions non remplies) |
| GET | `/{kind}/versions/:id/facets` | | `Facets` (valeurs distinctes des colonnes filtrables) |

`intitule` absent → nom du fichier sans extension. Erreur bloquante (onglet/en-tête) → 422, aucune écriture. Version/lignes créées via `store.CreateVersion(ctx, &v, archiveActive, fill)`.

### Plan : lignes
`GET /plan/versions/:id/lines` → `PlanLinesPage` ; `GET /plan/versions/:id/lines.csv` (mêmes filtres, sans pagination).
Filtres : `ct`, `ressource`, `ligne_cout`, `statut` (ok|warn|drop), `inactive` (bool), `squad_id`, `date_from`/`date_to` (chevauchement avec [date_debut, date_fin]), `q` (plein-texte sur libellé/CT/ressource, insensible casse/accents), `sort` (`row_num`|`ct`|`ressource`|`charge_totale`|`pps`|`date_debut`), `order`, `limit`, `offset`. `totals` = Σ sur **tout** le filtre courant (pas seulement la page). Facets : `ct`, `ressource`, `ligne_cout`, `squad_id` (valeur = id ; libellé via `/squads`), `statut`.

### Réalisé : écritures
`GET /realise/versions/:id/entries` → `RealiseEntriesPage` ; `GET /realise/versions/:id/entries.csv`.
Filtres : `entite`, `activite`, `trigramme`, `tg`, `wp`, `categorie`, `type`, `lot`, `statut`, `date_from`/`date_to` (sur date_depense), `montant_min`/`montant_max` (total_eur), `q` (TG, TG-libellé, + description si `search_description=true`), `mask_sensitive` (bool : vide `employe_fournisseur`, `matricule`, `num_facture`, `num_commande`, `description_depenses`, `nom_ressource`, `fournisseur`), `sort` (`date_depense`|`total_eur`|`tg`|`row_num`), `order`, `limit`, `offset`. `totals` = Σ quantité, Σ €, nb lignes par catégorie sur le filtre courant.

## Référentiels (`internal/referentiel`)

| Méthode | Chemin | Entrée | Réponse |
|---|---|---|---|
| GET | `/personnes?q=` | | `Personne[]` (avec matricules & alias) |
| GET / PATCH | `/personnes/:id` | `{display_name?, statut?, squad_id?}` | `Personne` |
| POST | `/personnes/:id/alias` | `{alias}` (source `manuel`) | `Personne` |
| DELETE | `/personnes/:id/alias/:aliasId` | | `Personne` |
| POST | `/personnes/:id/matricules` | `{matricule}` (409 si déjà pris) | `Personne` |
| POST | `/personnes/:id/merge` | `{into_id}` : rattache `:id` à `into_id` (matricules, alias, lignes de plan) puis supprime `:id` | `Personne` (cible) |
| GET / POST | `/squads` | `{nom_canonique, entite_rattachee?, parent_id?}` | `Squad[]` / `Squad` |
| PATCH | `/squads/:id` | `{nom_canonique?, entite_rattachee?, parent_id?}` | `Squad` |
| POST | `/squads/:id/alias` | `{alias}` | `Squad` |

## Analyse (`internal/analyse`)

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/analyse/context` | `AnalyseContext` |
| GET | `/analyse?plan_version_id=&realise_version_id=&week_from=2026-W36&week_to=2026-W40&include_inactive=false` | `AnalyseResult` (paramètres absents → défauts du contexte). 409 `precondition` si aucun plan (actif ou choisi) ou aucun réalisé |
| GET | `/analyse/ecarts.csv` | mêmes params + filtres `ct`, `ressource`, `flag`, `squad_id` |
| GET | `/analyse/realise-enrichi.csv` | mêmes params + `mask_sensitive` : écritures + `iso_week`, `heures`, `eur`, `classification` |
| POST | `/analyse/alias/confirm` | `{personne_id, alias}` → ajoute un alias `confirme` → `Personne` |
