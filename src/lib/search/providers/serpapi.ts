import type { RawSearchResult } from '../serp';
import { SERP_PAGE_SIZE } from '../serpConfig';
import { ProviderError, retryAfterMs, toProviderError, type PageRequest, type ProviderPage, type SearchProviderAdapter } from './types';

// ---------------------------------------------------------------------------
// SerpAPI adapter (https://serpapi.com/search-api).
//
// Request and parsing are the pre-provider-interface behaviour of serp.ts,
// plus: the run's geography (gl / hl / google_domain / location), the shared
// RawSearchResult.extensions + displayed_link fields, and typed errors that
// read SerpAPI's error body instead of throwing a bare "HTTP 429".
//
// Errors (https://serpapi.com/api-status-and-error-codes): 401 invalid key;
// 429 is EITHER "Your account has run out of searches." OR the plan's hourly
// throughput (50/h on the free plan) — the body names only the first, so an
// ambiguous 429 is settled with the free, un-metered Account API
// (https://serpapi.com/account-api).
// ---------------------------------------------------------------------------

/** SerpAPI runs a live Google search per call; 5–20 s is normal, 30+ s rarely recovers within the minute. */
export const SERPAPI_ATTEMPT_TIMEOUT_MS = 40_000;

const LABEL = 'SerpAPI';

/**
 * Turns SerpAPI's `search_information` into one short line. This is the only
 * thing that distinguishes "Google genuinely has nothing for this string"
 * from "Google returned results and we dropped them".
 */
export function describeSearchInformation(data: any): string | undefined {
  const si = data?.search_information ?? {};
  const parts: string[] = [];
  if (typeof si.organic_results_state === 'string' && si.organic_results_state.trim()) {
    parts.push(si.organic_results_state.trim());
  }
  if (typeof si.total_results === 'number') {
    parts.push(`${si.total_results.toLocaleString('en-US')} total results`);
  }
  if (typeof si.spelling_fix === 'string' && si.spelling_fix.trim()) {
    parts.push(`Google corrected the spelling to "${si.spelling_fix.trim()}"`);
  }
  if (typeof data?.search_metadata?.status === 'string' && data.search_metadata.status !== 'Success') {
    parts.push(`status ${data.search_metadata.status}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  return out.length ? out : undefined;
}

/** One organic result → RawSearchResult. Pure; exported for tests. */
export function mapSerpApiOrganic(item: any): RawSearchResult | null {
  if (!item || typeof item.link !== 'string' || !item.link.startsWith('http')) return null;
  const extensions = stringList(item.rich_snippet?.top?.extensions);
  const out: RawSearchResult = {
    title: String(item.title ?? '').trim(),
    url: item.link as string,
    snippet: String(item.snippet ?? item.rich_snippet?.top?.extensions?.join(' · ') ?? '').trim(),
    thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : null,
  };
  if (extensions) out.extensions = extensions;
  if (typeof item.displayed_link === 'string' && item.displayed_link.trim()) out.displayed_link = item.displayed_link.trim();
  return out;
}

/** The query-string parameters for one page. Pure; exported for tests. */
export function serpApiParams(req: Pick<PageRequest, 'query' | 'page' | 'geo' | 'engine'>, apiKey: string): URLSearchParams {
  const { geo } = req;
  return new URLSearchParams({
    engine: req.engine,
    q: req.query,
    api_key: apiKey,
    num: String(SERP_PAGE_SIZE),
    start: String(req.page * SERP_PAGE_SIZE),
    hl: geo.hl || 'en',
    // Personalisation would make the same query index different profiles from
    // run to run; pin it off. Google's duplicate filter stays ON — the "similar"
    // results it hides are overwhelmingly low-quality duplicates, not profiles.
    safe: 'off',
    // Search from the requisition's country (and city, when the role is
    // city-bound) so local profiles rank first. `location` is a canonical
    // name from SerpAPI's Locations API; SerpAPI derives `gl` from it too.
    ...(geo.gl ? { gl: geo.gl } : {}),
    ...(geo.googleDomain ? { google_domain: geo.googleDomain } : {}),
    ...(geo.location ? { location: geo.location } : {}),
  });
}

function classifyHttpError(status: number, body: any, headers: Headers): ProviderError {
  const msg = typeof body?.error === 'string' ? body.error.trim() : '';
  const detail = msg ? `: ${msg.replace(/\.+$/, '')}` : '';
  if (status === 401 || /invalid api key/i.test(msg)) {
    return new ProviderError('serpapi', 'auth', `SerpAPI rejected the stored key${detail}. Replace it in Settings.`, { status });
  }
  if (status === 403) {
    return new ProviderError('serpapi', 'auth', `SerpAPI refused this account (HTTP 403)${detail}. Check the account at serpapi.com.`, { status });
  }
  if (status === 429) {
    if (/run out of searches/i.test(msg)) {
      return new ProviderError('serpapi', 'out_of_credits', 'Your SerpAPI account has run out of searches.', { status });
    }
    return new ProviderError('serpapi', 'rate_limited', `SerpAPI HTTP 429${detail}`, { status, retryAfterMs: retryAfterMs(headers.get('retry-after')) });
  }
  if (status === 400 || status === 404 || status === 410) {
    return new ProviderError('serpapi', 'bad_request', `SerpAPI HTTP ${status}${detail}`, { status });
  }
  return new ProviderError('serpapi', 'upstream', `SerpAPI HTTP ${status}${detail}`, { status });
}

async function fetchPage(req: PageRequest, apiKey: string): Promise<ProviderPage> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`https://serpapi.com/search.json?${serpApiParams(req, apiKey).toString()}`, {
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    throw toProviderError('serpapi', LABEL, err, req.timeoutMs);
  }

  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!res.ok) throw classifyHttpError(res.status, data, res.headers);
  if (data === null || typeof data !== 'object') {
    throw new ProviderError('serpapi', 'bad_response', 'SerpAPI returned a response that is not JSON', { status: res.status });
  }

  if (data.error) {
    const msg = String(data.error);
    // SerpAPI reports "Google hasn't returned any results for this query." as
    // an error string on empty pages; that's an empty page, not a failure.
    if (/hasn't returned any results/i.test(msg)) {
      return { results: [], hasNext: false, notice: describeSearchInformation(data), credits: 1 };
    }
    if (/run out of searches/i.test(msg)) throw new ProviderError('serpapi', 'out_of_credits', 'Your SerpAPI account has run out of searches.');
    throw new ProviderError('serpapi', 'upstream', `SerpAPI: ${msg}`);
  }

  const organic: any[] = Array.isArray(data.organic_results) ? data.organic_results : [];
  const results = organic.map(mapSerpApiOrganic).filter((r): r is RawSearchResult => r !== null);
  return {
    results,
    hasNext: Boolean(data.serpapi_pagination?.next || data.pagination?.next),
    notice: describeSearchInformation(data),
    credits: 1,
  };
}

// --- Account API -------------------------------------------------------------

export interface SerpApiAccountSnapshot {
  planName?: string;
  searchesPerMonth?: number;
  planSearchesLeft?: number;
  /** Plan searches plus extra credits — what can still be spent. */
  totalSearchesLeft?: number;
  thisMonthUsage?: number;
  thisHourSearches?: number;
  hourlyLimit?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Free, un-metered account lookup. Throws on HTTP/auth failure. */
export async function fetchSerpApiAccount(apiKey: string, timeoutMs = 15_000): Promise<SerpApiAccountSnapshot> {
  const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey.trim())}`, { signal: AbortSignal.timeout(timeoutMs) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(typeof data?.error === 'string' ? data.error : `SerpAPI responded with HTTP ${res.status}`);
  }
  return {
    planName: typeof data.plan_name === 'string' ? data.plan_name : undefined,
    searchesPerMonth: num(data.searches_per_month),
    planSearchesLeft: num(data.plan_searches_left),
    totalSearchesLeft: num(data.total_searches_left) ?? num(data.plan_searches_left),
    thisMonthUsage: num(data.this_month_usage),
    thisHourSearches: num(data.this_hour_searches),
    hourlyLimit: num(data.account_rate_limit_per_hour),
  };
}

/**
 * Concurrent 429s in one run (three workers) share one account lookup; a
 * fresh lookup is made once the last one is a few seconds old, because the
 * hourly counter moves.
 */
const accountLookups = new Map<string, { at: number; promise: Promise<SerpApiAccountSnapshot | null> }>();
const ACCOUNT_LOOKUP_TTL_MS = 5_000;

/** Pure: what an account snapshot says about a 429. Exported for tests. */
export function classifySerpApi429(account: SerpApiAccountSnapshot | null, original: ProviderError): ProviderError {
  if (!account) return original;
  if (typeof account.totalSearchesLeft === 'number' && account.totalSearchesLeft <= 0) {
    return new ProviderError('serpapi', 'out_of_credits', 'Your SerpAPI account has run out of searches.', { status: original.status });
  }
  if (typeof account.thisHourSearches === 'number' && typeof account.hourlyLimit === 'number' && account.hourlyLimit > 0 && account.thisHourSearches >= account.hourlyLimit) {
    return new ProviderError(
      'serpapi',
      'hourly_limit',
      `Your SerpAPI plan's hourly limit (${account.hourlyLimit.toLocaleString('en-US')} searches per hour) is used up.`,
      { status: original.status }
    );
  }
  return original;
}

async function refineRateLimit(apiKey: string, err: ProviderError): Promise<ProviderError> {
  if (err.kind !== 'rate_limited') return err;
  const now = Date.now();
  let entry = accountLookups.get(apiKey);
  if (!entry || now - entry.at > ACCOUNT_LOOKUP_TTL_MS) {
    entry = { at: now, promise: fetchSerpApiAccount(apiKey, 5_000).catch(() => null) };
    accountLookups.set(apiKey, entry);
  }
  return classifySerpApi429(await entry.promise, err);
}

/** Test hook: forget cached account lookups. */
export function resetSerpApiAccountCache(): void {
  accountLookups.clear();
}

export const serpApiAdapter: SearchProviderAdapter = {
  id: 'serpapi',
  label: LABEL,
  attemptTimeoutMs: SERPAPI_ATTEMPT_TIMEOUT_MS,
  // 5–20 s is a normal SerpAPI answer; starting one with less left mostly buys a billed timeout.
  minAttemptMs: 20_000,
  fetchPage,
  refineRateLimit,
};
