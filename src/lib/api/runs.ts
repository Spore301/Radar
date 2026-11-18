import type { MergedConstraints, XRayQuery } from '../types';
import { DEFAULT_MAX_PAGES_PER_QUERY, HARD_MAX_PAGES_PER_QUERY, type SerpOptions } from '../search/serpConfig';
import type { RunSnapshot } from '../search/runTypes';

// ---------------------------------------------------------------------------
// Search depth — SERP pages walked per query (1 page = 10 results = 1 credit).
// Remembered per browser so the recruiter sets it once; always clamped to the
// hard bounds the server applies, so a stale or hand-edited value can never
// raise the ceiling shown beside the Search button.
// ---------------------------------------------------------------------------

const DEPTH_STORAGE_KEY = 'radr.searchDepth';

export function clampDepth(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_MAX_PAGES_PER_QUERY;
  return Math.min(HARD_MAX_PAGES_PER_QUERY, Math.max(1, Math.floor(n)));
}

export function readStoredDepth(): number {
  if (typeof window === 'undefined') return DEFAULT_MAX_PAGES_PER_QUERY;
  try {
    const raw = window.localStorage.getItem(DEPTH_STORAGE_KEY);
    return raw === null ? DEFAULT_MAX_PAGES_PER_QUERY : clampDepth(raw);
  } catch {
    return DEFAULT_MAX_PAGES_PER_QUERY;
  }
}

export function storeDepth(depth: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEPTH_STORAGE_KEY, String(clampDepth(depth)));
  } catch {
    // Private mode or blocked storage: the depth still applies to this page.
  }
}

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
