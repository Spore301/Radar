# Search engines

Every way RADR. can go get raw results for one X-Ray query string, each in its own subfolder. This is the narrow, swappable part of search — see [`SEARCH_ALGORITHM_BRIEF.md`](../../../SEARCH_ALGORITHM_BRIEF.md) at the repo root for everything around it (query planning, validation, turning a result into a scored candidate, dedupe, storage), none of which varies between engines and all of which stays in `src/lib/search/`.

```
src/lib/search-engines/
  types.ts               the SearchEngineModule contract every subfolder implements
  registry.ts            SEARCH_ENGINES — every engine that is wired up and selectable
  production/             ships to users — SerpAPI
  free-browser-poc/       experimental — headless Bing, no paid API (SearchProvider=browser)
  google-cse-poc/         planned — README only, not implemented
  brave-api-poc/          planned — README only, not implemented
```

## The contract

```ts
interface SearchEngineModule {
  id: string;                 // matches the subfolder name
  label: string;
  status: 'production' | 'experimental' | 'planned';
  requiresApiKey: boolean;
  description: string;
  run(query: string, keys: SearchEngineKeys, options: SearchEngineOptions): Promise<SearchEngineResult>;
}
```

`run()` makes one query answer for itself — paging to `options.maxPagesPerQuery`, honouring `options.stopAt` (a worker running under an invocation deadline), applying whatever retry policy is this engine's own — and either returns a `SearchEngineResult` or throws. It never touches anything outside its own subfolder: no query building, no validation, no scoring, no database.

## Who decides which engine runs

`src/lib/search/serp.ts`'s `runSerpQuery()` is the only caller. It reads `SEARCH_PROVIDER` (`src/lib/search/serpConfig.ts`) and decides the *order* to try engines in:

| `SEARCH_PROVIDER` | Behaviour |
|---|---|
| `serpapi` (default) | `production` only; an experimental engine is tried as a fallback only if `production` throws |
| `browser` | `free-browser-poc` only — no SerpAPI key needed, 0 credits spent |
| `auto` | `production` when the caller has a SerpAPI key, otherwise `free-browser-poc` |

`registry.ts` only answers "what exists"; it has no opinion on ordering.

## Adding a new POC

1. `mkdir src/lib/search-engines/<name>` and write `engine.ts` implementing `SearchEngineModule` (status `'experimental'` until it's proven).
2. Write a `README.md`: what it is, why it might replace or complement what's there, and once you've run it, the same kind of measured results table as `free-browser-poc/README.md`. `google-cse-poc/README.md` and `brave-api-poc/README.md` are unimplemented scaffolds in this shape — start from one of those.
3. Export your module and add it to `SEARCH_ENGINES` in `registry.ts`.
4. If it should be reachable via `SEARCH_PROVIDER`, add a case in `src/lib/search/serp.ts`.
5. Add an `npm run test:poc:<name>` script if there's a standalone probe worth running without the full app (see `test:poc:free-browser` → `scripts/free-search-probe.ts`).

## Running the suites

```bash
npm run test:production        # the full app's e2e suite, exercising the production engine
npm run test:poc:free-browser  # standalone probe for the free-browser-poc engine, real queries, no app needed
```

`test:production` needs a running build (`npm run build && npm start`, see `scripts/e2e.ts`'s header). `test:poc:free-browser` needs only Playwright's browser and runs in a few minutes — see `free-browser-poc/README.md` before running it; it scrapes a live search engine and should be run by hand, sparingly.
