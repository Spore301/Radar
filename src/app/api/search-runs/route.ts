import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getSession } from '@/lib/db/sessions';
import { listRunSnapshots } from '@/lib/db/searchRuns';
import { checkSearchKey, resolveSearchKeys } from '@/lib/credentials';
import { providerChain, providerLabel } from '@/lib/search/providers';
import { resumeStalledRuns, startSearchRun } from '@/lib/search/runManager';

export const dynamic = 'force-dynamic';
// The search keeps working after the response (waitUntil in runManager), so
// the invocation must be allowed to live past it. A run longer than this is
// handed back at the deadline and resumed by the next poll of GET below.
export const maxDuration = 300;

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
  if (!(await getSession(jobId, session!.user.id))) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  // The recruiter's own search keys (SerpAPI and/or Serper, stored encrypted
  // at onboarding / Settings) pay for this run; the platform keys are used
  // only when the recruiter has none. Refusing up front beats nine queries
  // that each silently return nothing.
  const keys = await resolveSearchKeys(session!.user.id);
  const chain = providerChain(keys);
  if (chain.length === 0) {
    return NextResponse.json(
      { error: 'No SerpAPI key on file, and no Serper key either. Add one of them in Settings before running a search.', code: 'NO_SEARCH_KEY' },
      { status: 400 }
    );
  }

  // Free pre-flight (account endpoints cost no credit). An account with
  // nothing left (no searches this month, or the hourly cap used up) cannot
  // run anything: when every key is like that, refuse with the reason. A key
  // the provider REJECTS is different: the run starts and is closed out at
  // once, so the receipt records the rejection on every query (the contract
  // scripts/e2e.ts checks); with a second, working key it is simply skipped.
  const checks = await Promise.all(chain.map(async (id) => ({ id, ...(await checkSearchKey(id, keys[id]!)) })));
  const empty = checks.filter((c) => !c.usable && c.kind !== 'auth');
  if (empty.length === checks.length) {
    const reasons = empty.map((c) => c.reason ?? `${providerLabel(c.id)} has nothing left.`).join(' ');
    return NextResponse.json(
      { error: `No usable search key: ${reasons} Add searches or another key in Settings, then try again.`, code: 'NO_USABLE_SEARCH_KEY' },
      { status: 400 }
    );
  }

  try {
    const runId = await startSearchRun({
      jobId,
      userId: session!.user.id,
      constraints,
      queries,
      keys: { serpapi: keys.serpapi, serper: keys.serper, deepseek: apiKeys?.deepseek ?? null },
      // With a working key alongside, an unusable one is marked dead on the
      // run (remembered across resumes) and never called. When no key passed
      // the check, nothing is pre-marked: the first query records the
      // provider's own rejection on its receipt row and the run halts there.
      unusableProviders: checks.some((c) => c.usable)
        ? Object.fromEntries(
            checks.filter((c) => !c.usable).map((c) => [c.id, { kind: c.kind ?? 'out_of_credits', message: c.reason ?? `${providerLabel(c.id)} is not usable.` }])
          )
        : {},
      serpOptions,
    });
    return NextResponse.json({ runId, queriesTotal: queries.length }, { status: 202 });
  } catch (err: any) {
    // An unhandled throw here reaches the client as a bare "Request failed
    // (500)", which says nothing. Report what actually broke instead.
    console.error('Could not start a search run:', err);
    return NextResponse.json({ error: `The search could not be started: ${err?.message || 'unknown error'}` }, { status: 500 });
  }
}

/**
 * GET /api/search-runs — every run of this user's that is still going, plus
 * anything that finished in the last ten minutes. This is what the progress
 * popup polls, and what lets a fresh tab rebuild it after a reload.
 */
export async function GET() {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  try {
    // Polling is what keeps a serverless run moving: take over any run of this
    // user's whose worker went quiet, before reporting progress.
    await resumeStalledRuns(session!.user.id).catch((err) => console.error('Could not resume stalled runs:', err));
    const runs = await listRunSnapshots(session!.user.id);
    return NextResponse.json({ runs });
  } catch (err: any) {
    console.error('Could not list search runs:', err);
    return NextResponse.json({ error: `Run progress is unavailable: ${err?.message || 'unknown error'}` }, { status: 500 });
  }
}
