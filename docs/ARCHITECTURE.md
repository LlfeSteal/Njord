# Architecture Njord

Application web d'analyse des imputations des collaborateurs : **Plan de charge** (prévu) × **Réalisé** (imputé) → **Analyse** (écarts, budget, KPI). Specs : `SPEC_Plandecharge.md`, `SPEC_realise.md`, `SPEC_analyse.md`. Contrat : `docs/API.md`. Écarts aux specs : `docs/DECISIONS.md`.

## Stack
- **Backend** `backend/` — Go 1.22, module `njord`, Gin, SQLite (`modernc.org/sqlite`, sans cgo), `excelize/v2`. `go run ./cmd/njord --addr :8080 --db ./data/njord.db [--static ../frontend/dist]`.
- **Frontend** `frontend/` — React 18 + TypeScript + Vite, TanStack Query v5, react-router v6, Recharts, dayjs. **Aucun framework CSS ni police web** : kit UI maison `src/ui/` + tokens `src/styles/theme.css`, guide visuel `docs/STYLE.md`. Dev : `npm run dev` (:5173, proxy `/api` → :8080).
- **Déploiement** `docker-compose.yml` : backend + nginx (front buildé, proxy `/api`).

## Backend — packages

| Package | Rôle | Propriétaire |
|---|---|---|
| `internal/domain` | Types partagés = contrat JSON | intégrateur |
| `internal/store` | SQLite, schéma complet (`schema.go`), cycle de vie générique des versions (`CreateVersion`, `Archive`, `Reactivate`, `Purge`, `ListVersions`, `GetVersion`, `ActiveVersion`), `GetSettings`/`PutSettings`, `Audit`/`ListAudit`, `Tx` | intégrateur |
| `internal/xlsxutil` | `FindTable` (onglet + ligne d'en-tête par matcher), `NormHeader`, `IndexOf`, `Cell`, `NullDash`, `ParseNumber`, `ParseDate`/`SerialToDate`, `CodeAndLabel`, `StripAccents` | intégrateur |
| `internal/names` | `ParseNomPrenom` (plan), `ParseRealise` (réalisé, civilité retirée), `Key`/`KeyOf` (seule clé personne : NOM + Prénom), `NormalizeSquad`, `SplitLibelle`, `LooksLikeSquad` | intégrateur |
| `internal/httpx` | `Error`, `BadRequest`, `Unprocessable`, `FormFile`, `Operateur`, `Pagination`, `QueryBool`, `FormBool`, `CSV`, `FormatFloat` | intégrateur |
| `internal/core` | `/health`, `/settings`, `/audit` | intégrateur |
| `internal/plan` | Parser PDC, import, lignes, CSV, facets ; crée personnes/squads à l'import | agent Plan |
| `internal/referentiel` | Endpoints `/personnes`, `/squads` | agent Plan |
| `internal/realise` | Parser réalisé, import, écritures, CSV, facets | agent Réalisé |
| `internal/provision` | Parser de l'export « Dépenses prévues », import, lignes, CSV, facets (DECISIONS n° 16) | agent Provisions |
| `internal/analyse` | Moteur pur `Run(Input, Settings)` sur la **timeline du plan** (`BuildTimeline`, `timeline.go`, DECISIONS n° 13), repo lecture SQL, endpoints, exports | agent Analyse |

Chaque module expose `func New(st *store.Store) *Handler` et `func (h *Handler) Register(g *gin.RouterGroup)` (déjà branchés dans `cmd/njord/main.go`). Les modules accèdent à leurs tables en SQL via `st.DB()` ; le **schéma est figé** (`store/schema.go`). L'analyse lit `plan_lines`, `realise_entries`, `provision_lines`, `personnes`, `squads` directement et n'écrit que dans `analyse_last_result` et `anomalie_suivi`.

Tables : `versions` (plan, réalisé & provisions, colonne `kind`, index unique « une active par kind »), `plan_lines`, `realise_entries`, `provision_lines`, `personnes` (clé `nom_normalise` = NOM + Prénom, unique), `squads` (+`parent_id`), `squad_alias`, `audit_log`, `settings` (JSON), `analyse_last_result`.

Purge = suppression des lignes + version passée en `purgee` (pierre tombale visible avec « afficher purgées ») ; référentiels jamais supprimés.

## Frontend — structure

Navigation en barre latérale (`src/components/AppLayout.tsx`), routes dans `src/App.tsx` :

| Route | Page | Dossier |
|---|---|---|
| `/` | Vue d'ensemble (budget, à traiter, prévision) | `src/pages/pilotage/overview/` |
| `/anomalies` | Boîte de réception des anomalies | `src/pages/pilotage/anomalies/` |
| `/ecarts` | Écarts d'imputation | `src/pages/pilotage/ecarts/` |
| `/budget` | Budget par CT | `src/pages/pilotage/budget/` |
| `/previsions` | Atterrissage et charge à venir | `src/pages/pilotage/previsions/` |
| `/plan`, `/realise` | Version **active** (sinon la plus récente) ; le titre est un sélecteur d'historique | `src/pages/plan/`, `src/pages/realise/` |
| `/plan/timeline` | Timeline du plan (Gantt des segments, fenêtres des versions, non couvert) | `src/pages/plan/PlanTimeline.tsx` |
| `/provisions` | Provisions : version **active** (sinon la plus récente), lignes par CT et total | `src/pages/provisions/` |
| `/plan/:id`, `/realise/:id`, `/provisions/:id` | Version précise de l'historique | idem |
| `/plan/versions`, `/realise/versions`, `/provisions/versions` | Gestion des versions (archivage, réactivation, purge) | idem + `src/components/VersionsPanel.tsx` |
| `/personnes`, `/squads` | Référentiels | `src/pages/referentiels/` |
| `/reglages/*` | Paramètres et journal | `src/pages/parametres/` |

| Chemin | Rôle |
|---|---|
| `src/api/types.ts`, `src/api/client.ts` | Types & client typé (contrat) |
| `src/lib/format.ts`, `src/lib/queryKeys.ts` | Formatage fr-FR, clés TanStack Query |
| `src/styles/theme.css`, `src/ui/` | Tokens et kit UI (gabarit `Page`/`PageToolbar`/`Inspector`, `Sidebar`, listes, filtres…) — cf. `docs/STYLE.md` |
| `src/pages/pilotage/shared/context.ts` | Sélection d'analyse partagée (versions × période) + `useAnalyse()` |
| `src/components/` | Coquille, statuts, cycle de vie des versions (VersionsPanel, ImportWizard, PurgeModal) |

Après import / archivage / purge / alias / suivi d'anomalie : invalider `['versions']`, `['analyse']` (et `['personnes']` si besoin).

## Règles de travail en parallèle
- Ne modifier que ses répertoires. `go.mod`, `package.json`, `domain`, `store`, `api/types.ts`, `api/client.ts` : **lecture seule** — besoin d'un changement → le signaler dans le rapport final.
- Aucune nouvelle dépendance.
- UI : uniquement le kit `src/ui/` ; aucune couleur littérale hors `theme.css` (états `data-*` / props `tone` → tokens) ; toute évolution visuelle met à jour `docs/STYLE.md`.
- Backend : `cd backend && go build ./... && go test ./internal/<pkg>/...`. Frontend : `cd frontend && npx tsc --noEmit -p tsconfig.app.json` (ignorer les erreurs hors de ses fichiers ; ne pas lancer `npm run build` qui écrit `dist/` en concurrence).
- Ne jamais logger de donnée sensible (noms, matricules, montants individuels, factures).
