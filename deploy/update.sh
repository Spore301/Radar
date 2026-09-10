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

echo "[radar] cleaning old images"
docker image prune -f >/dev/null

docker compose ps
echo "[radar] done — follow logs with: docker compose logs -f app"
