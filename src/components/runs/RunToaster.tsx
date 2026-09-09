'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Loader2, Minus, Search, X, AlertTriangle } from 'lucide-react';
import { useRunTracker } from './RunTracker';
import { ProgressBar } from '@/components/processing/ProcessingOverlay';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { getTemplate } from '@/lib/search/xrayTemplates';
import type { RunQuerySnapshot, RunSnapshot } from '@/lib/search/runTypes';

// ---------------------------------------------------------------------------
// Search progress popup — bottom-right, the way a Drive upload reports.
//
// Every run the tracker knows about and no page is watching shows up here, so
// closing the blocking overlay (or walking to another page) never means losing
// sight of a search. Collapsible, one card, stacked rows; each row expands to
// the per-query detail and can be stopped or dismissed.
// ---------------------------------------------------------------------------

function statusLabel(run: RunSnapshot): string {
  if (run.status === 'running') return run.statusText ?? 'Searching…';
  if (run.status === 'aborted') return run.statusText ?? 'Stopped.';
  if (run.status === 'failed') return run.error ?? run.statusText ?? 'The run failed.';
  return run.statusText ?? `${run.candidateCount} profiles stored`;
}

function RunGlyph({ status }: { status: RunSnapshot['status'] }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-link animate-spin flex-shrink-0" />;
  if (status === 'completed') return <Check className="w-3.5 h-3.5 text-ink flex-shrink-0" strokeWidth={2.5} />;
  if (status === 'partial') return <AlertTriangle className="w-3.5 h-3.5 text-warning-deep flex-shrink-0" strokeWidth={2} />;
  if (status === 'aborted') return <Minus className="w-3.5 h-3.5 text-mute flex-shrink-0" />;
  return <X className="w-3.5 h-3.5 text-error flex-shrink-0" />;
}

function QueryGlyph({ outcome }: { outcome: RunQuerySnapshot['outcome'] }) {
  if (outcome === 'running') return <Loader2 className="w-3 h-3 text-link animate-spin flex-shrink-0" />;
  if (outcome === 'fetched') return <Check className="w-3 h-3 text-ink flex-shrink-0" strokeWidth={2.5} />;
  if (outcome === 'skipped') return <Minus className="w-3 h-3 text-mute flex-shrink-0" />;
  if (outcome === 'failed') return <X className="w-3 h-3 text-warning-deep flex-shrink-0" />;
  return <span className="w-3 h-3 rounded-full border border-hairline flex-shrink-0" />;
}

function RunRow({ run }: { run: RunSnapshot }) {
  const { abort, dismiss } = useRunTracker();
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const active = run.status === 'running';

  return (
    <li className="border-b border-hairline last:border-b-0">
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <RunGlyph status={run.status} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex-1 min-w-0 text-left flex items-center gap-1.5"
            aria-expanded={open}
            aria-label={`${run.sessionTitle} — query detail`}
          >
            <span className="text-body-sm text-ink truncate">{run.sessionTitle}</span>
            <ChevronDown className={`w-3 h-3 text-mute flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          <span className="text-body-xs text-mute tabular-nums flex-shrink-0">
            {run.queriesDone}/{run.queriesTotal}
          </span>
          {active ? (
            <button
              type="button"
              onClick={async () => {
                setStopping(true);
                await abort(run.runId);
                setStopping(false);
              }}
              disabled={stopping}
              className="btn-icon h-6 w-6 flex-shrink-0"
              aria-label="Stop this search"
              title="Stop — queries not yet sent are skipped"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <button type="button" onClick={() => dismiss(run.runId)} className="btn-icon h-6 w-6 flex-shrink-0" aria-label="Dismiss" title="Dismiss">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {active && <ProgressBar progress={run.progress} />}

        <div className="flex items-center justify-between gap-2">
          <p className={`text-body-xs truncate ${run.status === 'failed' ? 'text-error-deep' : 'text-body'}`} aria-live="polite">
            {statusLabel(run)}
          </p>
          {!active && run.candidateCount > 0 && (
            <Link href={`/dashboard?session=${encodeURIComponent(run.jobId)}`} className="text-body-xs text-link hover:underline flex-shrink-0">
              View results
            </Link>
          )}
        </div>
      </div>

      {open && (
        <ul className="bg-canvas border-t border-hairline-soft max-h-48 overflow-y-auto">
          {run.queries.map((q) => (
            <li key={q.queryId} className="px-3 py-1.5 flex items-center gap-2 text-body-xs">
              <QueryGlyph outcome={q.outcome} />
              <PlatformBadge platform={q.platform} />
              <span className="text-body truncate flex-1">{getTemplate(q.queryType)?.label ?? 'Custom query'}</span>
              <span className={`tabular-nums flex-shrink-0 ${q.outcome === 'failed' ? 'text-warning-deep' : 'text-mute'}`}>
                {q.outcome === 'fetched'
                  ? `${q.keptCount}/${q.resultCount}`
                  : q.outcome === 'running'
                    ? 'searching…'
                    : q.outcome === 'pending'
                      ? 'queued'
                      : q.outcome}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RunToaster() {
  const { unwatched, runs } = useRunTracker();
  const [collapsed, setCollapsed] = useState(false);
  const activeCount = unwatched.filter((r) => r.status === 'running').length;

  // Re-open the popup whenever a new run appears while it is collapsed.
  const [lastCount, setLastCount] = useState(0);
  useEffect(() => {
    if (unwatched.length > lastCount) setCollapsed(false);
    setLastCount(unwatched.length);
  }, [unwatched.length, lastCount]);

  if (unwatched.length === 0) return null;

  const title =
    activeCount > 0
      ? `Searching · ${activeCount} ${activeCount === 1 ? 'run' : 'runs'}`
      : `${unwatched.length} ${unwatched.length === 1 ? 'search' : 'searches'} finished`;

  return (
    <div
      // z-20 keeps the popup above the page but below every focused surface
      // (history panel z-30/40, drawers and modals z-50, overlay z-60) — an
      // ambient report must never sit on top of a drawer's own buttons.
      className="fixed bottom-4 right-4 z-20 w-[min(360px,calc(100vw-2rem))] animate-fade-in"
      role="status"
      aria-label="Search progress"
      data-run-toaster
    >
      <div className="card shadow-modal overflow-hidden">
        <div className="px-3 h-10 flex items-center gap-2 border-b border-hairline bg-elevated">
          <Search className="w-3.5 h-3.5 text-body flex-shrink-0" strokeWidth={1.75} />
          <span className="text-label-sm text-ink flex-1 truncate">{title}</span>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="btn-icon h-6 w-6"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand search progress' : 'Collapse search progress'}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {!collapsed && (
          <ul className="max-h-[60vh] overflow-y-auto">
            {unwatched.map((run) => (
              <RunRow key={run.runId} run={run} />
            ))}
          </ul>
        )}

        {collapsed && activeCount > 0 && (
          <div className="px-3 py-2">
            <ProgressBar progress={unwatched.find((r) => r.status === 'running')?.progress ?? null} />
          </div>
        )}
      </div>
      {runs.length > unwatched.length && <span className="sr-only">Some runs are shown in the open progress dialog.</span>}
    </div>
  );
}
