'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { MergedConstraints, XRayQuery } from '@/lib/types';
import { validateBundle } from '@/lib/search/queryValidation';
import { HARD_MAX_PAGES_PER_QUERY, SERP_PAGE_SIZE, DEFAULT_MAX_PAGES_PER_QUERY } from '@/lib/search/serpConfig';
import { clampDepth, readStoredDepth, storeDepth } from '@/lib/api/runs';

// ---------------------------------------------------------------------------
// Search budget — the credit ceiling a recruiter sees before (or at) the click
// that spends. One definition for the constraints form, the query review modal
// and the agent, so the three never quote different numbers.
//
// Ceiling = runnable queries × pages per query. A query the validator rejects
// is skipped by the run without spending, exactly as the server does it.
// ---------------------------------------------------------------------------

export interface SearchBudget {
  /** Queries in the bundle. */
  total: number;
  /** Queries that pass validation and will be searched. */
  runnable: number;
  /** Queries the run will skip; first reason kept for display. */
  skipped: number;
  firstSkipReason: string | null;
  depth: number;
  /** The most credits this search can spend. */
  maxCredits: number;
}

export function searchBudget(queries: XRayQuery[], constraints: MergedConstraints | null | undefined, depth: number): SearchBudget {
  const d = clampDepth(depth);
  const failing = validateBundle(queries, (constraints ?? {}) as MergedConstraints).filter((v) => !v.ok);
  const runnable = queries.length - failing.length;
  const firstSkipReason = failing[0]?.issues.find((i) => i.severity === 'error')?.message ?? null;
  return { total: queries.length, runnable, skipped: failing.length, firstSkipReason, depth: d, maxCredits: runnable * d };
}

/** "9 queries × up to 5 pages · at most 45 credits" */
export function creditLineText(b: SearchBudget): string {
  const q = `${b.runnable} ${b.runnable === 1 ? 'query' : 'queries'}`;
  const p = `up to ${b.depth} ${b.depth === 1 ? 'page' : 'pages'}`;
  const c = `at most ${b.maxCredits} ${b.maxCredits === 1 ? 'credit' : 'credits'}`;
  return `${q} × ${p} · ${c}`;
}

/** Depth for this browser: starts at the default, then adopts the stored value after mount (no hydration mismatch). */
export function useSearchDepth(): [number, (next: number) => void] {
  const [depth, setDepthState] = useState<number>(DEFAULT_MAX_PAGES_PER_QUERY);
  useEffect(() => {
    setDepthState(readStoredDepth());
  }, []);
  const setDepth = useCallback((next: number) => {
    const v = clampDepth(next);
    setDepthState(v);
    storeDepth(v);
  }, []);
  return [depth, setDepth];
}

export function DepthSelect({ depth, onChange, disabled, compact = false }: { depth: number; onChange: (n: number) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-body-sm text-body">
      <span className="field-label">Depth</span>
      <select
        value={depth}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        aria-label="Depth, pages per query"
        title="Pages of Google results walked per query. Each page is 10 results and costs 1 SerpAPI credit."
        className={`select w-auto ${compact ? 'h-7 text-body-xs' : ''}`}
      >
        {Array.from({ length: HARD_MAX_PAGES_PER_QUERY }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? 'page' : 'pages'} · ≤ {n * SERP_PAGE_SIZE} results / query
          </option>
        ))}
      </select>
    </label>
  );
}

/** The ceiling, stated plainly, plus the skipped count when validation will drop queries. */
export function CreditLine({ budget, className = '' }: { budget: SearchBudget; className?: string }) {
  return (
    <span className={`text-body-xs tabular-nums ${className || 'text-mute'}`} data-credit-line>
      {creditLineText(budget)}
      {budget.skipped > 0 && (
        <span className="text-warning-deep" title={budget.firstSkipReason ?? undefined}>
          {' '}
          · {budget.skipped} skipped by validation
        </span>
      )}
    </span>
  );
}
