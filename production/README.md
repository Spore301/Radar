# production — SerpAPI (ships to users)

This folder, and `/pocs/` next to it, are the two root-level folders holding every search-engine implementation RADR. has. See [`/pocs/README.md`](../pocs/README.md) for the pattern both follow and how a new POC gets added.

**Status:** production. This is what every recruiter's search runs on unless `SEARCH_PROVIDER` picks something else.

## What it is

Runs each X-Ray query against Google through [SerpAPI](https://serpapi.com/), paged to the run's configured depth. One page (10 organic results) costs one SerpAPI credit; a recruiter brings their own key (BYOK), stored encrypted (`src/lib/credentials.ts`).

- `serpapi.ts` — the paging and parsing: one well-formed attempt at a full page walk, throws on failure.
- `index.ts` — `productionEngine`, the `SearchEngineModule` the registry (`src/lib/search/engineRegistry.ts`) sees. Owns the retry policy (up to 3 attempts with backoff) around `serpapi.ts`.

Both files are plain app code, imported from `src/lib/search/` via the `@production/*` path alias (see `tsconfig.json`) — this folder has no `package.json` of its own; it's not a separately installable package, just where this engine's implementation lives.

See [`SEARCH_ALGORITHM_BRIEF.md`](../SEARCH_ALGORITHM_BRIEF.md) at the repo root for the full search pipeline this engine sits inside (query generation, validation, indexing, scoring).

## Running the production suite against it

```bash
npm run test:production
```

This is the full app end-to-end suite (`scripts/e2e.ts`): seeds a QA user and session, drives the real UI (constraints form, query modal, a streamed search run) against a running production build, then verifies the dashboard, pipeline and settings. It checks that a run with no SerpAPI key is refused up front, then sets a deliberately invalid key and checks this engine's own error handling (the per-query receipt shows the SerpAPI failure) — it never spends a real credit. Point your own working key at a session via the Settings UI if you want to test the metered path end to end.

```bash
npm run build && npm start &   # or next start on :3100, see scripts/e2e.ts
npm run test:production
```
