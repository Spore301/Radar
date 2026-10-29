# google-cse-poc — Google Programmable Search (not implemented)

**Status:** planned. No `engine.ts` exists yet in this folder, and it is not in `../registry.ts`. This is a scaffold, not a working engine — don't select it with `SEARCH_PROVIDER` yet.

## Idea

Google's [Programmable Search Engine](https://programmablesearchengine.google.com/) JSON API (`customsearch.googleapis.com`) returns real Google results, with `site:`/`filetype:` support, through an official API rather than scraping a results page. Unlike `free-browser-poc`, this would not violate anyone's terms of service, but it is not free at volume:

- A small free daily quota (historically 100 queries/day), then paid per 1,000 queries.
- Needs a Google Cloud API key and a configured search engine ID (`cx`), both one-time setup.
- Results come as clean JSON — title, link, snippet, no HTML scraping or bot-wall handling needed.

## Why it's worth building if the free-browser POC doesn't hold up

It's legitimate (an official API, not scraped HTML), works from any host including Vercel, and needs none of `free-browser-poc`'s pacing/session/bot-wall machinery. The tradeoff is the free quota is small — useful for evaluation, not for replacing SerpAPI at a recruiter's normal volume unless paid.

## To build this

1. `engine.ts`: implement `SearchEngineModule` (see `../types.ts`). `run()` calls `customsearch.googleapis.com/customsearch/v1` with the query string, `key`, `cx`, and paging via `start` (10 results per page, same page-size contract as the production engine).
2. Export `googleCsePocEngine` and add it to `../registry.ts`.
3. Add a `SEARCH_PROVIDER=google-cse` case in `src/lib/search/serp.ts`, and the `GOOGLE_CSE_API_KEY` / `GOOGLE_CSE_CX` env vars it needs.
4. Measure it the same way `free-browser-poc` was measured: run `scripts/free-search-probe.ts` (or a copy pointed at this engine) against a handful of real bundles and record result/profile counts in this README, the way `../free-browser-poc/README.md` does.
