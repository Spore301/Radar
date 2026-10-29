# free-browser-poc — X-Ray search without a SERP API

**Status:** experimental. **Not for production.** Implements the `SearchEngineModule` contract (`../types.ts`) as `freeBrowserPocEngine`, exported from `engine.ts`.

## Goal

Run RADR.'s X-Ray queries with no paid SERP API, to judge whether free search can work for a proof of concept.

## What was measured (2026-10-29, one residential connection in India, real X-Ray queries)

Each result was passed through the app's own indexer (`indexSerpResult`). "Profiles" means results that became candidate cards.

| Method | Outcome |
|---|---|
| DuckDuckGo HTML / Lite — plain HTTP | **Blocked**: HTTP 202 bot challenge on every query |
| Brave Search — plain HTTP | **Blocked**: HTTP 429 |
| Mojeek — plain HTTP | **Blocked**: HTTP 403 (0 results when allowed) |
| Startpage — plain HTTP | **Blocked**: challenge page |
| Yahoo — plain HTTP | **Failed**: HTTP 500 |
| Bing — plain HTTP | **Unusable**: HTTP 200, but the query is silently ignored and unrelated pages come back |
| Google — headless browser | **Blocked**: "unusual traffic" wall on the first query |
| DuckDuckGo — headless browser | **Weak**: 1 GitHub profile, 0 LinkedIn over 3 queries (operators largely ignored) |
| **Bing — headless browser, session warmed via the home page** | **Works.** Golang backend, Bengaluru: **10/10** LinkedIn profiles. Product designer, Pune: **6/10**. GitHub Golang/Kubernetes, Bangalore: **8/10**. |

The warm-up visit matters. Without Bing's cookies from its home page, the results page ignores the query.

## What's in `engine.ts`

- One long-lived Playwright browser context against Bing:
  - Searches run one at a time, process-wide. Pages are spaced 1.5–3 s apart with jitter.
  - The context is replaced every 25 queries, or as soon as a bot check appears.
  - Google's query dialect is translated for Bing (`toBingQuery`). `intitle:("A" OR "B")` becomes `(intitle:"A" OR intitle:"B")`, and `AROUND(n)` is dropped.
  - Bing's `ck/a` redirect links are unwrapped to real profile URLs.
  - Paging uses `first=11, 21, …` up to the run's depth.
  - The `gl` country from the requisition maps to Bing's `cc` market.
  - Bot walls (captcha, 429, challenge text) are detected. DuckDuckGo in the same browser is the fallback.
- `freeBrowserPocEngine`: the `SearchEngineModule` wrapper the registry sees (`id: 'free-browser-poc'`, `requiresApiKey: false`).

## How this engine is selected

`SEARCH_PROVIDER` env (read by `src/lib/search/serpConfig.ts`):

- `serpapi` (default): unchanged production behaviour. This engine is used only as a fallback when the production engine errors.
- `browser`: no SERP API at all. Runs start without a SerpAPI key and cost 0 credits. Receipts show provider `bing-headless` (or `duckduckgo-headless` on fallback).
- `auto`: the production engine when the user has a key, otherwise this one.

## How to try it

```bash
npx playwright install chromium   # or set PLAYWRIGHT_CHANNEL=msedge / chrome to use an installed browser
SEARCH_PROVIDER=browser PLAYWRIGHT_CHANNEL=msedge npm run dev
```

Then run a search as usual. To compare quality without the UI:

```bash
PLAYWRIGHT_CHANNEL=msedge npm run test:poc:free-browser
```

(runs `scripts/free-search-probe.ts`, which imports `freeBrowserPocEngine` from this folder.)

## Not yet measured

The full-bundle volume run was **not executed** as part of building this. It is about 25 queries × 2 pages of automated Bing traffic — run it yourself, by hand and sparingly, since it is against Bing's terms of service. Open questions it would answer:

- How many queries a session survives before Bing challenges it.
- Profile yield per query across platforms, and how it compares with the production engine on the same bundle.

## Limits and risks — read before going further

1. **Terms of service.** Automated scraping of Bing's (or Google's) result pages violates their terms. They can throttle or block the IP at any time, without notice. This is acceptable for a short internal proof of concept. It is not acceptable as a product foundation.
2. **It cannot run on Vercel as is.** It needs a real Chromium (≈ 150–400 MB) and a long-lived process. Use the Docker/EC2 deployment, or a local machine. On Vercel, `browser` mode fails every query with "Headless search failed".
3. **Datacenter IPs fare worse.** These measurements came from a residential connection. Bing challenges cloud IP ranges much sooner.
4. **It is slow.** Searches are serialised with human pacing, about 3–6 s per page versus SerpAPI's parallel calls. A 10-query, 2-page run takes roughly 1–2 minutes.
5. **Bing ≠ Google.** The index and ranking differ, and Bing has no `AROUND`. Precision on long Boolean strings is lower, so expect more off-target results on broad queries.
6. **Other free or cheap alternatives** worth a subfolder of their own, see `../google-cse-poc/` and `../brave-api-poc/` (not yet implemented). A self-hosted SearXNG was considered too, but it scrapes the same engines and so inherits the same blocking — not worth its own folder until one of the API-based options proves insufficient.
