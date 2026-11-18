import type { RawSearchResult } from '../serp';
import type { SerpEngine } from '../serpConfig';

// ---------------------------------------------------------------------------
// Search provider contract — one Google-results API behind one interface.
//
// An adapter knows how to fetch ONE page of ONE query from its API and how to
// turn that API's failures into a typed ProviderError. Everything else —
// paging, retries, budgets, fallback between providers, relaxation — lives in
// the provider-agnostic engine (serp.ts), so every provider gets the same
// reliability rules and the same receipt.
// ---------------------------------------------------------------------------

/** Metered Google-results APIs a recruiter can bring a key for. */
export type SearchProviderId = 'serpapi' | 'serper';

/**
 * Where the search is made from. Frozen per run at start (RunConfig), so a
 * resumed run searches from the same vantage point as the queries before it.
 */
export interface SearchGeo {
  /** Google `gl` country code ('in', 'uk', 'us'); '' = the provider's default vantage point. */
  gl: string;
  /** Google interface language. */
  hl: string;
  /** 'google.co.in'; '' = provider default (google.com). Google redirects ccTLDs to google.com since 2025, so this is informational. */
  googleDomain: string;
  /** Canonical Google location ('Bengaluru,Karnataka,India') for a city-bound role; '' otherwise. */
  location: string;
}

export interface PageRequest {
  query: string;
  /** 0-based page index (page 1 = 0). */
  page: number;
  geo: SearchGeo;
  /** SerpAPI engine; other providers ignore it. */
  engine: SerpEngine;
  /** Abort the HTTP call after this long. */
  timeoutMs: number;
}

export interface ProviderPage {
  results: RawSearchResult[];
  /** True when the provider says (or the page length implies) there is a next page. */
  hasNext: boolean;
  /** The engine's own account of the result set (why a page is empty, spelling fixes, totals). */
  notice?: string;
  /** Credits this call cost. */
  credits: number;
}

export type ProviderErrorKind =
  /** Account has no searches/credits left — fatal for this provider for the rest of the run. */
  | 'out_of_credits'
  /** The plan's hourly throughput is used up (SerpAPI) — seconds of backoff cannot clear it; fatal for the run. */
  | 'hourly_limit'
  /** Key rejected — fatal for this provider for the rest of the run. */
  | 'auth'
  /** Short-term rate limiting — back off and retry. */
  | 'rate_limited'
  | 'timeout'
  | 'network'
  /** 5xx, or the provider reported an error for this search. */
  | 'upstream'
  /** Response was not the JSON we expected. */
  | 'bad_response'
  /** The provider refused this particular request (400) — retrying the same request will not help. */
  | 'bad_request'
  /** The query's time budget ran out before this attempt could start. */
  | 'deadline';

const FATAL_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['out_of_credits', 'hourly_limit', 'auth']);

export class ProviderError extends Error {
  readonly provider: SearchProviderId;
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Server-suggested wait before retrying (Retry-After), when given. */
  readonly retryAfterMs?: number;

  constructor(provider: SearchProviderId, kind: ProviderErrorKind, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  /** The provider is unusable for the rest of the run (no credits, hourly cap, bad key). */
  get fatal(): boolean {
    return FATAL_KINDS.has(this.kind);
  }
}

export function isFatalKind(kind: ProviderErrorKind): boolean {
  return FATAL_KINDS.has(kind);
}

export interface SearchProviderAdapter {
  id: SearchProviderId;
  /** Recruiter-facing name ('SerpAPI', 'Serper'). */
  label: string;
  /** Per-attempt HTTP timeout. */
  attemptTimeoutMs: number;
  /**
   * No attempt starts with less time than this left in the query's budget:
   * a call cut off by the budget may still be billed by the provider while
   * the receipt counts nothing, so an attempt that is unlikely to finish is
   * not made at all.
   */
  minAttemptMs: number;
  /** Fetches one page. Throws ProviderError on any failure; an empty result set is NOT a failure. */
  fetchPage(req: PageRequest, apiKey: string): Promise<ProviderPage>;
  /**
   * Refines an ambiguous 429 with a free account lookup: out of credits,
   * hourly cap, or plain rate limiting. Returns the input when it cannot tell.
   */
  refineRateLimit?(apiKey: string, err: ProviderError): Promise<ProviderError>;
}

/** Reads a Retry-After header (seconds or HTTP date) as ms, capped. */
export function retryAfterMs(header: string | null, capMs = 10_000): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(capMs, secs * 1000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(capMs, Math.max(0, at - Date.now()));
  return undefined;
}

/** Maps a thrown fetch/abort error onto a ProviderError. */
export function toProviderError(provider: SearchProviderId, label: string, err: unknown, timeoutMs: number): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { name?: string; message?: string } | null;
  const name = String(e?.name ?? '');
  const message = String(e?.message ?? err ?? '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(message)) {
    return new ProviderError(provider, 'timeout', `${label} did not answer within ${Math.round(timeoutMs / 1000)} s`);
  }
  if (name === 'SyntaxError') return new ProviderError(provider, 'bad_response', `${label} returned a response that is not JSON`);
  return new ProviderError(provider, 'network', message ? `${label}: ${message}` : `${label} could not be reached`);
}
