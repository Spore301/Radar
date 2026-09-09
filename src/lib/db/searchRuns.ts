import { prisma } from './client';
import { djb2, persistRunCandidates } from './sessions';
import { canonicalizeQueryString } from '../search/queryValidation';
import { RUN_HEARTBEAT_TIMEOUT_MS, type RunLifecycle, type RunQueryOutcome, type RunSnapshot } from '../search/runTypes';
import type { QueryRunResult, XRaySearchResult } from '../search/x-raySearchService';
import type { XRayQuery } from '../types';

// ---------------------------------------------------------------------------
// The database side of a background search run.
//
// The SearchRun row is created BEFORE any query is fired and updated as each
// one lands. That inversion is the whole point: the run's progress no longer
// lives inside the HTTP request that started it, so closing the overlay,
// navigating away or reloading the tab loses nothing, and the progress popup
// can be rebuilt from scratch by any tab at any time.
// ---------------------------------------------------------------------------

/** Creates the run header plus one pending row per query. */
export async function createRunRow(input: {
  jobId: string;
  userId: string | null;
  queries: XRayQuery[];
  resultsCap: number;
}): Promise<string> {
  const run = await prisma.searchRun.create({
    data: {
      jobId: input.jobId,
      // Tier is provisional until we see which engine actually answered.
      tier: 'precision',
      status: 'running',
      stage: 'searching',
      statusText: `Queued ${input.queries.length} ${input.queries.length === 1 ? 'query' : 'queries'}…`,
      resultsCap: input.resultsCap,
      queriesTotal: input.queries.length,
      startedById: input.userId ?? undefined,
      heartbeatAt: new Date(),
      queries: {
        create: input.queries.map((q) => ({
          queryId: q.id,
          platform: q.platform,
          queryType: q.query_type,
          queryString: q.query_string,
          canonicalHash: djb2(canonicalizeQueryString(q.query_string)),
          outcome: 'pending',
        })),
      },
    },
    select: { id: true },
  });
  return run.id;
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

/** Writes one query's outcome and advances the run counters. */
export async function markQueryDone(
  runId: string,
  result: QueryRunResult,
  done: number,
  indexedSoFar: number,
  total: number
): Promise<void> {
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
  await prisma.searchRun.update({
    where: { id: runId },
    data: {
      queriesDone: done,
      rawResultCount: indexedSoFar,
      statusText: `${done} of ${total} queries done · ${indexedSoFar} ${indexedSoFar === 1 ? 'profile' : 'profiles'} indexed`,
      heartbeatAt: new Date(),
    },
  });
}

export async function markStage(runId: string, stage: string, statusText: string): Promise<void> {
  await prisma.searchRun.update({ where: { id: runId }, data: { stage, statusText, heartbeatAt: new Date() } });
}

/**
 * Stores the run's profiles and closes the run out. Mirrors recordSearchRun's
 * bookkeeping, but updates the row that was created when the run started
 * instead of inserting a new one.
 */
export async function finalizeRun(
  runId: string,
  jobId: string,
  result: XRaySearchResult,
  resultsCap: number
): Promise<{ candidateCount: number }> {
  const usedSerpApi = result.queryResults.some((q) => q.provider === 'serpapi');
  const tier: 'free' | 'precision' = usedSerpApi ? 'precision' : 'free';
  const anyCompleted = result.queryResults.some((q) => q.status === 'completed');
  const allCompleted = result.queryResults.length > 0 && result.queryResults.every((q) => q.status === 'completed');
  const status: RunLifecycle = allCompleted ? 'completed' : anyCompleted ? 'partial' : 'failed';

  await markStage(runId, 'storing', `Storing ${result.candidates.length} ${result.candidates.length === 1 ? 'profile' : 'profiles'}…`);
  const stored = await persistRunCandidates(jobId, runId, tier, result.candidates);

  await prisma.searchRun.update({
    where: { id: runId },
    data: {
      tier,
      status,
      stage: 'done',
      statusText:
        status === 'failed'
          ? 'Every query failed — no profiles stored.'
          : `${result.stats.queriesRun} of ${result.queryResults.length} queries · ${result.stats.total} indexed · ${stored.length} stored`,
      creditsCommitted: result.stats.creditsUsed,
      queriesDone: result.stats.queriesRun,
      rawResultCount: result.stats.total,
      candidateCount: stored.length,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
  // The session's own counters are updated by persistRunCandidates.
  return { candidateCount: stored.length };
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
  // The session itself goes back to 'draft': the bundle is still there to re-run.
  await prisma.job.update({ where: { id: jobId }, data: { status: 'draft' } }).catch(() => {});
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

export async function markAborted(runId: string): Promise<void> {
  await prisma.searchRun.update({
    where: { id: runId },
    data: { status: 'aborted', stage: 'done', statusText: 'Stopped. Profiles found before stopping were saved.', finishedAt: new Date() },
  });
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
