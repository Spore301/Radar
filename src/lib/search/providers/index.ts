import { serpApiAdapter } from './serpapi';
import { serperAdapter } from './serper';
import type { SearchProviderAdapter, SearchProviderId } from './types';

// ---------------------------------------------------------------------------
// Provider registry and selection.
//
// Which providers a run uses is decided by the keys on file: a provider with
// no key never runs. With both keys, the first in the order below answers and
// the second is the fallback — used only when the first ERRORS (no credits,
// bad key, timeouts, 5xx), never when it legitimately returns zero results.
// ---------------------------------------------------------------------------

export * from './types';

const ADAPTERS: Record<SearchProviderId, SearchProviderAdapter> = {
  serpapi: serpApiAdapter,
  serper: serperAdapter,
};

export const SEARCH_PROVIDER_IDS: readonly SearchProviderId[] = ['serper', 'serpapi'];

export function getAdapter(id: SearchProviderId): SearchProviderAdapter {
  return ADAPTERS[id];
}

export { providerLabel } from './labels';

export function isSearchProviderId(value: unknown): value is SearchProviderId {
  return value === 'serpapi' || value === 'serper';
}

/**
 * Default order: Serper first (1–2 s per page, $1 per 1,000 vs SerpAPI's
 * 5–20 s and ~$15–25 per 1,000), SerpAPI as the fallback. Override with
 * SEARCH_PROVIDER_ORDER="serpapi,serper".
 */
export function providerOrder(env: string | undefined = typeof process !== 'undefined' ? process.env?.SEARCH_PROVIDER_ORDER : undefined): SearchProviderId[] {
  const fromEnv = (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(isSearchProviderId);
  const order = [...new Set(fromEnv)];
  for (const id of SEARCH_PROVIDER_IDS) if (!order.includes(id)) order.push(id);
  return order;
}

/** The providers this set of keys can run, in preference order. */
export function providerChain(keys: Partial<Record<SearchProviderId, string | null | undefined>>, order: SearchProviderId[] = providerOrder()): SearchProviderId[] {
  return order.filter((id) => typeof keys[id] === 'string' && (keys[id] as string).trim().length > 0);
}
