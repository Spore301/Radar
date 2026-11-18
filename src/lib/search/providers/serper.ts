import type { RawSearchResult } from '../serp';
import { SERP_PAGE_SIZE } from '../serpConfig';
import { ProviderError, retryAfterMs, toProviderError, type PageRequest, type ProviderPage, type SearchProviderAdapter } from './types';

// ---------------------------------------------------------------------------
// Serper adapter (https://serper.dev) — Google results, typically 1–2 s.
//
// POST https://google.serper.dev/search, `X-API-KEY` header, JSON body
// { q, gl, hl, location, num, page }. Response: { organic: [{ title, link,
// snippet, position, sitelinks?, attributes?, date? }], credits? }.
// The search body fields come from Serper's published spec mirror
// (apis.io/apis/serper); `location` is not in that mirror but is accepted per
// client libraries. Serper documents no pagination object and no displayed
// link, so `hasNext` is inferred from a full page and `displayed_link` stays
// undefined (never synthesised from the URL).
//
// Credits: deducted only for successful responses (serper.dev FAQ).
// ---------------------------------------------------------------------------

export const SERPER_ATTEMPT_TIMEOUT_MS = 15_000;

const LABEL = 'Serper';

/** Serper documents `gl` as ISO 3166-1 alpha-2; Google's legacy 'uk' is 'gb' there. */
export function serperGl(gl: string): string {
  return gl === 'uk' ? 'gb' : gl;
}

/**
 * Google shows ~10 organic results per page but dedupe sometimes trims one,
 * so a page of 9+ is treated as "there may be more". A short tail page costs
 * one cheap call; stopping early would lose profiles.
 */
export function serperHasNext(organicCount: number): boolean {
  return organicCount >= SERP_PAGE_SIZE - 1;
}

/** Attribute keys Google uses for query-match hints, not facts about the result. */
const NON_FACT_ATTRIBUTE = /^(missing|must include)\b/i;

/** One organic result → RawSearchResult. Pure; exported for tests. */
export function mapSerperOrganic(item: any): RawSearchResult | null {
  if (!item || typeof item.link !== 'string' || !item.link.startsWith('http')) return null;
  const out: RawSearchResult = {
    title: String(item.title ?? '').trim(),
    url: item.link as string,
    snippet: String(item.snippet ?? '').trim(),
    thumbnail: typeof item.imageUrl === 'string' ? item.imageUrl : null,
  };
  // `attributes` is Serper's equivalent of Google's structured result facts
  // (SerpAPI's rich_snippet extensions). Values only, in the order given.
  if (item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)) {
    const facts = Object.entries(item.attributes as Record<string, unknown>)
      .filter(([k, v]) => typeof v === 'string' && v.trim() && !NON_FACT_ATTRIBUTE.test(k))
      .map(([, v]) => (v as string).trim());
    if (facts.length) out.extensions = facts;
  }
  return out;
}

/** The JSON body for one page. Pure; exported for tests. */
export function serperBody(req: Pick<PageRequest, 'query' | 'page' | 'geo'>): Record<string, unknown> {
  const { geo } = req;
  return {
    q: req.query,
    num: SERP_PAGE_SIZE,
    page: req.page + 1,
    hl: geo.hl || 'en',
    ...(geo.gl ? { gl: serperGl(geo.gl) } : {}),
    ...(geo.location ? { location: geo.location.replace(/,/g, ', ') } : {}),
  };
}

function classifyHttpError(status: number, body: any, headers: Headers): ProviderError {
  const msg = typeof body?.message === 'string' ? body.message.trim() : typeof body?.error === 'string' ? body.error.trim() : '';
  const detail = msg ? `: ${msg.replace(/\.+$/, '')}` : '';
  if (/credit|balance|quota/i.test(msg) && !/rate/i.test(msg)) {
    return new ProviderError('serper', 'out_of_credits', 'Your Serper account has no credits left.', { status });
  }
  if (status === 401 || status === 403) {
    return new ProviderError('serper', 'auth', `Serper rejected the stored key${detail}. Replace it in Settings.`, { status });
  }
  if (status === 402) {
    return new ProviderError('serper', 'out_of_credits', 'Your Serper account has no credits left.', { status });
  }
  if (status === 429) {
    return new ProviderError('serper', 'rate_limited', `Serper HTTP 429${detail}`, { status, retryAfterMs: retryAfterMs(headers.get('retry-after')) });
  }
  if (status >= 400 && status < 500) return new ProviderError('serper', 'bad_request', `Serper HTTP ${status}${detail}`, { status });
  return new ProviderError('serper', 'upstream', `Serper HTTP ${status}${detail}`, { status });
}

async function fetchOnce(req: PageRequest, apiKey: string, timeoutMs: number): Promise<ProviderPage> {
  let res: Response;
  let text: string;
  try {
    res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(serperBody(req)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    throw toProviderError('serper', LABEL, err, timeoutMs);
  }

  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) throw classifyHttpError(res.status, data, res.headers);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ProviderError('serper', 'bad_response', 'Serper returned a response that is not JSON', { status: res.status });
  }

  const organic: any[] = Array.isArray(data.organic) ? data.organic : [];
  const results = organic.map(mapSerperOrganic).filter((r): r is RawSearchResult => r !== null);
  return {
    results,
    hasNext: serperHasNext(organic.length),
    credits: typeof data.credits === 'number' && Number.isFinite(data.credits) && data.credits >= 0 ? data.credits : 1,
  };
}

/**
 * One page. `location` is the one body field not in Serper's published spec,
 * so if Serper refuses a request that carried it (400), the page is asked
 * again once without it — country-wide via `gl` — and the receipt says so.
 * Serper bills only successful responses, so the refused call costs nothing.
 */
async function fetchPage(req: PageRequest, apiKey: string): Promise<ProviderPage> {
  const startedAt = Date.now();
  try {
    return await fetchOnce(req, apiKey, req.timeoutMs);
  } catch (err) {
    if (!(err instanceof ProviderError) || err.kind !== 'bad_request' || !req.geo.location) throw err;
    const left = req.timeoutMs - (Date.now() - startedAt);
    if (left < 2_000) throw err;
    const page = await fetchOnce({ ...req, geo: { ...req.geo, location: '' } }, apiKey, left);
    const note = `Serper did not accept the city location (${err.message}), so this page was searched country-wide`;
    return { ...page, notice: page.notice ? `${page.notice} · ${note}` : note };
  }
}

// --- Key verification --------------------------------------------------------

export interface SerperAccountCheck {
  ok: boolean;
  /** Credits left, when Serper reports them. */
  balance?: number;
  error?: string;
  /**
   * The key was not confirmed. With ok=false: Serper was down or unreachable —
   * try again rather than replace it. With ok=true: it passed the auth gate but
   * the account path gave no confirmation — store it without a verified stamp.
   */
  unverified?: boolean;
}

/**
 * Verifies a Serper key without spending a credit. Serper checks the key
 * before routing (an invalid key gets 403 "Unauthorized." on every path —
 * observed 2026-11-14), so any other 4xx from the account path means the key
 * passed; a 2xx with a balance reports it. The account endpoint is not in
 * Serper's public docs. A 5xx or a network failure judges nothing.
 */
export async function verifySerperKey(key: string, timeoutMs = 15_000): Promise<SerperAccountCheck> {
  try {
    const res = await fetch('https://google.serper.dev/account', {
      headers: { 'X-API-KEY': key.trim() },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: typeof data?.message === 'string' ? data.message : `Serper responded with HTTP ${res.status}` };
    }
    if (res.ok) {
      const balance = typeof data?.balance === 'number' ? data.balance : typeof data?.credits === 'number' ? data.credits : undefined;
      return { ok: true, balance };
    }
    // Another 4xx from this undocumented path: the key got past Serper's auth
    // gate, but nothing confirmed it — accept it, unverified, so it is stored
    // without a verification stamp and the first run is the real test.
    if (res.status >= 400 && res.status < 500) return { ok: true, unverified: true };
    return { ok: false, unverified: true, error: `Serper could not check the key right now (HTTP ${res.status}). Try again in a minute.` };
  } catch (err: any) {
    return {
      ok: false,
      unverified: true,
      error: err?.name === 'TimeoutError' ? 'Serper did not answer within 15 seconds. Try again in a minute.' : err?.message || 'Could not reach Serper.',
    };
  }
}

export const serperAdapter: SearchProviderAdapter = {
  id: 'serper',
  label: LABEL,
  attemptTimeoutMs: SERPER_ATTEMPT_TIMEOUT_MS,
  minAttemptMs: 5_000,
  fetchPage,
};
