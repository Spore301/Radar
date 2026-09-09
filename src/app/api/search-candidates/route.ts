import { NextRequest, NextResponse } from 'next/server';
import { executeXRaySearch } from '@/lib/search/x-raySearchService';
import { resolveSerpOptions } from '@/lib/search/serpConfig';
import { requireSession } from '@/lib/session';
import { getSession, recordSearchRun, updateSession } from '@/lib/db/sessions';
import { getProviderKey } from '@/lib/credentials';
import { ndjsonResponse } from '@/lib/api/ndjson';

// Up to 16 individually-searched queries; SerpAPI runs finish in seconds, but
// the headless-browser fallback can take ~20s per query at 4-way concurrency.
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

/**
 * POST /api/search-candidates — streams NDJSON progress.
 *
 * Events: `start` (query count) → `query_start` / `query_done` per individually
 * searched query → `stage: storing` → `done` with the session's stored
 * candidate list (database ids), stats and the per-query receipt.
 *
 * Persistence is unchanged from the JSON version: the run header, one receipt
 * row per query, and an upsert of every indexed profile that never overwrites
 * the recruiter's shortlist / notes.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const { jobId, constraints, queries, apiKeys, serpOptions } = body ?? {};

  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json({ error: 'A session id (jobId) is required — start from a parsed JD.' }, { status: 400 });
  }
  if (!constraints || !Array.isArray(queries) || queries.length === 0) {
    return NextResponse.json({ error: 'Missing constraints or query bundle parameters' }, { status: 400 });
  }
  const existing = await getSession(jobId);
  if (!existing) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  // The recruiter's own SerpAPI key (stored encrypted at onboarding / Settings)
  // pays for this run; the platform key is only a fallback. Refusing up front
  // beats nine queries that each silently return nothing.
  const serpapi = (await getProviderKey(session!.user.id, 'serpapi')) ?? process.env.SERPAPI_KEY ?? null;
  if (!serpapi) {
    return NextResponse.json({ error: 'No SerpAPI key on file. Add one in Settings before running a search.' }, { status: 400 });
  }

  return ndjsonResponse(async (emit) => {
    // Persist what is about to run so the receipt and the bundle agree even if
    // the run itself is interrupted.
    await updateSession(jobId, { merged_constraints: constraints, query_bundle: queries, status: 'searching' });

    emit({ type: 'start', total: queries.length });

    const result = await executeXRaySearch(jobId, constraints, queries, { serpapi, deepseek: apiKeys?.deepseek ?? null }, resolveSerpOptions(serpOptions), {
      onQueryStart: (q, index, total) =>
        emit({ type: 'query_start', queryId: q.id, platform: q.platform, queryType: q.query_type, index, total }),
      onQueryDone: (r, done, total, indexedSoFar) => emit({ type: 'query_done', result: r, done, total, indexedSoFar }),
    });

    emit({ type: 'stage', key: 'storing', label: `Storing ${result.candidates.length} profiles to the session…` });
    const { runId, candidates } = await recordSearchRun(jobId, session!.user.id, result, constraints.results_cap ?? 50);

    const strong = candidates.filter((c) => c.match_score >= 70).length;
    const potential = candidates.filter((c) => c.match_score >= 40 && c.match_score < 70).length;

    return {
      success: true,
      runId,
      candidates,
      stats: {
        ...result.stats,
        // Stored totals: this run's new profiles plus ones earlier runs found.
        deduplicated: candidates.length,
        strong,
        potential,
        low: candidates.length - strong - potential,
      },
      queryResults: result.queryResults,
    };
  });
}
