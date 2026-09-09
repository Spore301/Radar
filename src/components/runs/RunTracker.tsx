'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as runsApi from '@/lib/api/runs';
import { notifySessionsChanged } from '@/lib/api/sessions';
import type { RunSnapshot } from '@/lib/search/runTypes';

// ---------------------------------------------------------------------------
// Run tracker — the client half of the async search.
//
// Mounted once in the app shell so it outlives every route change: start a
// search on the dashboard, walk to the pipeline board, and the progress popup
// follows you. It polls the server while anything is running (and once on
// mount, so a reloaded tab picks up runs it never started).
//
// A page that is showing its own blocking overlay for a run "claims" it via
// watch(); the popup then stays out of the way until the overlay is closed or
// the page unmounts — which is exactly the "stop waiting" hand-off.
// ---------------------------------------------------------------------------

/** Fired when a run reaches a terminal state, so open pages can refresh. */
export const RUN_FINISHED_EVENT = 'candidateradar:run-finished';

export interface RunFinishedDetail {
  runId: string;
  jobId: string;
  status: RunSnapshot['status'];
}

interface RunTrackerValue {
  /** Active and recently-finished runs, newest first. */
  runs: RunSnapshot[];
  /** Runs the popup should render: everything not claimed by a page overlay. */
  unwatched: RunSnapshot[];
  start: (input: runsApi.StartRunInput) => Promise<string>;
  abort: (runId: string) => Promise<void>;
  dismiss: (runId: string) => void;
  /** Claim a run while a page shows its own overlay for it. */
  watch: (runId: string | null) => void;
  refresh: () => Promise<void>;
}

const RunTrackerContext = createContext<RunTrackerValue | null>(null);

const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 15000;

export function RunTrackerProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [watched, setWatched] = useState<string | null>(null);
  const seenTerminal = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so the poll loop reads the latest runs without re-subscribing.
  const runsRef = useRef<RunSnapshot[]>([]);
  runsRef.current = runs;

  const refresh = useCallback(async () => {
    try {
      const next = await runsApi.listRuns();
      setRuns(next);
      // Announce newly-finished runs exactly once each.
      for (const run of next) {
        if (run.status !== 'running' && !seenTerminal.current.has(run.runId)) {
          seenTerminal.current.add(run.runId);
          notifySessionsChanged();
          window.dispatchEvent(
            new CustomEvent<RunFinishedDetail>(RUN_FINISHED_EVENT, {
              detail: { runId: run.runId, jobId: run.jobId, status: run.status },
            })
          );
        }
      }
    } catch {
      // A failed poll is not worth surfacing; the next tick retries.
    }
  }, []);

  // Poll fast while something is running, slowly otherwise. Runs on mount too,
  // so a fresh tab adopts whatever was already in flight.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      const active = document.visibilityState !== 'hidden';
      const anyRunning = runsRef.current.some((r) => r.status === 'running');
      timer.current = setTimeout(tick, anyRunning && active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const start = useCallback(
    async (input: runsApi.StartRunInput) => {
      const { runId, queriesTotal } = await runsApi.startRun(input);
      // Optimistic row so the popup appears the instant the run is accepted.
      setRuns((prev) => [
        {
          runId,
          jobId: input.jobId,
          sessionTitle: input.constraints.job_title || 'Search',
          status: 'running',
          stage: 'searching',
          statusText: `Queued ${queriesTotal} ${queriesTotal === 1 ? 'query' : 'queries'}…`,
          queriesTotal,
          queriesDone: 0,
          indexed: 0,
          candidateCount: 0,
          creditsUsed: 0,
          progress: 0,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          queries: input.queries.map((q) => ({
            queryId: q.id,
            platform: q.platform,
            queryType: q.query_type,
            outcome: 'pending' as const,
            resultCount: 0,
            keptCount: 0,
            creditCost: 0,
          })),
        },
        ...prev.filter((r) => r.runId !== runId),
      ]);
      setDismissed((d) => d.filter((id) => id !== runId));
      void refresh();
      return runId;
    },
    [refresh]
  );

  const abort = useCallback(
    async (runId: string) => {
      try {
        await runsApi.abortRun(runId);
      } finally {
        void refresh();
      }
    },
    [refresh]
  );

  const dismiss = useCallback((runId: string) => setDismissed((d) => (d.includes(runId) ? d : [...d, runId])), []);
  const watch = useCallback((runId: string | null) => setWatched(runId), []);

  const value = useMemo<RunTrackerValue>(() => {
    const visible = runs.filter((r) => !dismissed.includes(r.runId));
    return {
      runs,
      unwatched: visible.filter((r) => r.runId !== watched),
      start,
      abort,
      dismiss,
      watch,
      refresh,
    };
  }, [runs, dismissed, watched, start, abort, dismiss, watch, refresh]);

  return <RunTrackerContext.Provider value={value}>{children}</RunTrackerContext.Provider>;
}

export function useRunTracker(): RunTrackerValue {
  const ctx = useContext(RunTrackerContext);
  if (!ctx) throw new Error('useRunTracker must be used inside <RunTrackerProvider>.');
  return ctx;
}

/** Subscribes to run completion — used by pages that show a run's results. */
export function useRunFinished(handler: (detail: RunFinishedDetail) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onDone = (e: Event) => ref.current((e as CustomEvent<RunFinishedDetail>).detail);
    window.addEventListener(RUN_FINISHED_EVENT, onDone);
    return () => window.removeEventListener(RUN_FINISHED_EVENT, onDone);
  }, []);
}

/** Live snapshot of one run, or null once it is gone from the tracker. */
export function useRun(runId: string | null): RunSnapshot | null {
  const { runs } = useRunTracker();
  return runId ? runs.find((r) => r.runId === runId) ?? null : null;
}
