# /pocs/ — search-engine proofs of concept

One subfolder per alternative to the production search engine (`/production/` at the repo root). Each subfolder here is a **complete, standalone proof of concept** — not a stub, not a plan, not a half-wired file. "Complete" means, at minimum:

1. **`engine.ts`** (or more) implementing the `SearchEngineModule` contract (`src/lib/search/searchEngine.ts`), so it can actually be registered and run inside the real app.
2. **`README.md`** stating the goal, what was measured (real queries, real numbers — not estimates), what was built, how to select it, and its limits and risks.
3. **A standalone runnable script** (e.g. `probe.ts`, run via `npm run test:poc:<name>`) that demonstrates the POC with real results, without needing to understand or drive the rest of the app.

A folder that only has an idea and a README — no working code — is a candidate, not a POC. Candidates live in the list at the bottom of this file, not as folders, until someone actually builds them.

## Before you start a new POC

**Ask first.** Don't create a new folder here, or start implementing one, without checking with the project owner that it's wanted. This applies every time — a new POC is work and (for anything that calls a live search engine) carries its own terms-of-service and cost considerations, so it's a decision to confirm, not to assume.

## How a POC plugs into the real app

`src/lib/search/serp.ts` is the only thing that decides which engine actually runs, via `src/lib/search/engineRegistry.ts`. A POC folder does nothing on its own until it's registered there:

```ts
// src/lib/search/engineRegistry.ts
import { yourPocEngine } from '@pocs/your-poc/engine';
export const SEARCH_ENGINES = { ...existing, [yourPocEngine.id]: yourPocEngine };
```

and, if it should be reachable via an env var, a case in `serp.ts`'s `SEARCH_PROVIDER` handling (see `src/lib/search/serpConfig.ts`). Nothing else in the app should import from `@pocs/*` directly — the registry is the one seam.

## Existing POCs

| Folder | Status | What it is |
|---|---|---|
| [`free-browser-poc/`](free-browser-poc/README.md) | experimental, working | X-Ray search via a headless Bing browser session, no paid API |

## Candidate future POCs (not started)

Ideas worth a complete POC one day, once confirmed with the project owner — not folders, just notes, until then:

- **Google Programmable Search JSON API** — official API (not scraping), `site:`/`filetype:` support, small free daily quota then paid. Would need a Google Cloud API key and a configured search engine ID (`cx`).
- **Brave Search API** — official, independent index, has had a free tier. This project already has an unused `brave` field on `SerpApiKeys` (`src/lib/search/serp.ts`) and a `BRAVE_SEARCH_KEY` env var flagged as dead config in `HANDOFF.md` — this POC would be the first thing to actually use either.
- **Self-hosted SearXNG** — considered, deprioritised: it scrapes the same engines `free-browser-poc` already tried, so it likely inherits the same blocking without adding information.
