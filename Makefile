# Njord — raccourcis de développement et de déploiement

BACKEND_DIR  := backend
FRONTEND_DIR := frontend
BACKEND_BIN  := $(BACKEND_DIR)/njord

.DEFAULT_GOAL := help
.PHONY: help dev-backend dev-frontend test test-backend test-frontend build build-backend build-frontend run docker-up docker-down docker-logs

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Développement ---------------------------------------------------------

dev-backend: ## Lance le backend Go sur :8080 (base ./backend/data/njord.db)
	mkdir -p $(BACKEND_DIR)/data
	cd $(BACKEND_DIR) && go run ./cmd/njord --addr :8080 --db ./data/njord.db

dev-frontend: ## Lance Vite sur :5173 (proxy /api -> :8080)
	cd $(FRONTEND_DIR) && npm run dev

## --- Tests -----------------------------------------------------------------

test: test-backend test-frontend ## Tests Go + vérification TypeScript

test-backend: ## go test ./...
	cd $(BACKEND_DIR) && go test ./...

test-frontend: ## tsc --noEmit
	cd $(FRONTEND_DIR) && npx tsc --noEmit -p tsconfig.app.json

## --- Build -----------------------------------------------------------------

build: build-backend build-frontend ## Build binaire Go + SPA (frontend/dist)

build-backend: ## Binaire statique backend/njord
	cd $(BACKEND_DIR) && CGO_ENABLED=0 go build -trimpath -o njord ./cmd/njord

build-frontend: ## npm ci + npm run build -> frontend/dist
	cd $(FRONTEND_DIR) && npm ci && npm run build

run: build ## Lance le binaire buildé, qui sert aussi la SPA (--static)
	mkdir -p $(BACKEND_DIR)/data
	./$(BACKEND_BIN) --addr :8080 --db ./$(BACKEND_DIR)/data/njord.db --static ./$(FRONTEND_DIR)/dist

## --- Docker ----------------------------------------------------------------

docker-up: ## Build + démarre la stack (http://localhost)
	docker compose up --build -d

docker-down: ## Arrête la stack (le volume njord-data est conservé)
	docker compose down

docker-logs: ## Suit les logs de la stack
	docker compose logs -f
