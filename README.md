# Njord

Njord est une application web d'analyse des imputations : elle confronte le **plan de charge** (ce qui était prévu) au **réalisé** (ce qui a été imputé) et met en évidence les écarts.

L'interface s'organise autour de trois onglets métier :

- **Plan de charge** : import, consultation, archivage et purge des versions de plan.
- **Réalisé** : import et consultation des imputations réalisées.
- **Analyse** : corrélation plan ↔ réalisé, dépliage hebdomadaire, écarts et alertes.

complétés par les onglets **Référentiels** (squads, personnes…) et **Paramètres**.

Les règles fonctionnelles sont décrites dans les spécifications à la racine :

- [`SPEC_Plandecharge.md`](SPEC_Plandecharge.md)
- [`SPEC_realise.md`](SPEC_realise.md)
- [`SPEC_analyse.md`](SPEC_analyse.md)

La documentation technique se trouve dans [`docs/`](docs/).

## Architecture

- `backend/` : API REST en Go (module `njord`, point d'entrée `./cmd/njord`), stockage SQLite (`modernc.org/sqlite`, sans CGO).
- `frontend/` : SPA React + TypeScript construite avec Vite.
- En production, nginx sert la SPA et relaie `/api/` vers le backend.

Le détail (modules, modèle de données, flux d'import et d'analyse) est décrit dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Prérequis

| Outil | Version | Usage |
|---|---|---|
| Go | 1.22+ | backend |
| Node.js / npm | 22+ | frontend |
| Docker + Docker Compose v2 | récent | déploiement conteneurisé (optionnel) |
| make | — | raccourcis (optionnel) |

## Lancement en développement

Dans deux terminaux :

```bash
# Terminal 1 — backend sur http://localhost:8080 (base SQLite : backend/data/njord.db)
make dev-backend

# Terminal 2 — frontend Vite sur http://localhost:5173
make dev-frontend
```

Ouvrir <http://localhost:5173>. Le serveur Vite relaie les appels `/api` vers le backend sur `:8080`.

Équivalent sans `make` :

```bash
cd backend && mkdir -p data && go run ./cmd/njord --addr :8080 --db ./data/njord.db
cd frontend && npm install && npm run dev
```

Options du binaire backend :

| Option | Défaut conseillé | Rôle |
|---|---|---|
| `--addr` | `:8080` | adresse d'écoute HTTP |
| `--db` | `./data/njord.db` | chemin du fichier SQLite |
| `--static` | *(vide)* | dossier de la SPA buildée à servir (facultatif) |

Pour un binaire unique servant aussi le frontend : `make run` (build puis `--static ./frontend/dist`).

## Lancement avec Docker

```bash
make docker-up      # docker compose up --build -d
# -> http://localhost
make docker-down    # arrêt (les données sont conservées)
```

- `backend` : API sur le port 8080 (interne au réseau Compose), base dans le volume nommé `njord-data` (`/data/njord.db`), healthcheck sur `GET /api/health`.
- `frontend` : nginx sur le port **80**, sert la SPA et relaie `/api/` vers `backend:8080`. Il ne démarre qu'une fois le backend déclaré sain.

Pour repartir d'une base vide : `docker compose down -v` (supprime le volume `njord-data`).

## Tests

```bash
make test
```

qui exécute :

- `cd backend && go test ./...`
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json` (vérification des types)

## Données de démonstration

Le dossier [`test_data_demo/`](test_data_demo/) contient deux fichiers Excel anonymisés :

1. `demo_plancharge.xlsx` : à importer **d'abord**, dans l'onglet **Plan de charge** ;
2. `demo_realise.xlsx` : à importer **ensuite**, dans l'onglet **Réalisé**.

L'onglet **Analyse** permet alors de comparer le prévu et le réalisé.

## Licence

Njord est distribué sous licence [Apache 2.0](LICENSE). Voir aussi [NOTICE](NOTICE).
