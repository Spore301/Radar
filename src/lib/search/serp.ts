import { executePlaywrightXRaySearch } from './playwrightSearch';

// ---------------------------------------------------------------------------
// SERP provider — runs ONE X-Ray query string against a search engine and
// returns every organic result it indexed. No filtering, no scoring, no
// profile fetching happens here: the indexer (serpIndexer.ts) decides what a
// result becomes, and the caller runs each query in the bundle individually.
//
// Depth: Google stopped honouring `num=100` in September 2025 and now serves
// 10 organic results per page, so "index every profile the SERP has" means
// paging. Each query first asks for 100 (free win if Google or the chosen
// engine ever honours it again), and when only a 10-result page comes back it
// walks `start=10, 20, …` until a short page, no new URLs, or the page cap.
// Every page is one SerpAPI credit; the outcome reports pages and credits so
// the run receipt shows exactly what was spent.
// ---------------------------------------------------------------------------

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Result thumbnail when the engine supplies one (SerpAPI does for many profiles). */
  thumbnail?: string | null;
  /** 1-based rank across all pages fetched for the query. */
  position?: number;
}

export type SerpProvider = 'serpapi' | 'google-headless' | 'duckduckgo-headless' | 'none';

export type { SerpEngine, SerpOptions } from './serpConfig';
export { SERP_PAGE_SIZE, DEFAULT_MAX_PAGES_PER_QUERY, HARD_MAX_PAGES_PER_QUERY, resolveSerpOptions } from './serpConfig';
import { SERP_PAGE_SIZE, resolveSerpOptions } from './serpConfig';
import type { SerpEngine, SerpOptions } from './serpConfig';

export interface SerpQueryOutcome {
  provider: SerpProvider;
  results: RawSearchResult[];
  /** SERP pages fetched for this query (1 when the engine returned everything at once). */
  pagesFetched: number;
  /** Metered calls spent (SerpAPI only; headless fallbacks are free). */
  creditsUsed: number;
  /** Set when every provider failed (or the only configured one errored). */
  error?: string;
}

export interface SerpApiKeys {
  serpapi?: string | null;
  brave?: string | null;
}

interface SerpApiPage {
  results: RawSearchResult[];
  /** True when SerpAPI advertised a next page. */
  hasNext: boolean;
}

async function fetchSerpApiPage(
  queryString: string,
  apiKey: string,
  engine: SerpEngine,
  start: number,
  num: number
): Promise<SerpApiPage> {
  const params = new URLSearchParams({
    engine,
    q: queryString,
    api_key: apiKey,
    num: String(num),
    start: String(start),
    hl: 'en',
    // Personalisation would make the same query index different profiles from
    // run to run; pin it off. Google's duplicate filter stays ON — the "similar"
    // results it hides are overwhelmingly low-quality duplicates, not profiles.
    safe: 'off',
  });

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`SerpAPI HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    // SerpAPI reports "Google hasn't returned any results for this query." as
    // an error string on empty pages; that's an empty page, not a failure.
    if (/hasn't returned any results/i.test(String(data.error))) {
      return { results: [], hasNext: false };
    }
    throw new Error(`SerpAPI: ${data.error}`);
  }

  const organic: any[] = Array.isArray(data.organic_results) ? data.organic_results : [];
  const results = organic
    .filter((item) => item && typeof item.link === 'string' && item.link.startsWith('http'))
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      url: item.link as string,
      snippet: String(item.snippet ?? item.rich_snippet?.top?.extensions?.join(' · ') ?? '').trim(),
      thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : null,
    }));

  return { results, hasNext: Boolean(data.serpapi_pagination?.next || data.pagination?.next) };
}

/**
 * Walks every page of one query on SerpAPI. Stops as soon as a page is short,
 * adds nothing new, or the cap is hit — so a query with 23 real results costs
 * 3 credits, not maxPages.
 */
async function searchWithSerpApi(
  queryString: string,
  apiKey: string,
  options: Required<SerpOptions>
): Promise<Omit<SerpQueryOutcome, 'provider' | 'error'>> {
  const seen = new Set<string>();
  const all: RawSearchResult[] = [];
  let pages = 0;

  const absorb = (page: RawSearchResult[]): number => {
    let added = 0;
    for (const r of page) {
      const key = r.url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...r, position: all.length + 1 });
      added++;
    }
    return added;
  };

  // Page 1: ask for 100. If the engine honours it we're done in one credit.
  const first = await fetchSerpApiPage(queryString, apiKey, options.engine, 0, 100);
  pages = 1;
  absorb(first.results);
  // Page counts wobble (9 or 11 with filter=0), so "more than a page" is the
  // only length signal we trust; otherwise SerpAPI's own next-page link decides.
  if (first.results.length > SERP_PAGE_SIZE || first.results.length === 0 || !first.hasNext) {
    return { results: all, pagesFetched: pages, creditsUsed: pages };
  }

  // Google gave one ~10-result page: walk the rest with `start`.
  while (pages < options.maxPagesPerQuery) {
    const page = await fetchSerpApiPage(queryString, apiKey, options.engine, pages * SERP_PAGE_SIZE, SERP_PAGE_SIZE);
    pages++;
    const added = absorb(page.results);
    if (added === 0 || !page.hasNext) break;
  }

  return { results: all, pagesFetched: pages, creditsUsed: pages };
}

/**
 * Runs a single query. Order of preference:
 *   1. SerpAPI (when a key is configured) — the metered "SERP index" the
 *      validator and credit estimate are built around, paged to depth.
 *   2. Headless Google, then headless DuckDuckGo, via Playwright — free-tier
 *      fallback, used when there is no key or SerpAPI errored.
 */
export async function runSerpQuery(queryString: string, keys: SerpApiKeys = {}, opts?: SerpOptions): Promise<SerpQueryOutcome> {
  const errors: string[] = [];
  const options = resolveSerpOptions(opts);

  const serpKey = keys.serpapi?.trim();
  if (serpKey) {
    // One retry after a short pause: SerpAPI's per-second rate limit and the
    // occasional upstream timeout are transient, and a query that fails here
    // otherwise silently contributes nothing to the run.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const paged = await searchWithSerpApi(queryString, serpKey, options);
        return { provider: 'serpapi', ...paged };
      } catch (err: any) {
        const message = err?.message || 'SerpAPI failed';
        errors.push(attempt === 0 ? message : `${message} (after retry)`);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
      }
    }
  }

  try {
    const { results, provider } = await executePlaywrightXRaySearch(queryString);
    if (results.length > 0 || provider !== 'none') {
      return { provider, results, pagesFetched: 1, creditsUsed: 0, error: errors[0] };
    }
  } catch (err: any) {
    errors.push(err?.message || 'Headless search failed');
  }

  return {
    provider: 'none',
    results: [],
    pagesFetched: 0,
    creditsUsed: 0,
    error: errors.join('; ') || 'No search provider returned results',
  };
}
