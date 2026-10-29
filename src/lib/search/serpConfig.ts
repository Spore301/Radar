// ---------------------------------------------------------------------------
// SERP depth configuration — pure module (no Playwright / Node imports) so the
// browser bundle (query modal, dashboard) can share these constants with the
// server-side provider in serp.ts.
// ---------------------------------------------------------------------------

/** SerpAPI engines that accept Google operators (site:, intitle:, AROUND) and `start` paging. */
export type SerpEngine = 'google' | 'google_light';

export interface SerpOptions {
  /** Which SerpAPI engine to hit. Default: SERP_ENGINE env or 'google'. */
  engine?: SerpEngine;
  /** Upper bound on pages (credits) per query. Default: SERP_MAX_PAGES_PER_QUERY env or 5. */
  maxPagesPerQuery?: number;
  /**
   * SerpAPI `gl` country code ('in', 'uk', 'de', …). Searching from the
   * requisition's country ranks local profiles higher; '' searches from
   * SerpAPI's default vantage point (remote / unknown location).
   */
  gl?: string;
  /**
   * Epoch ms after which no further SERP page is started — set by a worker
   * running under an invocation deadline, so a deep query stops paging (and
   * keeps what it has) instead of being killed mid-flight. 0 = no limit.
   */
  stopAt?: number;
}

/**
 * Which engine answers queries — SEARCH_PROVIDER env:
 *   'serpapi' (default) · 'browser' (EXPERIMENTAL: no SERP API, headless Bing)
 *   · 'auto' (SerpAPI with a key, else the browser).
 */
export type SearchMode = 'serpapi' | 'browser' | 'auto';

export function searchMode(): SearchMode {
  const v = typeof process !== 'undefined' ? (process.env?.SEARCH_PROVIDER ?? '').trim().toLowerCase() : '';
  return v === 'browser' || v === 'auto' ? v : 'serpapi';
}

/** True when a run cannot proceed without a SerpAPI key (the default mode). */
export function serpApiKeyRequired(): boolean {
  return searchMode() === 'serpapi';
}

/** Google serves 10 organic results per page since it dropped `num=100` (Sept 2025). */
export const SERP_PAGE_SIZE = 10;
export const DEFAULT_MAX_PAGES_PER_QUERY = 5;
export const HARD_MAX_PAGES_PER_QUERY = 10;

export function resolveSerpOptions(opts?: SerpOptions): Required<SerpOptions> {
  const envEngine = typeof process !== 'undefined' && process.env?.SERP_ENGINE === 'google_light' ? 'google_light' : 'google';
  const envPages = parseInt((typeof process !== 'undefined' && process.env?.SERP_MAX_PAGES_PER_QUERY) || '', 10);
  const requested = opts?.maxPagesPerQuery ?? (Number.isFinite(envPages) && envPages > 0 ? envPages : DEFAULT_MAX_PAGES_PER_QUERY);
  return {
    engine: opts?.engine === 'google_light' || opts?.engine === 'google' ? opts.engine : envEngine,
    maxPagesPerQuery: Math.min(HARD_MAX_PAGES_PER_QUERY, Math.max(1, Math.floor(requested))),
    gl: typeof opts?.gl === 'string' && /^[a-z]{2}$/i.test(opts.gl) ? opts.gl.toLowerCase() : '',
    stopAt: typeof opts?.stopAt === 'number' && opts.stopAt > 0 ? opts.stopAt : 0,
  };
}

/** Country-code TLD from the location table → SerpAPI `gl` ('.co.uk' → 'uk', '.com' → 'us'). */
export function glFromTld(tld: string): string {
  if (!tld) return '';
  if (tld === '.com') return 'us';
  const last = tld.split('.').pop() ?? '';
  return /^[a-z]{2}$/.test(last) ? last : '';
}
