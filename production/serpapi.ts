import type { RawSearchResult } from '@/lib/search/serp';
import type { SearchEngineOptions } from '@/lib/search/searchEngine';

// ---------------------------------------------------------------------------
// The SerpAPI call itself — paging, parsing, and reading back what Google
// said about the result set. No retry policy here (that's production/index.ts,
// the SearchEngineModule wrapper); this module just makes one well-formed
// attempt at the full page walk and throws on any failure.
// ---------------------------------------------------------------------------

interface SerpApiPage {
  results: RawSearchResult[];
  /** True when SerpAPI advertised a next page. */
  hasNext: boolean;
  /** Human-readable summary of `search_information` — why the page looks the way it does. */
  notice?: string;
}

/**
 * Turns SerpAPI's `search_information` into one short line. This is the only
 * thing that distinguishes "Google genuinely has nothing for this string"
 * from "Google returned results and we dropped them".
 */
function describeSearchInformation(data: any): string | undefined {
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

async function fetchSerpApiPage(
  queryString: string,
  apiKey: string,
  engine: SearchEngineOptions['engine'],
  start: number,
  num: number,
  gl = ''
): Promise<SerpApiPage> {
  const params = new URLSearchParams({
    engine,
    q: queryString,
    api_key: apiKey,
    num: String(num),
    start: String(start),
    hl: 'en',
    // Personalisation would make the same query index different profiles from
    // run to run; pin it off. Google's duplicate filter stays ON — the "similar"
    // results it hides are overwhelmingly low-quality duplicates, not profiles.
    safe: 'off',
    // Search from the requisition's country so local profiles rank first.
    ...(gl ? { gl } : {}),
  });

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    // SerpAPI runs a live Google search per call; 20–40 s is normal under load.
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    throw new Error(`SerpAPI HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    // SerpAPI reports "Google hasn't returned any results for this query." as
    // an error string on empty pages; that's an empty page, not a failure.
    if (/hasn't returned any results/i.test(String(data.error))) {
      return { results: [], hasNext: false };
    }
    throw new Error(`SerpAPI: ${data.error}`);
  }

  const organic: any[] = Array.isArray(data.organic_results) ? data.organic_results : [];
  const results = organic
    .filter((item) => item && typeof item.link === 'string' && item.link.startsWith('http'))
    .map((item) => ({
      title: String(item.title ?? '').trim(),
      url: item.link as string,
      snippet: String(item.snippet ?? item.rich_snippet?.top?.extensions?.join(' · ') ?? '').trim(),
      thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : null,
    }));

  return {
    results,
    hasNext: Boolean(data.serpapi_pagination?.next || data.pagination?.next),
    notice: describeSearchInformation(data),
  };
}

/**
 * Walks every page of one query on SerpAPI. Stops as soon as a page is short,
 * adds nothing new, or the cap is hit — so a query with 23 real results costs
 * 3 credits, not maxPages. One SerpAPI page = 10 organic results = 1 credit.
 */
export async function searchWithSerpApi(
  queryString: string,
  apiKey: string,
  options: SearchEngineOptions
): Promise<{ results: RawSearchResult[]; pagesFetched: number; creditsUsed: number; notice?: string }> {
  const SERP_PAGE_SIZE = 10;
  const seen = new Set<string>();
  const all: RawSearchResult[] = [];
  let pages = 0;

  const absorb = (page: RawSearchResult[]): number => {
    let added = 0;
    for (const r of page) {
      const key = r.url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...r, position: all.length + 1 });
      added++;
    }
    return added;
  };

  // Page 1. Google caps organic results at 10 per page since it dropped num=100;
  // asking for more only routes the request onto its slow path and times out.
  const first = await fetchSerpApiPage(queryString, apiKey, options.engine, 0, SERP_PAGE_SIZE, options.gl);
  const notice = first.notice;
  pages = 1;
  absorb(first.results);
  // Page counts wobble (9 or 11 with filter=0), so "more than a page" is the
  // only length signal we trust; otherwise SerpAPI's own next-page link decides.
  if (first.results.length > SERP_PAGE_SIZE || first.results.length === 0 || !first.hasNext) {
    return { results: all, pagesFetched: pages, creditsUsed: pages, notice };
  }

  // Google gave one ~10-result page: walk the rest with `start`.
  while (pages < options.maxPagesPerQuery) {
    // Under an invocation deadline, keep what we have rather than be killed mid-page.
    if (options.stopAt && Date.now() > options.stopAt) break;
    const page = await fetchSerpApiPage(queryString, apiKey, options.engine, pages * SERP_PAGE_SIZE, SERP_PAGE_SIZE, options.gl);
    pages++;
    const added = absorb(page.results);
    if (added === 0 || !page.hasNext) break;
  }

  return { results: all, pagesFetched: pages, creditsUsed: pages, notice };
}
