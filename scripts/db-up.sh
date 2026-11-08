#!/usr/bin/env bash
# Starts the local Postgres for development. Uses docker compose when the
# plugin is available, otherwise an equivalent `docker run`.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
: "${POSTGRES_USER:=rc}" "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}" "${POSTGRES_DB:=rc_combat}" "${POSTGRES_PORT:=5433}"

if docker compose version >/dev/null 2>&1; then
  docker compose up -d postgres
elif docker ps -a --format '{{.Names}}' | grep -qx rc-combat-postgres; then
  docker start rc-combat-postgres >/dev/null
else
  docker run -d --name rc-combat-postgres --restart unless-stopped \
    -e POSTGRES_USER="$POSTGRES_USER" -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" -e POSTGRES_DB="$POSTGRES_DB" \
    -p "$POSTGRES_PORT:5432" -v rc_combat_pgdata:/var/lib/postgresql/data postgres:17-alpine >/dev/null
fi

for _ in $(seq 1 40); do
  if docker exec rc-combat-postgres pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1 || pg_isready -h localhost -p "$POSTGRES_PORT" >/dev/null 2>&1; then
    echo "postgres ready on localhost:$POSTGRES_PORT"
    exit 0
  fi
  sleep 1
done
echo "postgres did not become ready" >&2
exit 1
