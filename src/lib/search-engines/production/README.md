# production — SerpAPI (ships to users)

**Status:** production. This is what every recruiter's search runs on unless `SEARCH_PROVIDER` picks something else (see `../README.md`).

## What it is

Runs each X-Ray query against Google through [SerpAPI](https://serpapi.com/), paged to the run's configured depth. One page (10 organic results) costs one SerpAPI credit; a recruiter brings their own key (BYOK), stored encrypted (`src/lib/credentials.ts`).

- `serpapi.ts` — the paging and parsing: one well-formed attempt at a full page walk, throws on failure.
- `index.ts` — `productionEngine`, the `SearchEngineModule` the registry sees. Owns the retry policy (up to 3 attempts with backoff) around `serpapi.ts`.

See [`SEARCH_ALGORITHM_BRIEF.md`](../../../../SEARCH_ALGORITHM_BRIEF.md) at the repo root for the full search pipeline this engine sits inside (query generation, validation, indexing, scoring).

## Running the production suite against it

```bash
npm run test:production
```

This is the full app end-to-end suite (`scripts/e2e.ts`): seeds a QA user and session, drives the real UI (constraints form, query modal, a streamed search run) against a running production build, then verifies the dashboard, pipeline and settings. It checks that a run with no SerpAPI key is refused up front, then sets a deliberately invalid key and checks this engine's own error handling (the per-query receipt shows the SerpAPI failure) — it never spends a real credit. Point your own working key at a session via the Settings UI if you want to test the metered path end to end.

```bash
npm run build && npm start &   # or next start on :3100, see scripts/e2e.ts
npm run test:production
```
