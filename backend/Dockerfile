# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Étape 1 : build du binaire Go (statique, sans CGO — SQLite via modernc.org/sqlite)
# ---------------------------------------------------------------------------
FROM golang:1.22-bookworm AS build

WORKDIR /src

# Cache des modules : ne se réinvalide que si go.mod / go.sum changent.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/njord ./cmd/njord

# ---------------------------------------------------------------------------
# Étape 2 : image d'exécution
# debian:bookworm-slim (plutôt que distroless) pour disposer de curl,
# utilisé par le HEALTHCHECK sur GET /api/health.
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 njord \
 && useradd --system --uid 10001 --gid njord --home-dir /nonexistent --shell /usr/sbin/nologin njord \
 && mkdir -p /data \
 && chown njord:njord /data

COPY --from=build /out/njord /usr/local/bin/njord

ENV GIN_MODE=release \
    TZ=Europe/Paris

USER njord:njord
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/njord"]
CMD ["--addr", ":8080", "--db", "/data/njord.db"]
