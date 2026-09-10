# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# RADR. / CandidateRadar production image.
#
#   deps     install exact dependencies (Playwright is optional and skipped)
#   builder  next build with output: 'standalone'
#   runner   slim runtime: the standalone server, static assets, and just
#            enough of Prisma to run `migrate deploy` at container start.
#
# The SQLite database lives at /data (a Docker volume, see docker-compose.yml).
# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `postinstall` runs `prisma generate`, so the schema must be present first.
COPY prisma ./prisma
RUN npm ci --omit=optional

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build never touches the database, but Prisma insists the URL is set.
ENV DATABASE_URL="file:/tmp/build-placeholder.db"
RUN npm run build

# ---------------------------------------------------------------------------
# Prisma CLI in its own stage, so `migrate deploy` has its complete dependency
# tree at runtime. Hand-copying node_modules/prisma and node_modules/@prisma
# out of the builder is NOT enough: the CLI requires @prisma/config, whose own
# dependencies (c12, jiti, effect, ...) sit at the top level of node_modules,
# and the first deploy crash-looped with MODULE_NOT_FOUND. Letting npm resolve
# the tree is the robust fix. The version is read from the builder so the CLI
# can never drift from the generated client, and `--version` runs here so a
# broken install fails the image build instead of the container start.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS prisma-cli
WORKDIR /prisma-cli
ENV CHECKPOINT_DISABLE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules/prisma/package.json /tmp/prisma-package.json
RUN printf '{"name":"prisma-cli","private":true,"dependencies":{"prisma":"%s"}}\n' \
      "$(node -p "require('/tmp/prisma-package.json').version")" > package.json \
 && npm install --omit=dev --no-audit --no-fund --loglevel=error \
 && node node_modules/prisma/build/index.js --version

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home /app nextjs \
 && mkdir -p /data && chown nextjs:nodejs /data

# The standalone server and its traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Schema + migrations for the entrypoint, and the Prisma CLI from its own stage.
# The generated client the app itself uses is already inside the standalone
# node_modules above, traced by Next.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli/node_modules ./prisma-cli/node_modules

COPY --chown=nextjs:nodejs deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
