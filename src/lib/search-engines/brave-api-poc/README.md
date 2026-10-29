# brave-api-poc — Brave Search API (not implemented)

**Status:** planned. No `engine.ts` exists yet in this folder, and it is not in `../registry.ts`. This is a scaffold, not a working engine — don't select it with `SEARCH_PROVIDER` yet.

## Idea

The [Brave Search API](https://brave.com/search/api/) is an official, paid-with-free-tier API (independent of Brave the browser) with its own index — not a Google proxy, so ranking and coverage differ. It supports `site:`, phrase and basic Boolean query syntax over HTTP JSON, with no scraping or bot-wall handling needed.

Note this project already has a half-wired, unused `brave` field in `SerpApiKeys` (`src/lib/search/serp.ts`) and a `BRAVE_SEARCH_KEY` env var that `HANDOFF.md` flags as dead config — building this engine would be the first thing to actually use either.

## Why it's worth building if the free-browser POC doesn't hold up

Official API (no terms-of-service risk), works from any host including Vercel, has had a free tier historically. The earlier plain-HTTP probe against `search.brave.com` (the consumer web page, not this API) returned `HTTP 429` — that tells us nothing about the API's own behaviour, which is a separate, authenticated endpoint.

## To build this

1. `engine.ts`: implement `SearchEngineModule` (see `../types.ts`). `run()` calls the Brave Search API's web-search endpoint with the query string and an `X-Subscription-Token` header, paging via `offset`.
2. Export `braveApiPocEngine` and add it to `../registry.ts`.
3. Add a `SEARCH_PROVIDER=brave` case in `src/lib/search/serp.ts`, and wire the existing (currently unused) `SerpApiKeys.brave` / `BRAVE_SEARCH_KEY`.
4. Measure it the same way `free-browser-poc` was measured: run `scripts/free-search-probe.ts` (or a copy pointed at this engine) against a handful of real bundles and record result/profile counts in this README, the way `../free-browser-poc/README.md` does.
