import { executeXRaySearch } from './x-raySearchService';
import { resolveSerpOptions } from './serpConfig';
import { getTemplate } from './xrayTemplates';
import { platformLabel } from './platforms';
import {
  createRunRow,
  failRun,
  finalizeRun,
  isAbortRequested,
  markAborted,
  markQueryDone,
  markQueryStart,
} from '../db/searchRuns';
import { updateSession } from '../db/sessions';
import { prisma } from '../db/client';
import type { SerpOptions } from './serpConfig';
import type { MergedConstraints, XRayQuery } from '../types';

// ---------------------------------------------------------------------------
// Background search worker.
//
// startSearchRun() returns as soon as the run is on record — it does NOT wait
// for the search. The work continues in this process, writing its progress to
// the SearchRun row, so the HTTP request that started it is free to end and
// the recruiter is free to close the overlay, change page or reload.
//
// Deployment note: this relies on a long-lived Node server (`next start` in a
// container), which is what CandidateRadar ships as. On a serverless host the
// function would be frozen the moment it responds — moving the body of
// driveRun() behind a queue is the only change that would need, since all of
// its state is already in the database rather than in memory.
// ---------------------------------------------------------------------------

/** Runs started by this process, so a duplicate start is a no-op. */
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

  // Persist what is about to run first, so the receipt and the bundle agree
  // even if the process dies one line later.
  await updateSession(input.jobId, {
    merged_constraints: input.constraints,
    query_bundle: input.queries,
    status: 'searching',
  });

  let runId: string;
  try {
    runId = await createRunRow({
      jobId: input.jobId,
      userId: input.userId,
      queries: input.queries,
      resultsCap: input.constraints.results_cap ?? 50,
    });
  } catch (err) {
    // Starting must be all-or-nothing. Without this the session is left
    // 'searching' forever with no run row behind it — nothing to poll, no
    // progress popup, and a UI stuck mid-flight until someone edits the row.
    await updateSession(input.jobId, { status: before?.status ?? 'draft' }).catch(() => {});
    throw err;
  }

  inFlight.add(runId);
  // Deliberately not awaited: this is the whole point of the async run.
  void driveRun(runId, input).finally(() => inFlight.delete(runId));

  return runId;
}

async function driveRun(runId: string, input: StartRunInput): Promise<void> {
  const total = input.queries.length;
  try {
    const result = await executeXRaySearch(
      input.jobId,
      input.constraints,
      input.queries,
      { serpapi: input.keys.serpapi, deepseek: input.keys.deepseek ?? null },
      resolveSerpOptions(input.serpOptions ?? undefined),
      {
        shouldAbort: () => isAbortRequested(runId),
        onQueryStart: (q) => {
          void markQueryStart(
            runId,
            q.id,
            `Searching ${platformLabel(q.platform)} · ${getTemplate(q.query_type)?.label ?? 'Custom query'}…`
          ).catch(() => {});
        },
        onQueryDone: (r, done, _t, indexedSoFar) => {
          void markQueryDone(runId, r, done, indexedSoFar, total).catch(() => {});
        },
      }
    );

    // Profiles found before a stop are kept — the credits were already spent.
    await finalizeRun(runId, input.jobId, result, input.constraints.results_cap ?? 50);
    if (await isAbortRequested(runId)) await markAborted(runId);
  } catch (err: any) {
    console.error(`Search run ${runId} failed:`, err);
    await failRun(runId, input.jobId, err?.message || 'The search run failed.');
  }
}

export function isRunInFlight(runId: string): boolean {
  return inFlight.has(runId);
}
