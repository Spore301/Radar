import type { MergedConstraints, XRayQuery } from '../types';
import type { SerpOptions } from '../search/serpConfig';
import type { RunSnapshot } from '../search/runTypes';

// ---------------------------------------------------------------------------
// Client wrappers for background search runs. Starting a run is a short POST
// that returns a run id; progress arrives by polling, so nothing depends on
// an open connection.
// ---------------------------------------------------------------------------

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return data as T;
}

export interface StartRunInput {
  jobId: string;
  constraints: MergedConstraints;
  queries: XRayQuery[];
  apiKeys?: { deepseek?: string | null };
  serpOptions?: Partial<SerpOptions>;
}

/** Starts the run and resolves as soon as the server has it on record. */
export async function startRun(input: StartRunInput): Promise<{ runId: string; queriesTotal: number }> {
  return json(
    await fetch('/api/search-runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function listRuns(): Promise<RunSnapshot[]> {
  const { runs } = await json<{ runs: RunSnapshot[] }>(await fetch('/api/search-runs', { cache: 'no-store' }));
  return runs;
}

export async function getRun(runId: string): Promise<RunSnapshot> {
  const { run } = await json<{ run: RunSnapshot }>(await fetch(`/api/search-runs/${runId}`, { cache: 'no-store' }));
  return run;
}

export async function abortRun(runId: string): Promise<RunSnapshot> {
  const { run } = await json<{ run: RunSnapshot }>(await fetch(`/api/search-runs/${runId}`, { method: 'DELETE' }));
  return run;
}
