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
  /** Google interface language (`hl`). Default 'en'. */
  hl?: string;
  /** Google domain ('google.co.in'); '' = provider default. */
  googleDomain?: string;
  /**
   * Canonical Google location ('Bengaluru,Karnataka,India') for a city-bound
   * role; '' searches country-wide (or from the default vantage point).
   */
  location?: string;
  /**
   * Epoch ms after which no SERP call may still be running — set by a worker
   * under an invocation deadline, so a query stops paging (and keeps what it
   * has) instead of being killed mid-flight. 0 = no limit.
   */
  stopAt?: number;
  /**
   * Wall-clock budget for ONE query: every attempt, retry, fallback, extra
   * page and relaxation of that query must start and finish inside it. Bounds
   * a run's worst case at ceil(queries / concurrency) × budget.
   */
  queryBudgetMs?: number;
}

/** Google serves 10 organic results per page since it dropped `num=100` (Sept 2025). */
export const SERP_PAGE_SIZE = 10;
export const DEFAULT_MAX_PAGES_PER_QUERY = 5;
export const HARD_MAX_PAGES_PER_QUERY = 10;
/** Default per-query budget (see SerpOptions.queryBudgetMs). */
export const DEFAULT_QUERY_BUDGET_MS = 70_000;

export function resolveSerpOptions(opts?: SerpOptions): Required<SerpOptions> {
  const envEngine = typeof process !== 'undefined' && process.env?.SERP_ENGINE === 'google_light' ? 'google_light' : 'google';
  const envPages = parseInt((typeof process !== 'undefined' && process.env?.SERP_MAX_PAGES_PER_QUERY) || '', 10);
  const requested = opts?.maxPagesPerQuery ?? (Number.isFinite(envPages) && envPages > 0 ? envPages : DEFAULT_MAX_PAGES_PER_QUERY);
  return {
    engine: opts?.engine === 'google_light' || opts?.engine === 'google' ? opts.engine : envEngine,
    maxPagesPerQuery: Math.min(HARD_MAX_PAGES_PER_QUERY, Math.max(1, Math.floor(requested))),
    gl: typeof opts?.gl === 'string' && /^[a-z]{2}$/i.test(opts.gl) ? opts.gl.toLowerCase() : '',
    hl: typeof opts?.hl === 'string' && /^[a-z]{2}(-[a-z]{2})?$/i.test(opts.hl) ? opts.hl.toLowerCase() : 'en',
    googleDomain: typeof opts?.googleDomain === 'string' && /^google(\.[a-z]{2,3}){1,2}$/i.test(opts.googleDomain) ? opts.googleDomain.toLowerCase() : '',
    // eslint-disable-next-line no-control-regex
    location: typeof opts?.location === 'string' && opts.location.length <= 120 && !/[\u0000-\u001f]/.test(opts.location) ? opts.location.trim() : '',
    stopAt: typeof opts?.stopAt === 'number' && opts.stopAt > 0 ? opts.stopAt : 0,
    queryBudgetMs:
      typeof opts?.queryBudgetMs === 'number' && Number.isFinite(opts.queryBudgetMs) && opts.queryBudgetMs > 0
        ? Math.max(10_000, Math.min(300_000, Math.floor(opts.queryBudgetMs)))
        : DEFAULT_QUERY_BUDGET_MS,
  };
}

/** Country-code TLD from the location table → SerpAPI `gl` ('.co.uk' → 'uk', '.com' → 'us'). */
export function glFromTld(tld: string): string {
  if (!tld) return '';
  if (tld === '.com') return 'us';
  const last = tld.split('.').pop() ?? '';
  return /^[a-z]{2}$/.test(last) ? last : '';
}
