import { CandidatePlatform, CandidateProfile, MergedConstraints, XRayQuery } from '../types';
import { deduplicateCandidates } from '../utils/deduplication';
import { isKnownPlatform, normalizePlatform } from './platforms';
import { indexSerpResult } from './serpIndexer';
import { runSerpQuery, SerpApiKeys, SerpOptions, SerpProvider } from './serp';

// ---------------------------------------------------------------------------
// X-Ray search orchestrator.
//
// Contract:
//   * Every query in the bundle is searched INDIVIDUALLY (its own SERP call,
//     its own outcome record) — never merged into one mega-query.
//   * Every profile the SERP indexed is kept. Relevance is scored and attached
//     for sorting, but a low score never removes a profile from the result set;
//     only non-profile URLs (job posts, company pages) and exact-duplicate
//     profiles are removed.
//   * Nothing here fetches profile pages or checks liveness: a result that the
//     search engine has indexed is, by definition, indexed here too.
// ---------------------------------------------------------------------------

export interface QueryRunResult {
  queryId: string;
  platform: CandidatePlatform;
  queryType: string;
  queryString: string;
  status: 'completed' | 'failed' | 'skipped';
  provider: SerpProvider;
  /** Organic results the engine returned. */
  resultCount: number;
  /** Results that were profile-shaped and became candidates (pre-dedupe). */
  indexedCount: number;
  /** SERP pages walked for this query (see serp.ts — 10 results per page on Google). */
  pagesFetched: number;
  /** Metered SerpAPI calls spent on this query. */
  creditsUsed: number;
  error?: string;
}

export interface SearchStats {
  /** Every profile indexed across all queries, before cross-query dedupe. */
  total: number;
  /** Unique profiles shown in the dashboard. */
  deduplicated: number;
  strong: number;
  potential: number;
  low: number;
  queriesRun: number;
  queriesFailed: number;
  /** Total SerpAPI credits spent across the run. */
  creditsUsed: number;
}

export interface XRaySearchResult {
  candidates: CandidateProfile[];
  stats: SearchStats;
  queryResults: QueryRunResult[];
}

/** How many SERP calls are in flight at once. SerpAPI tolerates this comfortably; headless Google does not want more. */
const SERP_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Drops queries whose platform isn't in the approved registry (e.g. a stale
 * saved job that still targets a retired board) and coerces loose platform
 * spellings to canonical ids. Reported back as 'skipped' so the run receipt
 * shows what was not searched and why.
 */
function sanitizeQueries(queries: XRayQuery[]): { runnable: XRayQuery[]; skipped: QueryRunResult[] } {
  const runnable: XRayQuery[] = [];
  const skipped: QueryRunResult[] = [];
  for (const q of queries) {
    const platform = isKnownPlatform(q.platform) ? q.platform : normalizePlatform(q.platform);
    const queryString = (q.query_string || '').trim();
    if (!platform || !queryString) {
      skipped.push({
        queryId: q.id,
        platform: (platform ?? 'MultiSite') as CandidatePlatform,
        queryType: q.query_type || 'custom',
        queryString,
        status: 'skipped',
        provider: 'none',
        resultCount: 0,
        indexedCount: 0,
        pagesFetched: 0,
        creditsUsed: 0,
        error: !platform ? `"${q.platform}" is not an available X-Ray platform.` : 'Empty query string.',
      });
      continue;
    }
    runnable.push({ ...q, platform, query_string: queryString, query_type: q.query_type || 'custom' });
  }
  return { runnable, skipped };
}

/** Progress hooks for the streaming search route — one call per query start / finish. */
export interface SearchProgressHooks {
  onQueryStart?: (query: XRayQuery, index: number, total: number) => void;
  onQueryDone?: (result: QueryRunResult, done: number, total: number, indexedSoFar: number) => void;
}

export async function executeXRaySearch(
  jobId: string,
  constraints: MergedConstraints,
  queries: XRayQuery[],
  apiKeys?: SerpApiKeys & { deepseek?: string | null },
  serpOptions?: SerpOptions,
  hooks?: SearchProgressHooks
): Promise<XRaySearchResult> {
  const keys: SerpApiKeys = {
    serpapi: apiKeys?.serpapi || process.env.SERPAPI_KEY,
    brave: apiKeys?.brave || process.env.BRAVE_SEARCH_KEY,
  };

  const { runnable, skipped } = sanitizeQueries(queries);
  const total = runnable.length;
  let doneCount = 0;
  let indexedSoFar = 0;

  const perQuery = await mapWithConcurrency(runnable, SERP_CONCURRENCY, async (q, index): Promise<{
    outcome: QueryRunResult;
    candidates: CandidateProfile[];
  }> => {
    hooks?.onQueryStart?.(q, index, total);
    const finish = (entry: { outcome: QueryRunResult; candidates: CandidateProfile[] }) => {
      doneCount++;
      indexedSoFar += entry.candidates.length;
      hooks?.onQueryDone?.(entry.outcome, doneCount, total, indexedSoFar);
      return entry;
    };
    try {
      const serp = await runSerpQuery(q.query_string, keys, serpOptions);
      const candidates: CandidateProfile[] = [];
      for (const res of serp.results) {
        const cand = indexSerpResult(res, q, constraints, jobId);
        if (cand) candidates.push(cand);
      }
      const failed = serp.provider === 'none';
      return finish({
        outcome: {
          queryId: q.id,
          platform: q.platform,
          queryType: q.query_type,
          queryString: q.query_string,
          status: failed ? 'failed' : 'completed',
          provider: serp.provider,
          resultCount: serp.results.length,
          indexedCount: candidates.length,
          pagesFetched: serp.pagesFetched,
          creditsUsed: serp.creditsUsed,
          error: failed ? serp.error : undefined,
        },
        candidates,
      });
    } catch (err: any) {
      console.error(`X-Ray query ${q.id} (${q.platform}) failed:`, err);
      return finish({
        outcome: {
          queryId: q.id,
          platform: q.platform,
          queryType: q.query_type,
          queryString: q.query_string,
          status: 'failed',
          provider: 'none',
          resultCount: 0,
          indexedCount: 0,
          pagesFetched: 0,
          creditsUsed: 0,
          error: err?.message || 'Unknown search error',
        },
        candidates: [],
      });
    }
  });

  // Preserve bundle order in the receipt so it lines up with the query modal.
  const queryResults: QueryRunResult[] = [...perQuery.map((r) => r.outcome), ...skipped];
  const indexedPool = perQuery.flatMap((r) => r.candidates);

  // Cross-query / cross-platform dedupe on canonical URL (+ conservative fuzzy
  // name match). This is the ONLY place a candidate can drop out after
  // indexing, and only because it is the same person already in the list.
  const deduplicated = deduplicateCandidates(indexedPool);

  // Default order is relevance, but that is presentation only — every entry
  // in `deduplicated` is returned regardless of score.
  deduplicated.sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name));

  const strong = deduplicated.filter((c) => c.match_score >= 70).length;
  const potential = deduplicated.filter((c) => c.match_score >= 40 && c.match_score < 70).length;
  const low = deduplicated.length - strong - potential;

  return {
    candidates: deduplicated,
    stats: {
      total: indexedPool.length,
      deduplicated: deduplicated.length,
      strong,
      potential,
      low,
      queriesRun: queryResults.filter((r) => r.status === 'completed').length,
      queriesFailed: queryResults.filter((r) => r.status !== 'completed').length,
      creditsUsed: queryResults.reduce((sum, r) => sum + r.creditsUsed, 0),
    },
    queryResults,
  };
}
