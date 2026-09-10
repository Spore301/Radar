#!/bin/sh
# Container start: bring the SQLite schema up to date, then serve.
# DATABASE_URL points into the /data volume (see docker-compose.yml), so the
# first start creates the file and every later start only applies new
# migrations. `migrate deploy` never prompts and never resets data.
set -eu

echo "[radar] applying database migrations to ${DATABASE_URL}"
node node_modules/prisma/build/index.js migrate deploy

echo "[radar] starting Next.js on port ${PORT:-3000}"
exec node server.js
