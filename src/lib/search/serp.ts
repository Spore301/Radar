import { executePlaywrightXRaySearch } from './playwrightSearch';

// ---------------------------------------------------------------------------
// SERP provider — runs ONE X-Ray query string against a search engine and
// returns every organic result it indexed. No filtering, no scoring, no
// profile fetching happens here: the indexer (serpIndexer.ts) decides what a
// result becomes, and the caller runs each query in the bundle individually.
//
// Providers: each Google-results API (SerpAPI, Serper) is an adapter in
// ./providers that fetches ONE page; this file is the provider-agnostic
// engine — retries, time budget, fallback between providers, paging and
// zero-result relaxation — so every provider follows the same rules.
//
// Depth: Google stopped honouring `num=100` in September 2025 and now serves
// 10 organic results per page, so "index every profile the SERP has" means
// paging: page 1, then the next page until a short page, no next page, no new
// URLs, a page that yields no candidate, the page cap, or the time budget.
// Every page is one credit; the outcome reports pages and credits so the run
// receipt shows exactly what was spent.
// ---------------------------------------------------------------------------

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Result thumbnail when the engine supplies one (SerpAPI does for many profiles). */
  thumbnail?: string | null;
  /** 1-based rank across all pages fetched for the query. */
  position?: number;
  // --- SHARED CONTRACT (providers fill, the indexer/facets read). Optional:
  // a provider that lacks a field leaves it undefined. Never synthesised.
  /**
   * Structured facts Google shows under the result, in order — for LinkedIn
   * usually ["Bengaluru, Karnataka, India", "Senior Engineer", "Acme"]
   * (SerpAPI `rich_snippet.top.extensions`, or the provider's equivalent).
   */
  extensions?: string[];
  /** The breadcrumb / display URL Google printed ("in.linkedin.com › in › jane"). */
  displayed_link?: string;
}

export type SerpProvider = 'serpapi' | 'serper' | 'google-headless' | 'duckduckgo-headless' | 'none';

export type { SerpEngine, SerpOptions } from './serpConfig';
export { SERP_PAGE_SIZE, DEFAULT_MAX_PAGES_PER_QUERY, HARD_MAX_PAGES_PER_QUERY, resolveSerpOptions } from './serpConfig';
import { SERP_PAGE_SIZE, resolveSerpOptions } from './serpConfig';
import type { SerpEngine, SerpOptions } from './serpConfig';
import { getAdapter, providerChain, providerOrder, ProviderError, toProviderError } from './providers';
import type { ProviderErrorKind, ProviderPage, SearchGeo, SearchProviderAdapter, SearchProviderId } from './providers';
import { createProviderRunState, isProviderDead, markProviderDead, type ProviderRunState } from './providers/runState';

/**
 * Attempts per page, and what a timeout does to them.
 *
 * A production run in Sep 2026 lost ~3 minutes per affected query: two
 * queries hit the previous 55 s timeout three times each, and each blocked one
 * of the three worker slots, stretching a 9-query run to nine minutes. A
 * timeout is Google being slow on that query shape, which retrying within the
 * same minute almost never fixes — so on page 1 a timeout gets one retry (or
 * none when a second provider can answer instead), on deeper pages none (the
 * pages already paid for are kept), while genuinely transient errors (rate
 * limits, 5xx, network) get two retries on page 1 and one on deeper pages.
 * The per-attempt timeout lives on each adapter (SerpAPI 40 s, Serper 15 s).
 */
const SERP_MAX_ATTEMPTS = 3;
const SERP_MAX_ATTEMPTS_AFTER_TIMEOUT = 2;
const DEEP_PAGE_MAX_ATTEMPTS = 2;
/** The headless fallback needs about this long (Google 10 s + DuckDuckGo 8 s). */
const HEADLESS_MIN_MS = 20_000;
const MAX_BACKOFF_MS = 10_000;

export interface SerpQueryOutcome {
  provider: SerpProvider;
  results: RawSearchResult[];
  /** SERP pages fetched for this query (1 when the engine returned everything at once). */
  pagesFetched: number;
  /** Metered calls spent (API providers only; headless fallbacks are free). */
  creditsUsed: number;
  /** Set when every provider failed (or the only configured one errored). */
  error?: string;
  /**
   * What the engine said about the result set — Google's own explanation for
   * an empty page ("Fully empty", a spelling fix, a total-results estimate) —
   * plus any relaxation, provider switch or early stop, so a query's receipt
   * row explains itself.
   */
  notice?: string;
  /** The string that actually ran, when it differs from the approved one (zero-result relaxation). */
  ranQuery?: string;
  /** Machine-readable reason for the receipt: 'relaxed' | 'fallback' | a ProviderErrorKind. */
  code?: string;
  /** A provider became unusable for the rest of the run while running this query. */
  fatal?: { provider: SearchProviderId; kind: ProviderErrorKind; message: string };
}

export interface SerpApiKeys {
  serpapi?: string | null;
  serper?: string | null;
  /** Unused; kept so older callers still type-check. */
  brave?: string | null;
}

export interface SerpQueryContext {
  /** Run-level provider latch shared by every query of the run. A fresh one per call when absent. */
  state?: ProviderRunState;
  /**
   * How many of a page's NEW results the indexer would keep. Paging stops at
   * the first page that yields none. Default: every new result counts.
   */
  keptCount?: (newResults: RawSearchResult[]) => number;
  /** Called at most once, when page 1 returns zero organic results: a relaxed string, or null. */
  relax?: () => string | null;
  /** Free headless Google/DuckDuckGo fallback when every metered provider failed. Default true. */
  headless?: boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface Clock {
  budgetEnd: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const sameQuery = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One page with bounded retries. Never throws; returns the page or the last
 * typed error. Every attempt's timeout is clipped to the query's budget, and
 * no attempt or backoff is started that could not finish inside it.
 */
async function fetchWithRetry(
  adapter: SearchProviderAdapter,
  apiKey: string,
  req: { query: string; page: number; geo: SearchGeo; engine: SerpEngine },
  opts: { firstPage: boolean; hasFallback: boolean },
  clock: Clock,
  log: string[]
): Promise<{ page?: ProviderPage; error?: ProviderError }> {
  let maxAttempts = opts.firstPage ? SERP_MAX_ATTEMPTS : DEEP_PAGE_MAX_ATTEMPTS;
  let last: ProviderError | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = clock.budgetEnd - clock.now();
    if (remaining < adapter.minAttemptMs) {
      if (!last) {
        last = new ProviderError(adapter.id, 'deadline', `${adapter.label} was not tried: no time left in this query's time budget`);
        log.push(last.message);
      }
      break;
    }
    const timeoutMs = Math.min(adapter.attemptTimeoutMs, remaining);
    try {
      return { page: await adapter.fetchPage({ ...req, timeoutMs }, apiKey) };
    } catch (raw) {
      let err = toProviderError(adapter.id, adapter.label, raw, timeoutMs);
      if (err.kind === 'rate_limited' && adapter.refineRateLimit) err = await adapter.refineRateLimit(apiKey, err);
      log.push(attempt === 0 ? err.message : `${err.message} (retry ${attempt})`);
      last = err;
      if (err.fatal || err.kind === 'bad_request') break;
      if (err.kind === 'timeout') {
        if (!opts.firstPage || opts.hasFallback) break;
        maxAttempts = Math.min(maxAttempts, SERP_MAX_ATTEMPTS_AFTER_TIMEOUT);
      }
      if (attempt >= maxAttempts - 1) break;
      const jitter = Math.random() * 1000;
      const backoff =
        err.kind === 'rate_limited' ? Math.min(MAX_BACKOFF_MS, err.retryAfterMs ?? (attempt + 1) * 3000 + jitter) : (attempt + 1) * 2000 + jitter;
      if (clock.now() + backoff + adapter.minAttemptMs > clock.budgetEnd) break;
      await clock.sleep(backoff);
    }
  }
  return { error: last ?? new ProviderError(adapter.id, 'upstream', `${adapter.label} failed`) };
}

/**
 * Runs a single query.
 *
 *   1. Metered providers, in the run's order (Serper / SerpAPI — whichever the
 *      recruiter has keys for). The next provider runs only when the previous
 *      one ERRORED; a legitimate zero-result page is an answer.
 *   2. Page 1 empty → one relaxed variant (ctx.relax), searched as part of
 *      the same query and counted against the same page cap.
 *   3. Paging stops at a short page, no next page, a page with no new URL, a
 *      page whose new results the indexer keeps none of, the page cap, or the
 *      query's time budget. A failed later page keeps the pages already paid.
 *   4. Headless Google, then DuckDuckGo, via Playwright — free fallback when
 *      there is no key or every metered provider failed.
 */
export async function runSerpQuery(queryString: string, keys: SerpApiKeys = {}, opts?: SerpOptions, ctx: SerpQueryContext = {}): Promise<SerpQueryOutcome> {
  const options = resolveSerpOptions(opts);
  const now = ctx.now ?? Date.now;
  const clock: Clock = {
    now,
    sleep: ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    budgetEnd: Math.min(now() + options.queryBudgetMs, options.stopAt || Number.POSITIVE_INFINITY),
  };
  const geo: SearchGeo = { gl: options.gl, hl: options.hl, googleDomain: options.googleDomain, location: options.location };
  const keyMap: Record<SearchProviderId, string | null> = { serpapi: keys.serpapi?.trim() || null, serper: keys.serper?.trim() || null };
  const chain = providerChain(keyMap, ctx.state ? [...ctx.state.chain] : providerOrder());
  const state = ctx.state ?? createProviderRunState(chain);

  const errors: string[] = [];
  let lastKind: ProviderErrorKind | undefined;
  let fatal: SerpQueryOutcome['fatal'];
  const noteFatal = (id: SearchProviderId, err: ProviderError) => {
    markProviderDead(state, id, err.kind, err.message);
    fatal = fatal ?? { provider: id, kind: err.kind, message: err.message };
  };

  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    if (isProviderDead(state, id)) continue;
    const adapter = getAdapter(id);
    const hasFallback = chain.slice(i + 1).some((other) => !isProviderDead(state, other));
    const log: string[] = [];
    const first = await fetchWithRetry(adapter, keyMap[id]!, { query: queryString, page: 0, geo, engine: options.engine }, { firstPage: true, hasFallback }, clock, log);

    if (first.page) {
      const paged = await pageThrough(adapter, keyMap[id]!, queryString, first.page, geo, options, clock, ctx, state, noteFatal);
      const fallbackNote = errors.length ? `Answered by ${adapter.label} after: ${errors.join('; ')}` : undefined;
      return {
        provider: id,
        results: paged.results,
        pagesFetched: paged.pages,
        creditsUsed: paged.credits,
        notice: [fallbackNote, ...paged.notices].filter(Boolean).join(' · ') || undefined,
        ranQuery: paged.ranQuery,
        code: paged.ranQuery ? 'relaxed' : errors.length ? 'fallback' : undefined,
        fatal,
      };
    }

    const err = first.error!;
    errors.push(...log);
    lastKind = err.kind;
    if (err.fatal) noteFatal(id, err);
  }

  if (lastKind === 'timeout') {
    errors.push('Google is slow on this query shape right now — try the run again later, or simplify the query');
  }
  // Started after every provider of the run had already died: say why.
  if (chain.length > 0 && errors.length === 0 && state.halted) {
    return { provider: 'none', results: [], pagesFetched: 0, creditsUsed: 0, error: state.halted.message, code: state.halted.kind };
  }

  // Free fallback: no key, or every metered provider failed.
  if (ctx.headless !== false && clock.budgetEnd - now() >= HEADLESS_MIN_MS) {
    try {
      const { results, provider } = await executePlaywrightXRaySearch(queryString);
      if (results.length > 0 || provider !== 'none') {
        // The row is "fetched" now, so the metered failure travels as the notice.
        const notice = errors.length ? `Answered by the free headless fallback after: ${errors.join('; ')}` : undefined;
        return { provider, results, pagesFetched: 1, creditsUsed: 0, error: errors[0], notice, code: lastKind, fatal };
      }
    } catch (err: any) {
      errors.push(err?.message || 'Headless search failed');
    }
  }

  return {
    provider: 'none',
    results: [],
    pagesFetched: 0,
    creditsUsed: 0,
    error: errors.join('; ') || 'No search provider returned results',
    code: fatal?.kind ?? lastKind,
    fatal,
  };
}

/** Pages one query on the provider that answered page 1. */
async function pageThrough(
  adapter: SearchProviderAdapter,
  apiKey: string,
  approved: string,
  firstPage: ProviderPage,
  geo: SearchGeo,
  options: Required<SerpOptions>,
  clock: Clock,
  ctx: SerpQueryContext,
  state: ProviderRunState,
  noteFatal: (id: SearchProviderId, err: ProviderError) => void
): Promise<{ results: RawSearchResult[]; pages: number; credits: number; notices: string[]; ranQuery?: string }> {
  const seen = new Set<string>();
  const all: RawSearchResult[] = [];
  const absorb = (page: RawSearchResult[]): RawSearchResult[] => {
    const added: RawSearchResult[] = [];
    for (const r of page) {
      const key = r.url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = { ...r, position: all.length + 1 };
      all.push(entry);
      added.push(entry);
    }
    return added;
  };
  const keptOf = (added: RawSearchResult[]) => (ctx.keptCount ? ctx.keptCount(added) : added.length);

  let query = approved;
  let ranQuery: string | undefined;
  let page = firstPage;
  let pages = 1;
  let credits = firstPage.credits;
  let pageIndex = 0; // index within the string currently being paged
  let added = absorb(page.results);
  let engineNotice = page.notice;
  let stopNote: string | undefined;
  let relaxNote: string | undefined;

  // Zero-result relaxation: one relaxed variant, same query, same receipt row.
  // The empty page already cost a credit, so it needs a page cap of 2+ to stay
  // inside what the recruiter confirmed (queries × depth).
  if (page.results.length === 0 && ctx.relax && options.maxPagesPerQuery >= 2) {
    let relaxed: string | null = null;
    try {
      relaxed = ctx.relax();
    } catch {
      relaxed = null;
    }
    if (typeof relaxed === 'string' && relaxed.trim() && !sameQuery(relaxed, approved) && !isProviderDead(state, adapter.id)) {
      const log: string[] = [];
      const r = await fetchWithRetry(adapter, apiKey, { query: relaxed.trim(), page: 0, geo, engine: options.engine }, { firstPage: true, hasFallback: false }, clock, log);
      if (r.page) {
        query = relaxed.trim();
        ranQuery = query;
        pages++;
        credits += r.page.credits;
        pageIndex = 0;
        page = r.page;
        added = absorb(page.results);
        relaxNote = `Approved query returned 0 results, so a relaxed version ran once — approved: ${approved}`;
        engineNotice = page.notice ?? engineNotice;
      } else {
        relaxNote = `Approved query returned 0 results; the relaxed retry failed: ${log.join('; ')}`;
        if (r.error?.fatal) noteFatal(adapter.id, r.error);
        return { results: all, pages, credits, notices: [relaxNote, engineNotice].filter((n): n is string => Boolean(n)) };
      }
    }
  }

  for (;;) {
    if (page.results.length === 0) break;
    // Page counts wobble (9 or 11 with filter=0), so "more than a page" is the
    // only length signal trusted; otherwise the provider's next-page signal decides.
    if (page.results.length > SERP_PAGE_SIZE || !page.hasNext) break;
    if (added.length === 0) break; // nothing new on this page
    if (keptOf(added) === 0) break; // yield: none of this page's new results became a candidate
    if (pages >= options.maxPagesPerQuery) break;
    if (isProviderDead(state, adapter.id)) break;
    if (clock.budgetEnd - clock.now() < adapter.minAttemptMs) {
      stopNote = `Stopped after page ${pages} to stay inside the time limit`;
      break;
    }
    const log: string[] = [];
    const r = await fetchWithRetry(adapter, apiKey, { query, page: pageIndex + 1, geo, engine: options.engine }, { firstPage: false, hasFallback: false }, clock, log);
    if (!r.page) {
      stopNote = `Stopped after page ${pages}: ${log.join('; ')}`;
      if (r.error?.fatal) noteFatal(adapter.id, r.error);
      break;
    }
    pages++;
    pageIndex++;
    credits += r.page.credits;
    page = r.page;
    added = absorb(page.results);
  }

  return { results: all, pages, credits, ranQuery, notices: [relaxNote, engineNotice, stopNote].filter((n): n is string => Boolean(n)) };
}
