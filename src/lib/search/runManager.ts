import { getDeadline, waitUntil } from '@vercel/functions';
import { mapWithConcurrency, sanitizeQueries, searchOneQuery, SERP_CONCURRENCY } from './x-raySearchService';
import { resolveSerpOptions, serpApiKeyRequired } from './serpConfig';
import { queryLabel } from './xrayTemplates';
import { platformLabel } from './platforms';
import { locationScopeFor } from './locationScope';
import { validateBundle } from './queryValidation';
import {
  claimRun,
  createRunRow,
  failRun,
  finalizeRun,
  findStalledRuns,
  heartbeat,
  isAbortRequested,
  loadRunWork,
  markQueryDone,
  markQueryStart,
  recordResume,
  releaseRun,
} from '../db/searchRuns';
import { persistQueryCandidates, updateSession } from '../db/sessions';
import { getProviderKey } from '../credentials';
import { prisma } from '../db/client';
import type { SerpOptions } from './serpConfig';
import type { MergedConstraints, XRayQuery } from '../types';

// ---------------------------------------------------------------------------
// Background search worker — resumable, so it works on serverless hosts.
//
// startSearchRun() returns as soon as the run is on record; the search
// continues after the response. On a long-lived Node server (Docker) that is
// all it takes. On Vercel an invocation is frozen once it responds and killed
// at its time limit, so the worker is built to be interrupted:
//
//   * the work promise is registered with waitUntil(), which keeps the
//     invocation alive after the 202 up to the route's maxDuration;
//   * every query's profiles are stored the moment the query lands — nothing
//     waits in memory for the end of the run;
//   * the worker holds a lease (a heartbeat refreshed every few seconds) and
//     stops starting queries shortly before the invocation deadline, handing
//     the run back unfinished;
//   * any later poll of GET /api/search-runs (the progress popup polls every
//     1.5 s) takes over a run whose heartbeat has lapsed and carries on with
//     the queries still pending.
//
// All run state lives in the database, so which invocation finishes a run
// does not matter.
// ---------------------------------------------------------------------------

/** A heartbeat older than this means the worker is gone and the run may be taken over. */
const LEASE_MS = 45_000;
const HEARTBEAT_MS = 15_000;
/** Stop starting new queries when less than this is left before the invocation deadline. */
const START_CUTOFF_MS = 90_000;
/** And stop paging within a query when less than this is left. */
const PAGE_CUTOFF_MS = 45_000;
/** A run that keeps dying is failed rather than retried forever. */
const MAX_RESUMES = 12;

/** Runs being worked by this process, so a duplicate start/resume is a no-op. */
const inFlight = new Set<string>();

export interface StartRunInput {
  jobId: string;
  userId: string;
  constraints: MergedConstraints;
  queries: XRayQuery[];
  keys: { serpapi: string; deepseek?: string | null };
  serpOptions?: Partial<SerpOptions> | null;
}

/**
 * Records the run, kicks off the work, and returns the run id immediately.
 * The caller must not await the search itself.
 */
export async function startSearchRun(input: StartRunInput): Promise<string> {
  // What the session looked like before, so a failed start can be undone.
  const before = await prisma.job.findUnique({ where: { id: input.jobId }, select: { status: true } });

  // Only well-formed, in-scope queries may spend a credit. The rest are
  // recorded as skipped with the validator's reasons.
  const { runnable, skipped } = sanitizeQueries(input.queries);
  const blocked = new Map<string, string[]>(skipped.map((s) => [s.queryId, [s.error ?? 'Unrunnable query.']]));
  validateBundle(runnable, input.constraints).forEach((v) => {
    if (!v.ok) blocked.set(v.queryId, v.issues.filter((i) => i.severity === 'error').map((i) => i.message));
  });
  if (blocked.size === input.queries.length) {
    throw new Error(`None of the ${input.queries.length} queries can run: ${Array.from(blocked.values())[0]?.[0] ?? 'they are invalid.'}`);
  }

  // Persist what is about to run first, so the receipt and the bundle agree
  // even if the process dies one line later.
  await updateSession(input.jobId, input.userId, {
    merged_constraints: input.constraints,
    query_bundle: input.queries,
    status: 'searching',
  });

  const opts = resolveSerpOptions(input.serpOptions ?? undefined);
  // Search from where the people are: the requisition's country (a remote
  // role open to one country included). A fully remote role, or one spanning
  // several countries, searches from the engine's default vantage point.
  const gl = locationScopeFor(input.constraints).searchFrom;

  let runId: string;
  try {
    runId = await createRunRow({
      jobId: input.jobId,
      userId: input.userId,
      queries: input.queries,
      resultsCap: input.constraints.results_cap ?? 50,
      config: { maxPagesPerQuery: opts.maxPagesPerQuery, engine: opts.engine, gl },
      blocked,
    });
  } catch (err) {
    // Starting must be all-or-nothing. Without this the session is left
    // 'searching' forever with no run row behind it — nothing to poll, no
    // progress popup, and a UI stuck mid-flight until someone edits the row.
    await updateSession(input.jobId, input.userId, { status: before?.status ?? 'draft' }).catch(() => {});
    throw err;
  }

  schedule(runId, input.keys.serpapi || null);
  return runId;
}

/**
 * Takes over this user's runs whose worker has gone quiet (frozen, killed, or
 * handed back at its deadline). Called by the run-progress routes, so the
 * popup's own polling is what keeps a serverless run moving.
 */
export async function resumeStalledRuns(userId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - LEASE_MS);
  for (const runId of await findStalledRuns(userId, staleBefore)) {
    if (inFlight.has(runId)) continue;
    if (await claimRun(runId, staleBefore)) schedule(runId, null, true);
  }
}

function schedule(runId: string, serpapiKey: string | null, resumed = false): void {
  if (inFlight.has(runId)) return;
  inFlight.add(runId);
  const work = driveRun(runId, serpapiKey, resumed)
    .catch(async (err: any) => {
      console.error(`Search run ${runId} failed:`, err);
      const row = await prisma.searchRun.findUnique({ where: { id: runId }, select: { jobId: true } }).catch(() => null);
      if (row) await failRun(runId, row.jobId, err?.message || 'The search run failed.');
    })
    .finally(() => inFlight.delete(runId));
  // Keeps a Vercel invocation alive after the response; a no-op elsewhere,
  // where the long-lived process simply keeps running the promise.
  waitUntil(work);
}

async function driveRun(runId: string, serpapiKey: string | null, resumed: boolean): Promise<void> {
  const work = await loadRunWork(runId);
  if (!work || work.status !== 'running') return;

  if (resumed) {
    if (work.config.resumes >= MAX_RESUMES) {
      await failRun(runId, work.jobId, 'The search kept being interrupted and was stopped. Profiles found so far were saved.');
      return;
    }
    await recordResume(runId, work.config);
  }

  if (work.pending.length === 0) {
    await finalizeRun(runId, work.jobId);
    return;
  }

  const serpapi = serpapiKey ?? (work.userId ? await getProviderKey(work.userId, 'serpapi') : null) ?? process.env.SERPAPI_KEY ?? null;
  if (!serpapi && serpApiKeyRequired()) {
    await failRun(runId, work.jobId, 'No SerpAPI key on file. Add one in Settings, then run the search again.');
    return;
  }

  const deadline = getDeadline()?.getTime() ?? 0;
  const timeLeft = () => (deadline ? deadline - Date.now() : Number.POSITIVE_INFINITY);
  const serpOptions: SerpOptions = {
    engine: work.config.engine === 'google_light' ? 'google_light' : 'google',
    maxPagesPerQuery: work.config.maxPagesPerQuery,
    gl: work.config.gl,
    stopAt: deadline ? deadline - PAGE_CUTOFF_MS : 0,
  };

  const beat = setInterval(() => void heartbeat(runId).catch(() => {}), HEARTBEAT_MS);
  // Persistence is serialised: two queries landing together must not both
  // create the same person (see persistQueryCandidates).
  let writes: Promise<unknown> = Promise.resolve();
  let deferred = 0;

  try {
    await mapWithConcurrency(work.pending, SERP_CONCURRENCY, async (q) => {
      // Stopping is checked here rather than mid-flight: a query already sent
      // to SerpAPI is already paid for, so we let it land and refuse the next.
      if (await isAbortRequested(runId)) {
        await markQueryDone(runId, skippedOutcome(q, 'Not run — the search was stopped.'));
        return;
      }
      if (timeLeft() < START_CUTOFF_MS) {
        deferred++; // left pending for the next invocation
        return;
      }
      await markQueryStart(runId, q.id, `Searching ${platformLabel(q.platform)} · ${queryLabel(q.query_type)}…`).catch(() => {});
      const { outcome, candidates } = await searchOneQuery(q, work.constraints, work.jobId, { serpapi: serpapi ?? null }, serpOptions);
      const tier = outcome.provider === 'serpapi' ? 'precision' : 'free';
      writes = writes.then(() => persistQueryCandidates(work.jobId, runId, tier, candidates)).catch((err) => {
        console.error(`Storing profiles for query ${q.id} of run ${runId} failed:`, err);
      });
      await writes;
      await markQueryDone(runId, outcome);
    });
  } finally {
    clearInterval(beat);
  }

  if (deferred > 0) {
    // Out of time in this invocation: hand the run back so the next poll resumes it.
    await releaseRun(runId, LEASE_MS, `Continuing… ${deferred} ${deferred === 1 ? 'query' : 'queries'} left`);
    return;
  }
  await finalizeRun(runId, work.jobId);
}

function skippedOutcome(q: XRayQuery, notice: string) {
  return {
    queryId: q.id,
    platform: q.platform,
    queryType: q.query_type,
    queryString: q.query_string,
    status: 'skipped' as const,
    provider: 'none' as const,
    resultCount: 0,
    indexedCount: 0,
    pagesFetched: 0,
    creditsUsed: 0,
    notice,
  };
}

export function isRunInFlight(runId: string): boolean {
  return inFlight.has(runId);
}
