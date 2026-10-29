import { prisma } from './client';
import { djb2 } from './sessions';
import { canonicalizeQueryString } from '../search/queryValidation';
import { RUN_HEARTBEAT_TIMEOUT_MS, type RunLifecycle, type RunQueryOutcome, type RunSnapshot } from '../search/runTypes';
import type { QueryRunResult } from '../search/x-raySearchService';
import type { MergedConstraints, XRayQuery } from '../types';

// ---------------------------------------------------------------------------
// The database side of a background search run.
//
// The SearchRun row is created BEFORE any query is fired and updated as each
// one lands. That inversion is the whole point: the run's progress no longer
// lives inside the HTTP request that started it, so closing the overlay,
// navigating away or reloading the tab loses nothing, and the progress popup
// can be rebuilt from scratch by any tab at any time.
// ---------------------------------------------------------------------------

/**
 * What a worker needs to pick a run up again in a fresh process: frozen at
 * start in SearchRun.estimate (the "what the recruiter confirmed spending"
 * column), since the query rows and the session's constraints already hold
 * everything else.
 */
export interface RunConfig {
  maxPagesPerQuery: number;
  engine: string;
  /** SerpAPI `gl` country code for location-bound roles; '' when remote / unknown. */
  gl: string;
  /** How many times a worker has picked this run up after the first. */
  resumes: number;
}

/**
 * Creates the run header plus one row per query. Queries listed in `blocked`
 * failed validation: they are recorded as skipped with the reason, so the
 * receipt shows why they cost nothing, and are never sent to SerpAPI.
 */
export async function createRunRow(input: {
  jobId: string;
  userId: string | null;
  queries: XRayQuery[];
  resultsCap: number;
  config: Omit<RunConfig, 'resumes'>;
  blocked?: Map<string, string[]>;
}): Promise<string> {
  const blocked = input.blocked ?? new Map<string, string[]>();
  const runnable = input.queries.length - blocked.size;
  const run = await prisma.searchRun.create({
    data: {
      jobId: input.jobId,
      // Tier is provisional until we see which engine actually answered.
      tier: 'precision',
      status: 'running',
      stage: 'searching',
      statusText: `Queued ${runnable} ${runnable === 1 ? 'query' : 'queries'}…`,
      resultsCap: input.resultsCap,
      queriesTotal: input.queries.length,
      queriesDone: blocked.size,
      estimate: { ...input.config, resumes: 0 },
      startedById: input.userId ?? undefined,
      heartbeatAt: new Date(),
      queries: {
        create: input.queries.map((q) => {
          const issues = blocked.get(q.id);
          return {
            queryId: q.id,
            platform: q.platform,
            queryType: q.query_type,
            queryString: q.query_string,
            canonicalHash: djb2(canonicalizeQueryString(q.query_string)),
            outcome: issues ? 'skipped' : 'pending',
            ...(issues
              ? { validationErrors: issues, errorMessage: `Not run — invalid query: ${issues.join(' ')}`.slice(0, 500), finishedAt: new Date() }
              : {}),
          };
        }),
      },
    },
    select: { id: true },
  });
  return run.id;
}

// --- Worker lease ------------------------------------------------------------
//
// A run is worked by whichever process holds its lease, and the lease is the
// heartbeat: a live worker refreshes heartbeatAt every few seconds, and any
// process may take over a run whose heartbeat is older than the lease. Claiming
// is one conditional UPDATE, so two polls racing for the same stalled run can't
// both win.

/** Takes over a running run whose last heartbeat is older than `staleBefore`. */
export async function claimRun(runId: string, staleBefore: Date): Promise<boolean> {
  const { count } = await prisma.searchRun.updateMany({
    where: { id: runId, status: 'running', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }] },
    data: { heartbeatAt: new Date() },
  });
  return count > 0;
}

export async function heartbeat(runId: string): Promise<void> {
  await prisma.searchRun.updateMany({ where: { id: runId, status: 'running' }, data: { heartbeatAt: new Date() } });
}

/**
 * Gives a run back unfinished (the invocation is about to hit its time limit):
 * backdates the heartbeat past the lease so the next poll resumes it at once.
 */
export async function releaseRun(runId: string, leaseMs: number, statusText: string): Promise<void> {
  await prisma.searchRun.updateMany({
    where: { id: runId, status: 'running' },
    data: { heartbeatAt: new Date(Date.now() - leaseMs - 1000), statusText },
  });
}

/** Stalled runs of this user that a worker may take over. */
export async function findStalledRuns(userId: string, staleBefore: Date): Promise<string[]> {
  const rows = await prisma.searchRun.findMany({
    where: { startedById: userId, status: 'running', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }] },
    select: { id: true },
    orderBy: { startedAt: 'asc' },
    take: 3,
  });
  return rows.map((r) => r.id);
}

export interface RunWork {
  runId: string;
  jobId: string;
  userId: string | null;
  status: string;
  config: RunConfig;
  constraints: MergedConstraints;
  /** Queries not yet finished — including any a dead worker had started. */
  pending: XRayQuery[];
}

export async function loadRunWork(runId: string): Promise<RunWork | null> {
  const run = await prisma.searchRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      jobId: true,
      startedById: true,
      status: true,
      estimate: true,
      job: { select: { mergedConstraints: true } },
      queries: { where: { outcome: 'pending' }, select: { queryId: true, platform: true, queryType: true, queryString: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!run) return null;
  const raw = (run.estimate ?? {}) as Partial<RunConfig>;
  return {
    runId: run.id,
    jobId: run.jobId,
    userId: run.startedById,
    status: run.status,
    config: {
      maxPagesPerQuery: typeof raw.maxPagesPerQuery === 'number' ? raw.maxPagesPerQuery : 5,
      engine: typeof raw.engine === 'string' ? raw.engine : 'google',
      gl: typeof raw.gl === 'string' ? raw.gl : '',
      resumes: typeof raw.resumes === 'number' ? raw.resumes : 0,
    },
    constraints: run.job.mergedConstraints as unknown as MergedConstraints,
    pending: run.queries.map((q) => ({
      id: q.queryId,
      platform: q.platform,
      query_type: q.queryType,
      query_string: q.queryString,
      query_intent: '',
      expected_result_type: 'Profile',
    })),
  };
}

export async function recordResume(runId: string, config: RunConfig): Promise<void> {
  await prisma.searchRun.update({ where: { id: runId }, data: { estimate: { ...config, resumes: config.resumes + 1 } } });
}

/** Marks one query as in flight and refreshes the run's heartbeat. */
export async function markQueryStart(runId: string, queryId: string, statusText: string): Promise<void> {
  await prisma.searchRun.update({
    where: { id: runId },
    data: { statusText, heartbeatAt: new Date() },
  });
  await prisma.searchRunQuery.updateMany({
    where: { runId, queryId },
    data: { startedAt: new Date() },
  });
}

/**
 * Writes one query's outcome and advances the run counters. The counters are
 * re-read from the query rows rather than kept in memory, so they stay right
 * across workers when a run is resumed in another invocation.
 */
export async function markQueryDone(runId: string, result: QueryRunResult): Promise<void> {
  const outcome: RunQueryOutcome = result.status === 'completed' ? 'fetched' : result.status === 'skipped' ? 'skipped' : 'failed';
  await prisma.searchRunQuery.updateMany({
    where: { runId, queryId: result.queryId },
    data: {
      outcome,
      provider: result.provider === 'none' ? null : result.provider,
      creditCost: result.creditsUsed,
      resultCount: result.resultCount,
      keptCount: result.indexedCount,
      errorMessage: result.error ?? result.notice ?? null,
      finishedAt: new Date(),
    },
  });
  const [total, done, sums] = await Promise.all([
    prisma.searchRunQuery.count({ where: { runId } }),
    prisma.searchRunQuery.count({ where: { runId, outcome: { not: 'pending' } } }),
    prisma.searchRunQuery.aggregate({ where: { runId }, _sum: { keptCount: true, creditCost: true } }),
  ]);
  const indexed = sums._sum.keptCount ?? 0;
  await prisma.searchRun.update({
    where: { id: runId },
    data: {
      queriesDone: done,
      rawResultCount: indexed,
      creditsCommitted: sums._sum.creditCost ?? 0,
      statusText: `${done} of ${total} queries done · ${indexed} ${indexed === 1 ? 'profile' : 'profiles'} indexed`,
      heartbeatAt: new Date(),
    },
  });
}

export async function markStage(runId: string, stage: string, statusText: string): Promise<void> {
  await prisma.searchRun.update({ where: { id: runId }, data: { stage, statusText, heartbeatAt: new Date() } });
}

/**
 * Closes a run out once no query is pending. Profiles were already stored
 * query by query (persistQueryCandidates), so this only totals the receipt,
 * settles the run's status and the session's counters.
 */
export async function finalizeRun(runId: string, jobId: string): Promise<{ candidateCount: number }> {
  const queries = await prisma.searchRunQuery.findMany({ where: { runId }, select: { outcome: true, provider: true, keptCount: true, creditCost: true } });
  const run = await prisma.searchRun.findUnique({ where: { id: runId }, select: { abortRequested: true } });
  const completed = queries.filter((q) => q.outcome === 'fetched' || q.outcome === 'cache_hit').length;
  const status: RunLifecycle = run?.abortRequested
    ? 'aborted'
    : queries.length > 0 && completed === queries.length
      ? 'completed'
      : completed > 0
        ? 'partial'
        : 'failed';
  const tier: 'free' | 'precision' = queries.some((q) => q.provider === 'serpapi') ? 'precision' : 'free';
  const indexed = queries.reduce((s, q) => s + q.keptCount, 0);
  const credits = queries.reduce((s, q) => s + q.creditCost, 0);
  const [fromRun, total] = await Promise.all([
    prisma.candidate.count({ where: { jobId, sourceRunId: runId } }),
    prisma.candidate.count({ where: { jobId } }),
  ]);

  await prisma.job.update({ where: { id: jobId }, data: { status: completed > 0 || total > 0 ? 'complete' : 'draft', candidateCount: total } });
  await prisma.searchRun.update({
    where: { id: runId },
    data: {
      tier,
      status,
      stage: 'done',
      statusText:
        status === 'aborted'
          ? `Stopped. ${fromRun} ${fromRun === 1 ? 'profile' : 'profiles'} found before stopping were saved.`
          : status === 'failed'
            ? 'Every query failed — no profiles stored.'
            : `${completed} of ${queries.length} queries · ${indexed} indexed · ${fromRun} stored`,
      creditsCommitted: credits,
      queriesDone: queries.length,
      rawResultCount: indexed,
      candidateCount: fromRun,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
  return { candidateCount: fromRun };
}

/** Closes a run out as failed. Never throws — it runs inside a catch block. */
export async function failRun(runId: string, jobId: string, message: string): Promise<void> {
  const text = message.slice(0, 300);
  await prisma.searchRun
    .update({
      where: { id: runId },
      data: { status: 'failed', stage: 'done', statusText: text, errorMessage: text, finishedAt: new Date(), heartbeatAt: new Date() },
    })
    .catch(() => {});
  // The bundle is still there to re-run. Profiles stored before the failure
  // (they are saved query by query) keep the session 'complete'.
  const stored = await prisma.candidate.count({ where: { jobId } }).catch(() => 0);
  await prisma.job.update({ where: { id: jobId }, data: { status: stored > 0 ? 'complete' : 'draft', candidateCount: stored } }).catch(() => {});
}

/**
 * Co-operative cancellation: the worker checks this between queries.
 *
 * Scoped to the run's owner in the WHERE clause, so a caller cannot stop
 * someone else's run by guessing an id. Returns false when the run does not
 * exist or is not this user's — the route reports both as 404.
 */
export async function requestAbort(runId: string, userId: string): Promise<boolean> {
  const { count } = await prisma.searchRun.updateMany({
    where: { id: runId, startedById: userId },
    data: { abortRequested: true, statusText: 'Stopping…' },
  });
  return count > 0;
}

export async function isAbortRequested(runId: string): Promise<boolean> {
  const row = await prisma.searchRun.findUnique({ where: { id: runId }, select: { abortRequested: true } });
  return Boolean(row?.abortRequested);
}

// --- Reading -----------------------------------------------------------------

const RUN_SELECT = {
  id: true,
  jobId: true,
  status: true,
  stage: true,
  statusText: true,
  queriesTotal: true,
  queriesDone: true,
  rawResultCount: true,
  candidateCount: true,
  creditsCommitted: true,
  startedAt: true,
  finishedAt: true,
  heartbeatAt: true,
  errorMessage: true,
  job: { select: { title: true } },
  queries: {
    select: { queryId: true, platform: true, queryType: true, outcome: true, resultCount: true, keptCount: true, creditCost: true, errorMessage: true, startedAt: true, finishedAt: true },
  },
} as const;

type RunRow = {
  id: string;
  jobId: string;
  status: string;
  stage: string | null;
  statusText: string | null;
  queriesTotal: number;
  queriesDone: number;
  rawResultCount: number;
  candidateCount: number;
  creditsCommitted: number;
  startedAt: Date;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  errorMessage: string | null;
  job: { title: string };
  queries: Array<{
    queryId: string;
    platform: string;
    queryType: string;
    outcome: string;
    resultCount: number;
    keptCount: number;
    creditCost: number;
    errorMessage: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
};

function toSnapshot(row: RunRow): RunSnapshot {
  const stale =
    row.status === 'running' && row.heartbeatAt !== null && Date.now() - row.heartbeatAt.getTime() > RUN_HEARTBEAT_TIMEOUT_MS;
  const status: RunLifecycle = stale ? 'failed' : (row.status as RunLifecycle);
  const queryShare = row.queriesTotal > 0 ? (row.queriesDone / row.queriesTotal) * 0.9 : 0;
  const progress = status === 'running' ? (row.stage === 'storing' ? 0.95 : queryShare) : 1;

  return {
    runId: row.id,
    jobId: row.jobId,
    sessionTitle: row.job.title,
    status,
    stage: row.stage,
    statusText: stale ? 'The server stopped reporting on this run.' : row.statusText,
    queriesTotal: row.queriesTotal,
    queriesDone: row.queriesDone,
    indexed: row.rawResultCount,
    candidateCount: row.candidateCount,
    creditsUsed: row.creditsCommitted,
    progress,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: stale ? 'The server stopped reporting on this run.' : row.errorMessage,
    queries: row.queries.map((q) => ({
      queryId: q.queryId,
      platform: q.platform,
      queryType: q.queryType,
      // A row with a start but no finish is in flight right now.
      outcome: (q.outcome === 'pending' && q.startedAt && !q.finishedAt ? 'running' : q.outcome) as RunQueryOutcome,
      resultCount: q.resultCount,
      keptCount: q.keptCount,
      creditCost: q.creditCost,
      error: q.errorMessage,
    })),
  };
}

/**
 * One run, scoped to the user who started it. Ownership is part of the query
 * rather than a check the caller has to remember: a run id belonging to
 * someone else is indistinguishable from one that does not exist.
 */
export async function getRunSnapshot(runId: string, userId: string): Promise<RunSnapshot | null> {
  const row = await prisma.searchRun.findFirst({ where: { id: runId, startedById: userId }, select: RUN_SELECT });
  return row ? toSnapshot(row as RunRow) : null;
}

/**
 * Runs the progress popup should show: everything still going, plus anything
 * that finished in the last few minutes so a returning tab can still report
 * the outcome ("Run complete · 48 profiles") instead of silently dropping it.
 */
export async function listRunSnapshots(userId: string, sinceMs = 10 * 60 * 1000): Promise<RunSnapshot[]> {
  const rows = await prisma.searchRun.findMany({
    where: {
      startedById: userId,
      OR: [{ status: 'running' }, { finishedAt: { gte: new Date(Date.now() - sinceMs) } }],
    },
    orderBy: { startedAt: 'desc' },
    take: 12,
    select: RUN_SELECT,
  });
  return rows.map((r) => toSnapshot(r as RunRow));
}
