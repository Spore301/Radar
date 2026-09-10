#!/bin/bash
# Pull the latest code and roll the app container. Run on the server from
# anywhere:  ~/radar/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[radar] pulling latest code"
git pull --ff-only

echo "[radar] building image"
docker compose build --pull app

echo "[radar] restarting"
docker compose up -d

# Compose only recreates caddy when its own config changes, not when the
# Caddyfile does, so apply any pulled Caddyfile edits explicitly. Validate
# first: a bad file would otherwise take the proxy down.
if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 && echo "[radar] caddy reloaded"
else
  echo "[radar] WARNING: deploy/Caddyfile failed validation; caddy kept its previous config" >&2
fi

echo "[radar] cleaning old images"
docker image prune -f >/dev/null

docker compose ps
echo "[radar] done — follow logs with: docker compose logs -f app"
