import type { CandidatePlatform } from '../types';

// ---------------------------------------------------------------------------
// Shapes shared between the background search worker and the progress popup.
//
// A run's state lives in the database, not in the request that started it, so
// the recruiter can close the overlay, switch pages or reload the tab and the
// popup still knows exactly where the run is — the same way a Drive upload
// keeps reporting after you navigate away.
// ---------------------------------------------------------------------------

/** Terminal states are everything except 'running'. */
export type RunLifecycle = 'running' | 'completed' | 'partial' | 'failed' | 'aborted';

export type RunQueryOutcome = 'pending' | 'running' | 'fetched' | 'skipped' | 'failed';

export interface RunQuerySnapshot {
  queryId: string;
  platform: CandidatePlatform | string;
  queryType: string;
  outcome: RunQueryOutcome;
  resultCount: number;
  keptCount: number;
  creditCost: number;
  error?: string | null;
}

export interface RunSnapshot {
  runId: string;
  jobId: string;
  /** The session's title, so the popup can name the run without a second fetch. */
  sessionTitle: string;
  status: RunLifecycle;
  /** Coarse phase: 'searching' while queries run, 'storing' while profiles are written. */
  stage: string | null;
  /** One line of human status ("4 of 9 queries done · 37 profiles indexed"). */
  statusText: string | null;
  queriesTotal: number;
  queriesDone: number;
  /** Raw results indexed so far across all queries (pre-dedupe). */
  indexed: number;
  /** Profiles stored on the session once the run finishes. */
  candidateCount: number;
  creditsUsed: number;
  /** 0..1. Queries are 90% of the bar; storing is the last 10%. */
  progress: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  queries: RunQuerySnapshot[];
}

export function isRunActive(run: RunSnapshot): boolean {
  return run.status === 'running';
}

/** How long a run may go without a heartbeat before it is presumed dead. */
export const RUN_HEARTBEAT_TIMEOUT_MS = 120_000;
