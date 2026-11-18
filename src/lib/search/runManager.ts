import { getDeadline, waitUntil } from '@vercel/functions';
import { mapWithConcurrency, sanitizeQueries, searchOneQuery, SERP_CONCURRENCY } from './x-raySearchService';
import { resolveSerpOptions } from './serpConfig';
import { queryLabel } from './xrayTemplates';
import { platformLabel } from './platforms';
import { validateBundle } from './queryValidation';
import { resolveSearchGeo } from './providers/geo';
import { providerChain } from './providers';
import { createProviderRunState, type DeadProvider } from './providers/runState';
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
  recordExhaustedProvider,
  skipPendingQueries,
  recordResume,
  releaseRun,
} from '../db/searchRuns';
import { persistQueryCandidates, updateSession } from '../db/sessions';
import { resolveSearchKeys, type SearchKeys } from '../credentials';
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
/**
 * Time budget for ONE query under an invocation deadline: every attempt,
 * retry, fallback, page and relaxation of the query fits inside it (see
 * runSerpQuery). On a long-lived server there is no deadline, so a slow
 * provider may use more of it before paging stops.
 */
const SERVERLESS_QUERY_BUDGET_MS = 70_000;
const LONG_LIVED_QUERY_BUDGET_MS = 90_000;
/** Time kept back after the last SERP call to store its profiles and update the receipt. */
const PERSIST_MARGIN_MS = 15_000;
/**
 * Stop starting new queries when less than this is left before the deadline.
 * Budget + margin, so a query that starts always lands before the invocation
 * is killed. Worst case (every query using its whole budget), maxDuration 300,
 * concurrency 3, 10 queries x 5 pages: waves start at ~5/76/147 s, the tenth
 * query is handed back at ~219 s and finishes in the next invocation — about
 * 296 s wall time in total. On a long-lived server (90 s budget, no deadline)
 * the same worst case is ~370 s.
 */
const START_CUTOFF_MS = SERVERLESS_QUERY_BUDGET_MS + PERSIST_MARGIN_MS;
/** A run that keeps dying is failed rather than retried forever. */
const MAX_RESUMES = 12;

/** Runs being worked by this process, so a duplicate start/resume is a no-op. */
const inFlight = new Set<string>();

export interface StartRunInput {
  jobId: string;
  userId: string;
  constraints: MergedConstraints;
  queries: XRayQuery[];
  /** Search keys checked by the route (at least one present). DeepSeek is unused by the worker. */
  keys: { serpapi?: string | null; serper?: string | null; deepseek?: string | null };
  /** Providers the route's pre-flight found unusable (rejected key, empty account), with the reason. */
  unusableProviders?: Partial<Record<'serpapi' | 'serper', DeadProvider>>;
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
  // Where every call of this run searches from: the requisition's country
  // (gl / google_domain) and, for a city-bound role, the city; remote with no
  // country uses the provider's default. Frozen into the run so resumes match.
  const geo = await resolveSearchGeo(input.constraints.location, Boolean(input.constraints.remote_eligible));

  let runId: string;
  try {
    runId = await createRunRow({
      jobId: input.jobId,
      userId: input.userId,
      queries: input.queries,
      resultsCap: input.constraints.results_cap ?? 50,
      config: { maxPagesPerQuery: opts.maxPagesPerQuery, engine: opts.engine, ...geo, exhausted: input.unusableProviders ?? {} },
      blocked,
    });
  } catch (err) {
    // Starting must be all-or-nothing. Without this the session is left
    // 'searching' forever with no run row behind it — nothing to poll, no
    // progress popup, and a UI stuck mid-flight until someone edits the row.
    await updateSession(input.jobId, input.userId, { status: before?.status ?? 'draft' }).catch(() => {});
    throw err;
  }

  schedule(runId, { serpapi: input.keys.serpapi ?? null, serper: input.keys.serper ?? null });
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

function schedule(runId: string, keys: Pick<SearchKeys, 'serpapi' | 'serper'> | null, resumed = false): void {
  if (inFlight.has(runId)) return;
  inFlight.add(runId);
  const work = driveRun(runId, keys, resumed)
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

async function driveRun(runId: string, givenKeys: Pick<SearchKeys, 'serpapi' | 'serper'> | null, resumed: boolean): Promise<void> {
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

  // The keys the route checked, or — on a resume in a fresh invocation — the
  // same resolution again (the recruiter's own keys, else the platform's).
  const keys = givenKeys ?? (await resolveSearchKeys(work.userId));
  const chain = providerChain(keys);
  if (chain.length === 0) {
    await failRun(runId, work.jobId, 'No search key on file. Add a SerpAPI or Serper key in Settings, then run the search again.');
    return;
  }
  // Providers this run already found unusable (no credits, hourly cap, bad
  // key) stay unusable after a resume instead of being retried per query.
  const providers = createProviderRunState(chain, work.config.exhausted);

  const deadline = getDeadline()?.getTime() ?? 0;
  const timeLeft = () => (deadline ? deadline - Date.now() : Number.POSITIVE_INFINITY);
  const serpOptions: SerpOptions = {
    engine: work.config.engine === 'google_light' ? 'google_light' : 'google',
    maxPagesPerQuery: work.config.maxPagesPerQuery,
    gl: work.config.gl,
    hl: work.config.hl,
    googleDomain: work.config.googleDomain,
    location: work.config.location,
    stopAt: deadline ? deadline - PERSIST_MARGIN_MS : 0,
    queryBudgetMs: deadline ? SERVERLESS_QUERY_BUDGET_MS : LONG_LIVED_QUERY_BUDGET_MS,
  };

  const beat = setInterval(() => void heartbeat(runId).catch(() => {}), HEARTBEAT_MS);
  // Persistence is serialised: two queries landing together must not both
  // create the same person (see persistQueryCandidates).
  let writes: Promise<unknown> = Promise.resolve();
  let deferred = 0;
  const recorded = new Set<string>();

  try {
    await mapWithConcurrency(work.pending, SERP_CONCURRENCY, async (q) => {
      // Stopping is checked here rather than mid-flight: a query already sent
      // is already paid for, so we let it land and refuse the next.
      if (await isAbortRequested(runId)) {
        await markQueryDone(runId, skippedOutcome(q, 'Not run — the search was stopped.'));
        return;
      }
      // Every search key is out of credits / over its hourly cap / rejected:
      // the remaining queries are closed out at once with the reason, not
      // each sent to fail on its own retries.
      if (providers.halted) {
        await markQueryDone(runId, { ...skippedOutcome(q, `Not run — ${providers.halted.message}`), code: providers.halted.kind });
        return;
      }
      if (timeLeft() < START_CUTOFF_MS) {
        deferred++; // left pending for the next invocation
        return;
      }
      await markQueryStart(runId, q.id, `Searching ${platformLabel(q.platform)} · ${queryLabel(q.query_type)}…`).catch(() => {});
      const { outcome, candidates } = await searchOneQuery(q, work.constraints, work.jobId, keys, serpOptions, { providerState: providers });
      if (outcome.fatal && !recorded.has(outcome.fatal.provider)) {
        recorded.add(outcome.fatal.provider);
        await recordExhaustedProvider(runId, outcome.fatal.provider, outcome.fatal.kind, outcome.fatal.message).catch(() => {});
      }
      const tier = outcome.provider === 'serpapi' || outcome.provider === 'serper' ? 'precision' : 'free';
      writes = writes.then(() => persistQueryCandidates(work.jobId, runId, tier, candidates)).catch((err) => {
        console.error(`Storing profiles for query ${q.id} of run ${runId} failed:`, err);
      });
      await writes;
      await markQueryDone(runId, outcome);
    });
  } finally {
    clearInterval(beat);
  }

  if (providers.halted) {
    // Anything deferred before the halt was decided is closed out too, so no
    // row is left pending behind a finished run.
    await skipPendingQueries(runId, `Not run — ${providers.halted.message}`, providers.halted.kind);
  } else if (deferred > 0) {
    // Out of time in this invocation: hand the run back so the next poll resumes it.
    await releaseRun(runId, LEASE_MS, `Continuing… ${deferred} ${deferred === 1 ? 'query' : 'queries'} left`);
    return;
  }
  // A provider switch mid-run is worth one line on the receipt header.
  const switchNote = providers.events.length ? providers.events.join(' ') : null;
  await finalizeRun(runId, work.jobId, providers.halted?.message ?? null, switchNote);
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
