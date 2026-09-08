'use client';

import React from 'react';
import { CandidateProfile, CandidateStatus } from '@/lib/types';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';

interface KanbanBoardProps {
  candidates: CandidateProfile[];
  onSelectCandidate: (candidate: CandidateProfile) => void;
  onStatusChange: (id: string, newStatus: CandidateStatus) => void;
  onOpenOutreach: (candidate: CandidateProfile) => void;
}

const STAGES: { id: CandidateStatus; label: string }[] = [
  { id: 'New', label: 'New' },
  { id: 'Reviewed', label: 'Reviewed' },
  { id: 'Saved', label: 'Saved' },
  { id: 'Contacted', label: 'Contacted' },
  { id: 'Replied', label: 'Replied' },
  { id: 'Shortlisted', label: 'Shortlisted' },
];

export function KanbanBoard({ candidates, onSelectCandidate, onStatusChange, onOpenOutreach }: KanbanBoardProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar -mx-1 px-1">
      {STAGES.map((stage, idx) => {
        const items = candidates.filter((c) => c.status === stage.id);
        const next = STAGES[idx + 1];
        return (
          <section key={stage.id} className="w-[264px] flex-shrink-0 well p-2 flex flex-col gap-2" aria-label={stage.label}>
            <header className="flex items-center justify-between px-2 pt-1.5 pb-2 border-b border-hairline">
              <h3 className="eyebrow text-ink">{stage.label}</h3>
              <span className="text-body-xs text-mute tabular-nums">{items.length}</span>
            </header>

            <div className="flex flex-col gap-2 max-h-[62vh] overflow-y-auto pr-0.5">
              {items.length === 0 ? (
                <p className="px-2 py-6 text-center text-body-xs text-faint">Nothing here</p>
              ) : (
                items.map((c) => (
                  <article key={c.id} className="card p-3 flex flex-col gap-2.5 hover:border-faint transition-colors">
                    <div className="flex items-start gap-2.5">
                      <Avatar name={c.name} src={c.avatar_url} size={28} />
                      <div className="min-w-0">
                        <button type="button" onClick={() => onSelectCandidate(c)} className="text-body-sm font-medium text-ink hover:underline text-left truncate block">
                          {c.name}
                        </button>
                        <p className="text-body-xs text-mute line-clamp-1">{c.headline}</p>
                        {c.job_title && <p className="text-body-xs text-faint line-clamp-1">from {c.job_title}</p>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <PlatformBadge platform={c.platform} />
                      <span className="text-body-sm font-medium text-ink tabular-nums">{c.match_score}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-hairline">
                      {next ? (
                        <button type="button" onClick={() => onStatusChange(c.id, next.id)} className="btn-subtle btn-sm -ml-2">
                          → {next.label}
                        </button>
                      ) : (
                        <span />
                      )}
                      <button type="button" onClick={() => onOpenOutreach(c)} className="btn-ghost btn-sm">
                        Message
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
