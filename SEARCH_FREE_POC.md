# Free search POC — X-Ray without a SERP API

**Branch:** `feat/free-search-poc` (built on `fix/search-runs-export-agent-ui`). **Status:** experiment. Not for production.

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

## What was built

- `src/lib/search/browserSearch.ts` — one long-lived Playwright browser context against Bing:
  - Searches run one at a time, process-wide. Pages are spaced 1.5–3 s apart with jitter.
  - The context is replaced every 25 queries, or as soon as a bot check appears.
  - Google's query dialect is translated for Bing (`toBingQuery`). `intitle:("A" OR "B")` becomes `(intitle:"A" OR intitle:"B")`, and `AROUND(n)` is dropped.
  - Bing's `ck/a` redirect links are unwrapped to real profile URLs.
  - Paging uses `first=11, 21, …` up to the run's depth.
  - The `gl` country from the requisition maps to Bing's `cc` market.
  - Bot walls (captcha, 429, challenge text) are detected. DuckDuckGo in the same browser is the fallback.
- `SEARCH_PROVIDER` env (`src/lib/search/serpConfig.ts`):
  - `serpapi` (default): unchanged behaviour. The browser is used only if SerpAPI errors; it replaces the old captcha-walled headless-Google fallback.
  - `browser`: no SERP API at all. Runs start without a SerpAPI key and cost 0 credits. Receipts show provider `bing-headless`.
  - `auto`: SerpAPI when the user has a key, otherwise the browser.
- `scripts/free-search-probe.ts` — the harness for comparing result quality across real bundles (see below).

## How to try it

```bash
npx playwright install chromium   # or set PLAYWRIGHT_CHANNEL=msedge / chrome to use an installed browser
SEARCH_PROVIDER=browser PLAYWRIGHT_CHANNEL=msedge npm run dev
```

Then run a search as usual. To compare quality without the UI:

```bash
PLAYWRIGHT_CHANNEL=msedge npx tsx scripts/free-search-probe.ts
```

## Not yet measured

The full-bundle volume run was **not executed**. It is about 25 queries × 2 pages of automated Bing traffic, and the assistant's permission policy declined to run that many automated requests. Run `scripts/free-search-probe.ts` yourself if you want the numbers. Open questions it answers:

- How many queries a session survives before Bing challenges it.
- Profile yield per query across platforms, and how it compares with SerpAPI on the same bundle.

## Limits and risks — read before going further

1. **Terms of service.** Automated scraping of Bing's (or Google's) result pages violates their terms. They can throttle or block the IP at any time, without notice. This is acceptable for a short internal proof of concept. It is not acceptable as a product foundation.
2. **It cannot run on Vercel as is.** It needs a real Chromium (≈ 150–400 MB) and a long-lived process. Use the Docker/EC2 deployment, or a local machine. On Vercel, `browser` mode fails every query with "Headless search failed".
3. **Datacenter IPs fare worse.** These measurements came from a residential connection. Bing challenges cloud IP ranges much sooner.
4. **It is slow.** Searches are serialised with human pacing, about 3–6 s per page versus SerpAPI's parallel calls. A 10-query, 2-page run takes roughly 1–2 minutes.
5. **Bing ≠ Google.** The index and ranking differ, and Bing has no `AROUND`. Precision on long Boolean strings is lower, so expect more off-target results on broad queries.
6. **Legitimate free or cheap alternatives** to evaluate if the POC proves out: Brave Search API (has had a free tier), Google Programmable Search JSON API (small free daily quota, `site:` supported), or a self-hosted SearXNG. SearXNG scrapes the same engines, so it inherits the same blocking.
