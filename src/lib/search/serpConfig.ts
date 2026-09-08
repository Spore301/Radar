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
  };
}
