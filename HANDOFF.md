# CandidateRadar — Deployment & CI/CD Handoff

**Audience:** DevOps / Platform team
**Repo:** `https://github.com/Spore301/Radar.git` (branch `main`)
**Status of this document:** written against commit `72a6390`, 2026-09-09. Every "verified" claim below was run against the tree at that commit; every "decision needed" item is genuinely open.

---

## 1. What the application is

CandidateRadar is a recruiter-facing sourcing tool. A user pastes or uploads a job description; the app structures it with an LLM, generates Google X-Ray search queries, runs them against a SERP provider, indexes every returned profile, and gives the recruiter a shortlist, a pipeline board and generated outreach copy.

**Stack**

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.35, App Router, Node.js runtime only (no Edge) |
| Language | TypeScript 5.7 (`strict: true`) |
| UI | React 18, Tailwind CSS 3.4, Framer Motion, Geist font |
| Auth | Auth.js (`next-auth` 5.0.0-beta.32), Google OAuth, **database sessions** |
| ORM / DB | Prisma 6.19 → **SQLite** (file-backed) |
| LLM | DeepSeek (`api.deepseek.com`), called over plain `fetch` |
| Search | SerpAPI (primary, metered) → headless Chromium fallback (Playwright, optional dep) |

There is **no middleware.ts** and no Edge runtime anywhere. All 16 API routes are `force-dynamic` Node handlers.

---

## 2. Verified build status

Run at commit `72a6390` on Node 24:

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **Pass** (exit 0) |
| Lint | `npm run lint` | **Pass** — no warnings or errors |
| Production build | `npm run build` | **Pass** (exit 0), 13 routes, 87.3 kB shared first-load JS |

So the pipeline has a green baseline to build on. The blockers in §9 are configuration and infrastructure gaps, not broken code.

---

## 3. The constraints that shape deployment

Read this section before designing the topology. Five properties of the app rule out the default "stateless containers behind a load balancer" shape.

### 3.1 The database is SQLite on local disk

`prisma/schema.prisma` declares `provider = "sqlite"`, and `.env` sets `DATABASE_URL="file:./dev.db"` (resolved relative to the schema's directory, i.e. `prisma/dev.db`).

Consequences:

- The app is **stateful**. It needs a persistent writable volume, not ephemeral container storage.
- It runs as **exactly one instance**. Two replicas pointing at the same file will corrupt or lock each other; two replicas with separate files are two separate products.
- It **cannot run on Vercel, Lambda, or any serverless/scale-to-zero platform** as-is.
- Backups are file-level: the `.db`, `.db-wal` and `.db-shm` files must be snapshotted together, or captured with `sqlite3 .backup` / `VACUUM INTO` against a live connection. Copying `dev.db` alone from a WAL-mode database gives you a stale, possibly inconsistent file.

The current dev database is ~1.3 MB with a 4.3 MB WAL — small, but the WAL size shows writes are not being checkpointed aggressively.

**Decision needed:** stay on SQLite with a single container + persistent volume (simplest, matches the code today), or migrate to Postgres before launch (needed for any HA or horizontal scale). Migrating is a schema-provider change plus regenerating migrations — the 15 models use no SQLite-specific features, but the `.db` pragmas in §3.2 and the credit-reservation logic assume single-writer semantics and want review.

### 3.2 Boot-time database pragmas do not currently run — **this is a live bug**

`src/instrumentation.ts` calls `initDb()`, which sets four SQLite pragmas the code comments describe as load-bearing:

```
PRAGMA journal_mode = WAL;      -- concurrent readers + writer
PRAGMA busy_timeout = 5000;     -- wait instead of SQLITE_BUSY
PRAGMA foreign_keys = ON;       -- SQLite ignores FK constraints without this
PRAGMA synchronous = NORMAL;
```

In Next.js 14, `instrumentation.ts` only runs when `experimental.instrumentationHook` is enabled. [next.config.js](next.config.js) does not set it. Verified against the build output: `.next/required-server-files.json` reports `experimental.instrumentationHook: false`, and no instrumentation chunk is emitted.

**So `initDb()` never executes in the Next server.** The observable effects on a fresh production database:

- `foreign_keys` is **per-connection and not persistent** — every `onDelete: Cascade` in the schema silently does nothing. Deleting a user or job leaves orphaned candidates, run receipts and credential rows.
- `busy_timeout` is unset, so concurrent writes fail immediately with `SQLITE_BUSY` instead of waiting.
- A newly-created production `.db` starts in rollback-journal mode, not WAL. (The dev database is in WAL only because `scripts/e2e.ts` calls `initDb()` directly.)

The fix is one line in `next.config.js` (`experimental: { instrumentationHook: true, ... }`). **I have not applied it** — it is an application change and belongs to the app owner, not this handoff. It should be treated as a release blocker either way; flag it back to the developer.

### 3.3 Long-lived streaming responses

Three routes stream NDJSON progress for tens of seconds to minutes:

| Route | Declared `maxDuration` | What it does |
|---|---|---|
| `POST /api/agent/turn` | 120 s | One conversational agent turn |
| `POST /api/parse-jd` | 60 s | JD extraction + LLM structuring |
| `POST /api/generate-queries` | 30 s | LLM query generation |

The search run is **no longer** one of them — see §3.4.

`POST /api/generate-outreach` declares no `maxDuration` but also calls an LLM — treat it as up to ~90 s (the DeepSeek client's own timeout).

Infrastructure requirements:

- **Proxy/LB idle and read timeouts must exceed 180 s** on these paths. Nginx `proxy_read_timeout`, ALB idle timeout, Cloudflare (100 s default on free/pro — these routes will be cut off) all need attention.
- **Response buffering must be off.** The app already sends `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` ([src/lib/api/ndjson.ts](src/lib/api/ndjson.ts)), which nginx honours; other proxies need explicit configuration or the progress UI arrives all at once at the end.
- Once a stream starts the HTTP status is **always 200** — errors arrive as a final `{"type":"error"}` line. Uptime and error-rate monitoring based on status codes will not see these failures. Log-based alerting on `Streaming route failed:` is the hook.

### 3.4 Searches run in the background — a long-lived Node process is required

`POST /api/search-runs` creates the `SearchRun` row, starts the work, and returns `202` with a run id in
milliseconds. The search itself continues **in the same process, after the response has been sent**, writing its
progress to the `SearchRun` / `SearchRunQuery` rows as each query lands. The browser polls `GET /api/search-runs`
(1.5 s while anything is active, 15 s otherwise) and renders the bottom-right progress popup, so closing the
overlay, changing page or reloading the tab never cancels or loses a run.

What this means for deployment:

- **The server must not be frozen after responding.** A long-lived Node container (`next start`, which is what this
  app ships as) is fine. **Serverless is not**: Vercel/Lambda suspend the instance the moment the response is
  flushed, so the run would stop at the first `await` after the `202`. If serverless is the target, the body of
  `driveRun()` in [src/lib/search/runManager.ts](src/lib/search/runManager.ts) has to move behind a queue
  (SQS/QStash/Inngest) that calls back into the same helpers. All run state is already in the database rather
  than in memory, so nothing else changes.
- **Proxy timeouts no longer matter for searches.** Every request in the search path is now short. §3.3's 180 s
  requirement drops to the agent turn's 120 s.
- **Rolling restarts still drop in-flight searches.** A killed worker leaves its run row `running` with a stale
  `heartbeatAt`; anything older than `RUN_HEARTBEAT_TIMEOUT_MS` (120 s) is reported to the UI as failed
  ([src/lib/db/searchRuns.ts](src/lib/db/searchRuns.ts)). Nothing sweeps those rows yet — a periodic job that marks
  stale `running` rows as `failed` would make the history exact. Drain before restart where possible.
- **Concurrency is unbounded.** Nothing currently limits how many runs one user can start at once; each is up to 16
  queries at `SERP_CONCURRENCY` 4. Worth a per-user cap before opening this to a team.

### 3.5 In-process singletons

- **Prisma client** is stashed on `globalThis` — one connection pool per process.
- **Chromium browser instance** ([src/lib/search/playwrightSearch.ts](src/lib/search/playwrightSearch.ts)) is a module-level singleton, launched lazily and closed after 5 minutes idle.

Neither survives a restart, and neither is shared across processes. This reinforces §3.1 and §3.4: single instance, and rolling restarts will drop in-flight searches.

---

## 4. Environment variables

Complete inventory, grepped from source. Nothing is read from anywhere else.

### Required

| Variable | Consumed by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma CLI + client | `file:./dev.db` today, relative to `prisma/`. Prisma's CLI only auto-loads `.env`, **not** `.env.local` — migrations need it in the environment. |
| `AUTH_SECRET` | Auth.js + `src/lib/credentials.ts` | **Dual-purpose and load-bearing.** Signs session cookies *and* derives the AES-256-GCM key that seals every user's stored SerpAPI/DeepSeek key. **Rotating it invalidates all sessions AND permanently destroys all stored provider credentials** — decryption fails and the code treats the key as absent. Never rotate casually; if you must, plan a user-facing re-entry flow. In production the code throws when a provider credential is sealed or opened without it (not at startup), so a missing `AUTH_SECRET` surfaces as a runtime failure on the settings/onboarding path rather than a failed boot. |
| `AUTH_GOOGLE_ID` | Auth.js (by convention) | Google Cloud Console OAuth client, type "Web application" |
| `AUTH_GOOGLE_SECRET` | Auth.js (by convention) | |
| `AUTH_TRUST_HOST` | Auth.js | Set to `true` for any non-Vercel origin, or Auth.js rejects requests as untrusted-host. (`trustHost: true` is also set in code, but keep the env var for parity.) |

Google OAuth redirect URI must be registered **exactly** as `https://<domain>/api/auth/callback/google` per environment. Each environment needs its own OAuth client or an added redirect URI.

### Optional / feature-gating

| Variable | Effect when unset |
|---|---|
| `ALLOWED_GOOGLE_DOMAIN` | **Sign-in restriction is disabled** except for explicit `Invite` table rows. With it set, only accounts whose Google ID-token `hd` claim equals this domain get in. Treat as a security control, not a convenience — set it in every environment. |
| `DEEPSEEK_API_KEY` | Platform fallback LLM key. Users can supply their own per-request via an `x-deepseek-api-key` header. |
| `SERPAPI_KEY` | Platform fallback search key. Each user's own encrypted key is preferred and pays for their runs. |
| `BRAVE_SEARCH_KEY` | Declared in `.env.local` but **not referenced anywhere in `src/`** — dead config, safe to drop. |
| `SERP_ENGINE` | `google` (alt: `google_light`) |
| `SERP_MAX_PAGES_PER_QUERY` | 5; hard-capped at 10 in code. Directly controls SerpAPI credit burn — one page = one credit. |
| `NEXT_DIST_DIR` | `.next`. Only used to let a QA build run beside `next dev`. |
| `E2E_BASE` | `http://localhost:3100`, for the e2e harness only. |

### Secret handling notes

- `.env` and `.env.local` are gitignored and **must stay out of the image**. Inject at runtime via your secrets manager.
- Users' provider API keys live encrypted at rest in the `ProviderCredential` table (AES-256-GCM, only `keyLast4` readable). The database file therefore contains third-party secrets — **the volume and its backups are secret material** and need the same handling as the secrets store.
- The database also holds candidate profile data scraped from public sources. Treat backups as containing third-party personal data for retention/GDPR purposes.

---

## 5. Database & migrations

Four migrations exist under `prisma/migrations/`, provider-locked to SQLite:

```
20260905091803_init
20260905113826_auth
20260908102215_session_history_receipt
20260909120000_onboarding_agent
```

15 models: `User`, `Account`, `Session`, `VerificationToken`, `Invite`, `Job`, `Candidate`, `OutreachLog`, `MessageTemplate`, `SearchRun`, `SearchRunQuery`, `SerpQueryCache`, `CreditPeriod`, `CreditLedger`, `ProviderCredential`.

**Gap:** `package.json` has `db:migrate` (`prisma migrate dev` — interactive, dev-only, will try to create/reset) but **no production migration script**. Add one:

```json
"db:deploy": "prisma migrate deploy"
```

`prisma migrate deploy` must run as a release step *before* the new app version starts, with `DATABASE_URL` present in the environment. On SQLite with a single instance this is straightforward; there is no concurrent-migration hazard, but there is also no rollback — take a volume snapshot before every deploy.

`postinstall: prisma generate` already runs on `npm ci`, so the client is generated in CI without an extra step.

---

## 6. Build & run

```bash
npm ci                 # runs prisma generate via postinstall
npx prisma migrate deploy
npm run build          # next build
npm start              # next start — binds 0.0.0.0:3000 by default
```

**Node version:** `.nvmrc` pins `24`; `package.json` `engines` says `>=20.9`. These disagree. Verified builds pass on Node 24. **Pick one and make CI, the Dockerfile and `.nvmrc` agree** — recommend Node 22 LTS or 24, and tighten `engines` to match.

### Containerisation

No `Dockerfile`, `.dockerignore`, `docker-compose.yml` or `vercel.json` exists. This is the largest single piece of work. Requirements the image must satisfy:

1. **Multi-stage build**, but note `next.config.js` does *not* set `output: 'standalone'` — either add it (recommended, much smaller runtime image) or ship `node_modules` into the runtime stage.
2. **`serverComponentsExternalPackages`** already externalises `pdf-parse`, `mammoth`, `playwright`, `playwright-core` and `@prisma/client` — these are `require()`d at runtime and **must be present in the runtime image's `node_modules`**, not just at build time.
3. **Prisma query engine binary** must match the runtime image's libc. Building on Debian and running on Alpine will fail; set `binaryTargets` in the generator block if the images differ.
4. **Playwright/Chromium is optional.** It powers the free-tier SERP fallback only. Including it adds ~400 MB and a full system-library set; excluding it means the fallback throws a caught error and users without their own SerpAPI key get nothing. The launch args already include `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`, so it is container-ready — but `--no-sandbox` means Chromium renders untrusted web content with no sandbox. **Decision needed:** include it (and accept that risk / run the container with a seccomp profile and low privileges), or exclude it and require every user to bring a SerpAPI key. If included, size `/dev/shm` appropriately.
5. **Persistent volume** mounted at the `prisma/` directory (or wherever `DATABASE_URL` points), owned by the runtime user.
6. Run as a **non-root user**; the process needs write access only to the database volume.

---

## 7. Health checks & observability

- **`GET /api/health`** exists and is honest: it runs `SELECT 1` against the database and returns `503` with `{ok:false, db:"down"}` on failure, `200` with `{ok:true, db:"up", time}` otherwise. Use it for both liveness and readiness.
- Startup is slow enough (Next boot + Prisma client init) that readiness needs a grace period; start with `initialDelaySeconds: 15` / equivalent and tune.
- **There is no structured logging, no APM, no error tracker and no metrics endpoint.** Everything goes to `console.log`/`console.error` on stdout. For a first deployment, stdout collection into your log platform is adequate; flag Sentry (or equivalent) and structured JSON logging as fast-follow work.
- Log strings worth alerting on: `Streaming route failed:` (a stream ended in error behind a 200), `Could not decrypt <provider> credential` (indicates `AUTH_SECRET` drift — see §4).

---

## 8. External dependencies & egress

The container needs outbound HTTPS to:

| Host | Purpose | Failure mode |
|---|---|---|
| `api.deepseek.com` | All LLM calls | JD parsing, query generation and outreach all fail |
| `serpapi.com` | Metered search + key verification | Falls back to headless Chromium, or fails |
| `accounts.google.com` / `oauth2.googleapis.com` | OAuth sign-in | Nobody can log in |
| `www.google.com`, `duckduckgo.com` | Headless fallback SERP | Fallback unavailable |

If egress is restricted, allowlist these. The headless fallback also drives a real browser to arbitrary search-result pages — if that is unacceptable in your network, that is another argument for excluding Playwright (§6.4).

DeepSeek and SerpAPI are third-party processors receiving job-description text and search queries. Worth confirming that is covered by whatever data agreements apply.

---

## 9. Pre-deployment blockers and risks

Ordered by severity.

| # | Issue | Owner | Notes |
|---|---|---|---|
| 1 | **Next.js has unpatched critical advisories.** The project is already on `14.2.35`, the newest 14.x release — the remaining advisories have **no fix in the 14.x line**; `npm audit fix --force` proposes `next@16.3.4`, a two-major-version jump. | App team | 8 advisories total (7 high, 1 critical). Verified the app uses **no `next/image`** and only one trivial server action, so the Image-Optimizer RCE and Server-Action SSRF classes are not exercised by application code — but `/_next/image` and the Server-Action endpoints are served by the framework regardless of use. Mitigations until upgraded: block `/_next/image*` at the proxy, and keep the app behind authenticated access. **Plan the Next 15/16 upgrade as a scheduled piece of work, not a `--force` in CI.** |
| 2 | **`instrumentationHook` disabled → FK cascades and busy-timeout inactive** (§3.2). Silent data-integrity bug on a fresh production DB. | App team | One-line `next.config.js` change. Deliberately not applied here. |
| 3 | **No Dockerfile / no CI / no CD.** Nothing is automated today. | DevOps | §6 and §10. |
| 4 | **No production migration script or release step.** | Either | Add `db:deploy`, wire into the release. |
| 5 | **SQLite ⇒ single instance, no HA, stateful volume.** | Joint | Accept for v1, or plan Postgres. Decide before writing the Dockerfile. |
| 6 | **`AUTH_SECRET` rotation destroys stored user API keys.** | DevOps | Document it in the runbook; exclude this secret from any automatic rotation policy. |
| 7 | **No backup or restore procedure.** DB holds encrypted third-party API keys and candidate personal data. | DevOps | WAL-aware snapshots; test a restore. |
| 8 | **Node version disagreement** (`.nvmrc` 24 vs `engines >=20.9`). | Either | Pick one. |
| 9 | `BRAVE_SEARCH_KEY` configured but unused — a secret provisioned for nothing. | Either | Drop it. |
| 10 | No rate limiting on any route. LLM and SERP calls cost real money per request. | Joint | Per-user limits at the proxy or in-app; sign-in is domain-restricted, which caps exposure but not abuse by a valid user. |
| 11 | **Background search runs need a non-suspending server** (§3.4), and nothing sweeps runs orphaned by a restart. | Joint | Rules out serverless without a queue. Add a periodic job marking stale `running` rows failed, and a per-user concurrent-run cap. |

---

## 10. Suggested CI/CD shape

Nothing here is implemented — this is a starting proposal, not a description of what exists.

### CI (on every PR and push to `main`)

```
npm ci                      # postinstall runs prisma generate
npx prisma validate
npx tsc --noEmit            # verified passing
npm run lint                # verified passing
npm run build               # verified passing
npm audit --omit=dev        # report; do NOT auto-fix (see blocker #1)
```

All four build checks pass today, so CI can be gating from day one.

### E2E

`npm run test:e2e` (`scripts/e2e.ts`) is a real, substantial Playwright suite: it seeds a QA user and an Auth.js **database session row**, sets the `authjs.session-token` cookie directly to bypass Google OAuth, drives the full flow against a production server on port 3100, then cleans up after itself.

To run it in CI you need:

- a built app running on `E2E_BASE` (defaults to `http://localhost:3100`),
- `DATABASE_URL` and `AUTH_SECRET` injected (it reads `.env.local` if present and tolerates its absence — the script explicitly comments "fine for CI where env is injected"),
- Playwright browsers installed (`npx playwright install --with-deps chromium`),
- a **disposable database** — it writes real rows into whatever `DATABASE_URL` points at.

It writes screenshots to `scripts/.e2e-shots/` (gitignored) — useful CI artifacts. Note it exercises the SERP fallback path and expects **0 indexed results**, so it does not require live API keys.

### CD

Given §3.1, the deployment is a **single-instance, stateful rollout**, not a rolling one:

```
1. snapshot the database volume
2. build + push image (tagged with the commit SHA)
3. stop the running container            # brief downtime is unavoidable on one volume
4. npx prisma migrate deploy
5. start the new container
6. poll GET /api/health until {ok:true}
7. rollback = previous image tag + volume snapshot
```

Blue/green and zero-downtime rollouts require moving off SQLite first. In-flight searches (up to 180 s) are lost on restart — deploy in a low-usage window or add a drain period.

Recommended environments: **staging** (own Google OAuth client, own volume, own `AUTH_SECRET`) and **production**. Do not share `AUTH_SECRET` or the OAuth client between them.

---

## 11. Open decisions for the DevOps team

1. **SQLite + volume, or migrate to Postgres before launch?** Everything else in the topology follows from this.
2. **Ship Chromium in the image, or require every user to bring a SerpAPI key?** ~400 MB and an unsandboxed browser vs. a degraded free tier.
3. **Hosting target** — VM + Docker, ECS/Fargate with EFS, Fly.io volume, Kubernetes StatefulSet? All workable; serverless is not.
4. **Where do secrets come from** at runtime, and who holds the "never rotate this" note on `AUTH_SECRET`?
5. **Backup RPO/RTO** for a database containing encrypted third-party API keys and candidate personal data.
6. **Who owns the Next.js 15/16 upgrade**, and does it gate the first production deploy or follow it?

---

*Questions on application behaviour go to the app owner; this document describes the tree at commit `72a6390` and does not change it.*
