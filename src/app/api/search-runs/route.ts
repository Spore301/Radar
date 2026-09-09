import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getSession } from '@/lib/db/sessions';
import { listRunSnapshots } from '@/lib/db/searchRuns';
import { getProviderKey } from '@/lib/credentials';
import { startSearchRun } from '@/lib/search/runManager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/search-runs — starts a search in the background and returns its
 * run id straight away. Progress is read back from GET /api/search-runs, so
 * closing the overlay or leaving the page never cancels or loses a run.
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
  if (!(await getSession(jobId))) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  // The recruiter's own SerpAPI key (stored encrypted at onboarding / Settings)
  // pays for this run; the platform key is only a fallback. Refusing up front
  // beats nine queries that each silently return nothing.
  const serpapi = (await getProviderKey(session!.user.id, 'serpapi')) ?? process.env.SERPAPI_KEY ?? null;
  if (!serpapi) {
    return NextResponse.json({ error: 'No SerpAPI key on file. Add one in Settings before running a search.' }, { status: 400 });
  }

  const runId = await startSearchRun({
    jobId,
    userId: session!.user.id,
    constraints,
    queries,
    keys: { serpapi, deepseek: apiKeys?.deepseek ?? null },
    serpOptions,
  });

  return NextResponse.json({ runId, queriesTotal: queries.length }, { status: 202 });
}

/**
 * GET /api/search-runs — every run of this user's that is still going, plus
 * anything that finished in the last ten minutes. This is what the progress
 * popup polls, and what lets a fresh tab rebuild it after a reload.
 */
export async function GET() {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const runs = await listRunSnapshots(session!.user.id);
  return NextResponse.json({ runs });
}
