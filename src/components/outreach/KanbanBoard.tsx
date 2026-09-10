'use client';

import React, { useMemo, useState } from 'react';
import { Archive, ArrowRight, ChevronDown } from 'lucide-react';
import { CandidateProfile, CandidateStatus } from '@/lib/types';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';
import { TrackingChips } from '@/components/candidates/TrackingChips';
import { BOARD_STAGES, compareForBoard, followUpState, nextManualStage, stageLabel } from '@/lib/pipeline/stages';

interface KanbanBoardProps {
  candidates: CandidateProfile[];
  onSelectCandidate: (candidate: CandidateProfile) => void;
  onStatusChange: (id: string, newStatus: CandidateStatus) => void;
  onOpenOutreach: (candidate: CandidateProfile) => void;
}

// ---------------------------------------------------------------------------
// The board reads left to right as the funnel (see src/lib/pipeline/stages.ts):
// New → Reviewed → Saved → Shortlisted → Contacted → Replied, with Archived as
// a collapsed bucket at the end. Inside a column, whoever needs attention first
// is on top: overdue follow-ups, then due today, then soonest.
//
// Moving right is a decision, so it is a button, not a drag; the one move
// that is not a decision — Shortlisted → Contacted — happens by logging
// outreach, which is what the "Message" action does.
// ---------------------------------------------------------------------------

export function KanbanBoard({ candidates, onSelectCandidate, onStatusChange, onOpenOutreach }: KanbanBoardProps) {
  const [showArchived, setShowArchived] = useState(false);
  const now = Date.now();

  const byStage = useMemo(() => {
    const map = new Map<CandidateStatus, CandidateProfile[]>();
    for (const c of candidates) map.set(c.status, [...(map.get(c.status) ?? []), c]);
    for (const [k, list] of map) map.set(k, list.sort((a, b) => compareForBoard(a, b, now)));
    return map;
  }, [candidates, now]);

  const archived = byStage.get('Archived') ?? [];

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar -mx-1 px-1" data-kanban>
      {BOARD_STAGES.map((stage) => {
        const items = byStage.get(stage.id) ?? [];
        const attention = items.filter((c) => {
          const s = followUpState(c.next_follow_up, now);
          return s.kind === 'overdue' || s.kind === 'today';
        }).length;
        return (
          <section key={stage.id} className="w-[272px] flex-shrink-0 well p-2 flex flex-col gap-2" aria-label={stage.label} data-stage={stage.id}>
            <header className="px-2 pt-1.5 pb-2 border-b border-hairline">
              <div className="flex items-center justify-between">
                <h3 className="eyebrow text-ink">{stage.label}</h3>
                <span className="flex items-center gap-1.5 text-body-xs tabular-nums">
                  {attention > 0 && (
                    <span className="chip border-warning bg-warning-soft text-warning-deep h-[18px] px-1.5" title="Follow-ups due or overdue">
                      {attention} due
                    </span>
                  )}
                  <span className="text-mute">{items.length}</span>
                </span>
              </div>
              <p className="text-body-xs text-faint mt-0.5">{stage.hint}</p>
            </header>

            <div className="flex flex-col gap-2 max-h-[62vh] overflow-y-auto pr-0.5">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-body-xs text-faint">Nothing here</p>
              ) : (
                items.map((c) => <BoardCard key={c.id} candidate={c} onSelect={onSelectCandidate} onStatusChange={onStatusChange} onOpenOutreach={onOpenOutreach} />)
              )}
            </div>
          </section>
        );
      })}

      {/* Archived: a bucket, not a stage — collapsed until asked for. */}
      <section className={`flex-shrink-0 well p-2 flex flex-col gap-2 transition-[width] ${showArchived ? 'w-[272px]' : 'w-[56px]'}`} aria-label="Archived" data-stage="Archived">
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={`flex items-center gap-2 px-2 pt-1.5 pb-2 border-b border-hairline text-left ${showArchived ? 'justify-between' : 'flex-col'}`}
          aria-expanded={showArchived}
        >
          <span className="flex items-center gap-1.5 eyebrow text-mute">
            <Archive className="w-3.5 h-3.5" /> {showArchived && 'Archived'}
          </span>
          <span className="text-body-xs text-mute tabular-nums">{archived.length}</span>
          {showArchived && <ChevronDown className="w-3.5 h-3.5 text-mute rotate-90" />}
        </button>
        {showArchived && (
          <div className="flex flex-col gap-2 max-h-[62vh] overflow-y-auto pr-0.5">
            {archived.length === 0 ? (
              <p className="px-2 py-6 text-center text-body-xs text-faint">Nothing archived</p>
            ) : (
              archived.map((c) => <BoardCard key={c.id} candidate={c} onSelect={onSelectCandidate} onStatusChange={onStatusChange} onOpenOutreach={onOpenOutreach} />)
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function BoardCard({
  candidate: c,
  onSelect,
  onStatusChange,
  onOpenOutreach,
}: {
  candidate: CandidateProfile;
  onSelect: (c: CandidateProfile) => void;
  onStatusChange: (id: string, s: CandidateStatus) => void;
  onOpenOutreach: (c: CandidateProfile) => void;
}) {
  const next = nextManualStage(c.status);
  const fu = followUpState(c.next_follow_up);
  const urgent = fu.kind === 'overdue' || fu.kind === 'today';

  return (
    <article className={`card p-3 flex flex-col gap-2.5 hover:border-faint transition-colors ${urgent ? 'border-warning' : ''}`} data-candidate-status={c.status}>
      <div className="flex items-start gap-2.5">
        <Avatar name={c.name} src={c.avatar_url} size={28} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onSelect(c)} className="w-full max-w-full text-body-sm font-medium text-ink hover:underline text-left truncate block" title={c.name}>
            {c.name}
          </button>
          <p className="text-body-xs text-mute line-clamp-1">{c.headline}</p>
          {c.job_title && <p className="text-body-xs text-faint line-clamp-1">from {c.job_title}</p>}
        </div>
        <span className="text-body-sm font-medium text-ink tabular-nums flex-shrink-0">{c.match_score}</span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <PlatformBadge platform={c.platform} />
        <TrackingChips candidate={c} compact />
      </div>

      <div className="flex items-center justify-between gap-1 pt-2 border-t border-hairline">
        {c.status === 'Shortlisted' ? (
          <button type="button" onClick={() => onOpenOutreach(c)} className="btn-primary btn-sm">
            Message <ArrowRight className="w-3 h-3" />
          </button>
        ) : next ? (
          <button type="button" onClick={() => onStatusChange(c.id, next)} className="btn-subtle btn-sm -ml-2" title={`Move to ${stageLabel(next)}`}>
            <ArrowRight className="w-3 h-3" /> {stageLabel(next)}
          </button>
        ) : c.status === 'Archived' ? (
          <button type="button" onClick={() => onStatusChange(c.id, 'Reviewed')} className="btn-subtle btn-sm -ml-2">
            Restore
          </button>
        ) : (
          <button type="button" onClick={() => onStatusChange(c.id, 'Archived')} className="btn-subtle btn-sm -ml-2 text-mute">
            <Archive className="w-3 h-3" /> Archive
          </button>
        )}
        {c.status !== 'Shortlisted' && c.status !== 'Archived' && (
          <button type="button" onClick={() => onOpenOutreach(c)} className="btn-ghost btn-sm">
            {c.status === 'Contacted' || c.status === 'Replied' ? 'Follow up' : 'Message'}
          </button>
        )}
      </div>
    </article>
  );
}
