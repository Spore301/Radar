'use client';

import React from 'react';
import { Clock, Send, CalendarClock } from 'lucide-react';
import type { CandidateProfile } from '@/lib/types';
import { channelDef, followUpLabel, followUpState, relativeAgo, stageLabel } from '@/lib/pipeline/stages';

// ---------------------------------------------------------------------------
// The tracking facts about a candidate, as chips: how long they have sat in
// the current stage, the last outreach (channel and when), and the follow-up
// — overdue or due today in the warning colour, since that is the one thing
// on a board a recruiter must not miss. Renders nothing for an untouched row.
// ---------------------------------------------------------------------------

export function TrackingChips({ candidate, compact = false }: { candidate: CandidateProfile; compact?: boolean }) {
  const fu = followUpState(candidate.next_follow_up);
  const showStage = candidate.status !== 'New' && candidate.stage_changed_at;
  const showOutreach = Boolean(candidate.outreach_date);
  if (!showStage && !showOutreach && fu.kind === 'none') return null;

  const urgent = fu.kind === 'overdue' || fu.kind === 'today';

  return (
    <div className="flex flex-wrap gap-1 min-w-0" data-tracking-chips>
      {showStage && (
        <span className="chip" title={`In ${stageLabel(candidate.status)} since ${new Date(candidate.stage_changed_at!).toLocaleDateString()}`}>
          <Clock className="w-3 h-3" /> {compact ? relativeAgo(candidate.stage_changed_at) : `${stageLabel(candidate.status)} · ${relativeAgo(candidate.stage_changed_at)}`}
        </span>
      )}
      {showOutreach && candidate.outreach_channel && (
        <span className="chip" title={`Last outreach ${new Date(candidate.outreach_date!).toLocaleString()}`}>
          <Send className="w-3 h-3" /> {channelDef(candidate.outreach_channel).short} · {relativeAgo(candidate.outreach_date)}
        </span>
      )}
      {fu.kind !== 'none' && (
        <span
          className={`chip ${urgent ? 'border-warning bg-warning-soft text-warning-deep' : ''}`}
          title={`Follow-up ${new Date(candidate.next_follow_up!).toLocaleDateString()}`}
          data-follow-up={fu.kind}
        >
          <CalendarClock className="w-3 h-3" /> {followUpLabel(fu)}
        </span>
      )}
    </div>
  );
}
