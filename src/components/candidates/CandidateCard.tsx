'use client';

import React from 'react';
import { CandidateProfile } from '@/lib/types';
import { MapPin, ExternalLink, Check } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';
import { scoreTier, TIER_BG, TIER_LABEL, TIER_TEXT } from '@/lib/utils/tier';

interface CandidateCardProps {
  candidate: CandidateProfile;
  onSelect: (candidate: CandidateProfile) => void;
  onStatusChange: (id: string, newStatus: CandidateProfile['status']) => void;
  onOpenOutreach: (candidate: CandidateProfile) => void;
  viewMode?: 'grid' | 'list';
}

export function ScoreBar({ score, className = '' }: { score: number; className?: string }) {
  const tier = scoreTier(score);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-body-sm font-semibold text-ink tabular-nums w-6 text-right">{score}</span>
      <div className="track flex-1">
        <div className={`h-full rounded-full ${TIER_BG[tier]}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-body-xs w-14 ${TIER_TEXT[tier]}`}>{TIER_LABEL[tier]}</span>
    </div>
  );
}

export function CandidateCard({ candidate, onSelect, onStatusChange, onOpenOutreach, viewMode = 'grid' }: CandidateCardProps) {
  const shortlisted = candidate.status === 'Shortlisted';

  const actions = (
    <div className="flex items-center gap-1.5">
      {shortlisted ? (
        <span className="chip-ink">
          <Check className="w-3 h-3" strokeWidth={2.5} /> Shortlisted
        </span>
      ) : (
        <button type="button" onClick={() => onStatusChange(candidate.id, 'Shortlisted')} className="btn-ghost btn-sm">
          Shortlist
        </button>
      )}
      <button type="button" onClick={() => onOpenOutreach(candidate)} className="btn-primary btn-sm">
        Outreach
      </button>
    </div>
  );

  if (viewMode === 'list') {
    return (
      <div className="card px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 hover:border-faint transition-colors">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar name={candidate.name} src={candidate.avatar_url} size={32} />
          <div className="min-w-0">
            <button type="button" onClick={() => onSelect(candidate)} className="text-body-sm font-medium text-ink hover:underline truncate block text-left">
              {candidate.name}
            </button>
            <p className="text-body-xs text-mute truncate">{candidate.headline}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-body-xs text-mute md:w-56 min-w-0">
          <PlatformBadge platform={candidate.platform} />
          <span className="truncate flex items-center gap-1">
            <MapPin className="w-3 h-3" /> {candidate.location}
          </span>
        </div>
        <ScoreBar score={candidate.match_score} className="md:w-52" />
        {actions}
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-col gap-3 hover:border-faint transition-colors">
      <div className="flex items-start gap-3">
        <Avatar name={candidate.name} src={candidate.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onSelect(candidate)} className="text-body-md font-medium text-ink hover:underline truncate block text-left leading-5">
            {candidate.name}
          </button>
          <p className="text-body-sm text-mute line-clamp-1">{candidate.headline}</p>
        </div>
        <button type="button" onClick={() => onSelect(candidate)} className="btn-icon h-7 w-7" aria-label="Open details">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      <ScoreBar score={candidate.match_score} />

      <div className="flex flex-wrap gap-1 min-h-[22px]">
        {candidate.skills_detected.slice(0, 4).map((skill) => (
          <span key={skill} className="chip">
            {skill}
          </span>
        ))}
        {candidate.skills_detected.length > 4 && <span className="chip text-mute">+{candidate.skills_detected.length - 4}</span>}
        {candidate.skills_detected.length === 0 && <span className="text-body-xs text-faint">No listed skills matched in the snippet</span>}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-hairline">
        <div className="flex items-center gap-2 text-body-xs text-mute min-w-0">
          <PlatformBadge platform={candidate.platform} />
          <span className="truncate flex items-center gap-1">
            <MapPin className="w-3 h-3 flex-shrink-0" /> {candidate.location}
          </span>
        </div>
        {actions}
      </div>
    </div>
  );
}
