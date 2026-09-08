'use client';

import React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { ProgressBar, StepState } from './ProcessingOverlay';

// ---------------------------------------------------------------------------
// The stepper and the status line, as one hairline object: three segments
// (Ingest → Constraints → Search), then the live status and a thin progress
// bar while processing, or the last outcome when idle.
// ---------------------------------------------------------------------------

export type FlowStageKey = 'ingest' | 'constraints' | 'search';

export interface StageStatusBarProps {
  stages: Record<FlowStageKey, StepState>;
  current: FlowStageKey;
  onSelect?: (key: FlowStageKey) => void;
  message: string;
  progress?: number | null;
  busy: boolean;
  tone?: 'info' | 'success' | 'error';
}

const LABELS: Record<FlowStageKey, string> = {
  ingest: 'Ingest JD',
  constraints: 'Constraints & queries',
  search: 'Search & index',
};

function Glyph({ state, index }: { state: StepState; index: number }) {
  if (state === 'done') return <Check className="w-3 h-3" strokeWidth={2.5} />;
  if (state === 'active') return <Loader2 className="w-3 h-3 animate-spin" />;
  if (state === 'failed') return <X className="w-3 h-3" />;
  return <span className="text-[10px] leading-none tabular-nums">{index + 1}</span>;
}

export function StageStatusBar({ stages, current, onSelect, message, progress, busy, tone = 'info' }: StageStatusBarProps) {
  const keys = Object.keys(LABELS) as FlowStageKey[];
  const toneClass = tone === 'success' ? 'text-ink' : tone === 'error' ? 'text-error-deep' : busy ? 'text-ink' : 'text-body';

  return (
    <div className="card overflow-hidden" role="status" aria-live="polite">
      <div className="grid grid-cols-3 border-b border-hairline">
        {keys.map((key, i) => {
          const state = stages[key];
          const isCurrent = key === current;
          const clickable = Boolean(onSelect) && (state === 'done' || isCurrent);
          return (
            <button
              key={key}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect?.(key)}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center gap-2 h-10 px-3.5 text-body-sm border-r border-hairline last:border-r-0 text-left transition-colors disabled:cursor-default ${
                isCurrent ? 'bg-hairline-soft text-ink font-medium' : state === 'done' ? 'text-body hover:bg-hairline-soft' : 'text-mute'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border ${
                  isCurrent || state === 'done' ? 'bg-ink text-white border-ink' : state === 'failed' ? 'bg-error text-white border-error' : 'border-hairline text-mute'
                }`}
              >
                <Glyph state={isCurrent && state !== 'active' ? 'pending' : state} index={i} />
              </span>
              <span className="truncate">{LABELS[key]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-3.5 h-9">
        <span className={`text-body-sm truncate flex-1 ${toneClass}`}>{message}</span>
        {busy && progress !== undefined && (
          <div className="w-32 sm:w-44 flex-shrink-0">
            <ProgressBar progress={progress} className="!h-1" />
          </div>
        )}
      </div>
    </div>
  );
}
