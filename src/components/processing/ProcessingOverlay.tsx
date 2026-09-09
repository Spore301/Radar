'use client';

import React, { useEffect, useState } from 'react';
import { Check, Circle, Loader2, X, Minus } from 'lucide-react';
import { CandidatePlatform } from '@/lib/types';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';

// ---------------------------------------------------------------------------
// Processing overlay — the one blocking loader for every long stage in the
// flow (parse JD, generate queries, run search, open session). Driven by real
// streamed server progress: determinate whenever the server can count its
// work, indeterminate otherwise. Level-2 surface over a dimmed canvas.
// ---------------------------------------------------------------------------

export type ProcessingStage = 'parse' | 'queries' | 'search' | 'session';
export type StepState = 'pending' | 'active' | 'done' | 'failed';

export interface ProcessingStep {
  key: string;
  label: string;
  state: StepState;
}

export interface ProcessingLogItem {
  id: string;
  platform: CandidatePlatform | string;
  label: string;
  state: 'active' | 'done' | 'failed' | 'skipped';
  meta?: string;
}

export interface ProcessingState {
  stage: ProcessingStage;
  title: string;
  status: string;
  /** 0..1 for a determinate bar, null for indeterminate. */
  progress: number | null;
  steps?: ProcessingStep[];
  items?: ProcessingLogItem[];
  detail?: string;
  /** Overrides the dismiss button's label (default: "Stop waiting"). */
  cancelLabel?: string;
  /** Overrides the note beside it — say what happens to the work. */
  cancelNote?: string;
  startedAt: number;
}

interface ProcessingOverlayProps {
  state: ProcessingState | null;
  onCancel?: () => void;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ProgressBar({ progress, className = '' }: { progress: number | null; className?: string }) {
  const pct = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-busy={pct === null || pct < 100}
      className={`track ${className}`}
    >
      {pct === null ? <div className="animate-indeterminate rounded-full bg-ink" /> : <div className="track-fill" style={{ width: `${pct}%` }} />}
    </div>
  );
}

function StepGlyph({ state }: { state: StepState }) {
  if (state === 'done') return <Check className="w-3.5 h-3.5 text-ink" strokeWidth={2.5} />;
  if (state === 'active') return <Loader2 className="w-3.5 h-3.5 text-link animate-spin" />;
  if (state === 'failed') return <X className="w-3.5 h-3.5 text-error" />;
  return <Circle className="w-3.5 h-3.5 text-hairline" strokeWidth={2} />;
}

function ItemGlyph({ state }: { state: ProcessingLogItem['state'] }) {
  if (state === 'done') return <Check className="w-3.5 h-3.5 text-ink flex-shrink-0" strokeWidth={2.5} />;
  if (state === 'active') return <Loader2 className="w-3.5 h-3.5 text-link animate-spin flex-shrink-0" />;
  if (state === 'skipped') return <Minus className="w-3.5 h-3.5 text-mute flex-shrink-0" />;
  return <X className="w-3.5 h-3.5 text-warning-deep flex-shrink-0" />;
}

export function ProcessingOverlay({ state, onCancel }: ProcessingOverlayProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!state) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  if (!state) return null;

  const pct = state.progress === null ? null : Math.round(Math.min(1, Math.max(0, state.progress)) * 100);
  const doneItems = state.items?.filter((i) => i.state !== 'active').length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-title"
    >
      <div className="card shadow-modal w-full max-w-[560px] overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="processing-title" className="text-label-sm text-ink">
              {state.title}
            </h3>
            <p className="text-body-sm text-body mt-0.5 truncate" aria-live="polite">
              {state.status}
            </p>
          </div>
          <div className="text-right flex-shrink-0 tabular-nums">
            <div className="text-heading-md text-ink">{pct === null ? '—' : `${pct}%`}</div>
            <div className="text-body-xs text-mute">{formatElapsed(now - state.startedAt)}</div>
          </div>
        </div>

        <div className="px-5 pb-4 flex flex-col gap-2">
          <ProgressBar progress={state.progress} />
          {state.detail && <p className="text-body-xs text-mute">{state.detail}</p>}
        </div>

        {state.steps && state.steps.length > 0 && (
          <ul className="px-5 pb-5 flex flex-col gap-1.5">
            {state.steps.map((step) => (
              <li
                key={step.key}
                className={`flex items-center gap-2.5 text-body-sm ${step.state === 'active' ? 'text-ink font-medium' : step.state === 'done' ? 'text-body' : 'text-mute'}`}
              >
                <StepGlyph state={step.state} />
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        )}

        {state.items && state.items.length > 0 && (
          <div className="border-t border-hairline">
            <div className="px-5 py-2 flex items-center justify-between">
              <span className="eyebrow">Queries</span>
              <span className="text-body-xs text-mute tabular-nums">
                {doneItems} / {state.items.length}
              </span>
            </div>
            <ul className="max-h-52 overflow-y-auto divide-y divide-hairline-soft border-t border-hairline-soft">
              {state.items.map((item) => (
                <li key={item.id} className="px-5 py-2 flex items-center gap-2.5 text-body-sm">
                  <ItemGlyph state={item.state} />
                  <PlatformBadge platform={item.platform} />
                  <span className="text-ink truncate flex-1">{item.label}</span>
                  {item.meta && <span className="text-body-xs text-mute whitespace-nowrap tabular-nums">{item.meta}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {onCancel && (
          <div className="px-5 py-3 border-t border-hairline bg-canvas flex items-center justify-between gap-4">
            <span className="text-body-xs text-mute">
              {state.cancelNote ?? 'Stopping closes this view. Work already sent to the server still completes and is saved to the session.'}
            </span>
            <button type="button" onClick={onCancel} className="btn-ghost btn-sm whitespace-nowrap">
              {state.cancelLabel ?? 'Stop waiting'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
