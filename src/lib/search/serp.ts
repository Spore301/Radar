import { SEARCH_ENGINES } from '../search-engines/registry';

// ---------------------------------------------------------------------------
// SERP orchestrator — runs ONE X-Ray query string and returns every organic
// result an engine indexed. No filtering, no scoring, no profile fetching
// happens here: the indexer (serpIndexer.ts) decides what a result becomes,
// and the caller runs each query in the bundle individually.
//
// This module owns the POLICY (which engine to try, in what order, how to
// fall back) and the public types every caller shares. The actual fetching —
// SerpAPI's paging, or the experimental headless-browser search — lives one
// level up in src/lib/search-engines/<engine>/, each implementing the
// SearchEngineModule contract (src/lib/search-engines/types.ts). See
// src/lib/search-engines/README.md for the full pattern, including how to
// add another engine to test.
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

export type SerpProvider = 'serpapi' | 'bing-headless' | 'google-headless' | 'duckduckgo-headless' | 'none';

export type { SerpEngine, SerpOptions } from './serpConfig';
export { SERP_PAGE_SIZE, DEFAULT_MAX_PAGES_PER_QUERY, HARD_MAX_PAGES_PER_QUERY, resolveSerpOptions, searchMode } from './serpConfig';
import { resolveSerpOptions, searchMode } from './serpConfig';
import type { SerpOptions } from './serpConfig';

export interface SerpQueryOutcome {
  provider: SerpProvider;
  results: RawSearchResult[];
  /** SERP pages fetched for this query (1 when the engine returned everything at once). */
  pagesFetched: number;
  /** Metered calls spent (SerpAPI only; headless fallbacks are free). */
  creditsUsed: number;
  /** Set when every provider failed (or the only configured one errored). */
  error?: string;
  /**
   * What the engine said about the result set — Google's own explanation for
   * an empty page ("Fully empty", a spelling fix, a total-results estimate).
   * Captured so a 0-result query can explain itself in the run receipt
   * instead of being indistinguishable from a silently dropped one.
   */
  notice?: string;
}

export interface SerpApiKeys {
  serpapi?: string | null;
  brave?: string | null;
}

/**
 * Runs a single query. SEARCH_PROVIDER (see serpConfig.searchMode) decides:
 *   serpapi (default) — the production engine (SerpAPI), paged to depth; the
 *                       experimental engine only as a fallback when it errors.
 *   browser           — EXPERIMENTAL, no SERP API at all: see
 *                       src/lib/search-engines/free-browser-poc/.
 *   auto              — the production engine when there is a key, otherwise
 *                       the experimental one.
 */
export async function runSerpQuery(queryString: string, keys: SerpApiKeys = {}, opts?: SerpOptions): Promise<SerpQueryOutcome> {
  const errors: string[] = [];
  const options = resolveSerpOptions(opts);
  const mode = searchMode();

  if (keys.serpapi?.trim() && mode !== 'browser') {
    try {
      return await SEARCH_ENGINES.production.run(queryString, keys, options);
    } catch (err: any) {
      errors.push(err?.message || 'SerpAPI failed');
    }
  }

  try {
    const out = await SEARCH_ENGINES['free-browser-poc'].run(queryString, keys, options);
    return { ...out, error: errors[0] };
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
