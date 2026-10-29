import type { SerpApiKeys, RawSearchResult, SerpProvider } from '../search/serp';
import type { SerpOptions } from '../search/serpConfig';

// ---------------------------------------------------------------------------
// The contract every search-engine subfolder implements.
//
// A "search engine" here is narrowly scoped: given one X-Ray query string, go
// get the raw organic results (title, url, snippet). Everything else — which
// templates build the query, which results are profile-shaped, how a profile
// is scored, how it's deduped and stored — is shared core code in
// src/lib/search/* and never varies between engines. See README.md in this
// directory for the full pattern and how to add a new POC.
// ---------------------------------------------------------------------------

export type SearchEngineKeys = SerpApiKeys;

/** Always the fully-resolved form (resolveSerpOptions already ran). */
export type SearchEngineOptions = Required<SerpOptions>;

export interface SearchEngineResult {
  provider: SerpProvider;
  results: RawSearchResult[];
  /** Pages fetched (credits spent, for a metered engine; 0 for a free one). */
  pagesFetched: number;
  creditsUsed: number;
  /** What the engine said about the result set, shown on the run receipt. */
  notice?: string;
}

export type SearchEngineStatus = 'production' | 'experimental' | 'planned';

export interface SearchEngineModule {
  /** Matches the subfolder name and the SEARCH_PROVIDER value that selects it, where applicable. */
  id: string;
  label: string;
  status: SearchEngineStatus;
  /** True when `run()` cannot do anything useful without keys.serpapi. */
  requiresApiKey: boolean;
  description: string;
  /**
   * Runs ONE query and returns its results, retrying internally if that's
   * this engine's own policy. Throws when the engine could not answer at
   * all; the caller (src/lib/search/serp.ts) decides what to try next.
   */
  run(query: string, keys: SearchEngineKeys, options: SearchEngineOptions): Promise<SearchEngineResult>;
}
