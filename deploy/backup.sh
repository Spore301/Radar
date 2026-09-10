#!/bin/bash
# Consistent SQLite backup (works while the app is running, WAL-safe).
# Usage:  ~/radar/deploy/backup.sh            → ./backups/radar-YYYY-MM-DD-HHMM.db
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%F-%H%M)
docker compose exec -T app node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.\$queryRawUnsafe(\"VACUUM INTO '/data/backup.tmp.db'\").then(() => p.\$disconnect());
"
docker compose cp app:/data/backup.tmp.db "backups/radar-${stamp}.db"
docker compose exec -T app rm -f /data/backup.tmp.db
echo "[radar] wrote backups/radar-${stamp}.db"
