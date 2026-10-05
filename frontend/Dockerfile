# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Étape 1 : build de la SPA (Vite) -> dist/
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Cache des dépendances : ne se réinvalide que si package*.json changent.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Étape 2 : nginx sert dist/ et proxifie /api/ vers le backend
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/njord.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# wget est fourni par busybox dans l'image alpine.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
