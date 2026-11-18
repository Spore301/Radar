'use client';

import React from 'react';
import { CandidateProfile } from '@/lib/types';
import { MapPin, ExternalLink, Check, Building2, Briefcase } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';
import { scoreTier, TIER_BG, TIER_LABEL, TIER_TEXT } from '@/lib/utils/tier';
import { getCandidateFacets, locationDisplay } from '@/lib/filters/candidateFilters';
import { TrackingChips } from './TrackingChips';

/**
 * The quiet "where / who for" line: location from the candidate's facets
 * ("Bengaluru, India", "India · from profile URL", or "Location not stated")
 * and the current company when the result names one. Never shows the raw
 * stored location string, which can hold headline fragments.
 */
export function CandidateFacetLine({ candidate, className = '' }: { candidate: CandidateProfile; className?: string }) {
  const facets = getCandidateFacets(candidate);
  const loc = locationDisplay(facets.location);
  const company = facets.current_company?.trim() || null;
  return (
    <p className={`flex items-center gap-1 min-w-0 text-body-xs text-mute ${className}`} data-facet-location={loc.known ? loc.text : ''}>
      <MapPin className="w-3 h-3 flex-shrink-0" aria-hidden />
      <span className="sr-only">Location: </span>
      <span className={`truncate ${loc.known ? '' : 'text-faint'}`} title={loc.title}>
        {loc.text}
        {loc.note && <span className="text-faint"> · {loc.note}</span>}
      </span>
      {company && (
        <>
          <span aria-hidden className="text-faint px-0.5">
            ·
          </span>
          <Briefcase className="w-3 h-3 flex-shrink-0" aria-hidden />
          <span className="sr-only">Current company: </span>
          <span className="truncate" title={`Current company, as the search result states it: ${company}`}>
            {company}
          </span>
        </>
      )}
    </p>
  );
}

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
        <div className={`h-full rounded-full ${TIER_BG[tier]}`} style={{ width: `${score}%` }} data-tier={tier} />
      </div>
      <span className={`text-body-xs w-14 ${TIER_TEXT[tier]}`}>{TIER_LABEL[tier]}</span>
    </div>
  );
}

// A <button> is shrink-to-fit even at display:block, so `truncate` alone never
// clips it — it needs an explicit width to overflow against. Hence w-full here
// and in every other name button (board, table).
const NAME_BUTTON = 'w-full max-w-full text-left truncate block hover:underline text-ink font-medium';

export function CandidateCard({ candidate, onSelect, onStatusChange, onOpenOutreach, viewMode = 'grid' }: CandidateCardProps) {
  const shortlisted = candidate.status === 'Shortlisted';
  const contacted = candidate.status === 'Contacted' || candidate.status === 'Replied';

  const actions = (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {shortlisted ? (
        <span className="chip-ink">
          <Check className="w-3 h-3" strokeWidth={2.5} /> Shortlisted
        </span>
      ) : contacted ? null : (
        <button type="button" onClick={() => onStatusChange(candidate.id, 'Shortlisted')} className="btn-ghost btn-sm">
          Shortlist
        </button>
      )}
      <button type="button" onClick={() => onOpenOutreach(candidate)} className="btn-primary btn-sm">
        {contacted ? 'Follow up' : 'Outreach'}
      </button>
    </div>
  );

  if (viewMode === 'list') {
    return (
      <div className="card px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 hover:border-faint transition-colors">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar name={candidate.name} src={candidate.avatar_url} size={32} />
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => onSelect(candidate)} className={`${NAME_BUTTON} text-body-sm`} title={candidate.name}>
              {candidate.name}
            </button>
            <p className="text-body-xs text-mute truncate">{candidate.headline}</p>
            <CandidateFacetLine candidate={candidate} className="mt-0.5" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-body-xs text-mute md:w-56 min-w-0">
          <PlatformBadge platform={candidate.platform} />
          {candidate.organization_match && (
            <span className="chip-ink" data-org-match={candidate.organization_match}>
              <Building2 className="w-3 h-3" /> {candidate.organization_match}
            </span>
          )}
        </div>
        <ScoreBar score={candidate.match_score} className="md:w-52" />
        <TrackingChips candidate={candidate} compact />
        {actions}
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-col gap-3 hover:border-faint transition-colors">
      <div className="flex items-start gap-3">
        <Avatar name={candidate.name} src={candidate.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onSelect(candidate)} className={`${NAME_BUTTON} text-body-md leading-5`} title={candidate.name}>
            {candidate.name}
          </button>
          <p className="text-body-sm text-mute line-clamp-1">{candidate.headline}</p>
          <CandidateFacetLine candidate={candidate} className="mt-1" />
        </div>
        <button type="button" onClick={() => onSelect(candidate)} className="btn-icon h-7 w-7 flex-shrink-0" aria-label="Open details">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      <ScoreBar score={candidate.match_score} />

      <div className="flex flex-wrap gap-1 min-h-[22px]">
        {candidate.organization_match && (
          <span className="chip-ink" title="Required organisation found on the profile" data-org-match={candidate.organization_match}>
            <Building2 className="w-3 h-3" /> {candidate.organization_match}
          </span>
        )}
        {candidate.skills_detected.slice(0, 4).map((skill) => (
          <span key={skill} className="chip">
            {skill}
          </span>
        ))}
        {candidate.skills_detected.length > 4 && <span className="chip text-mute">+{candidate.skills_detected.length - 4}</span>}
        {candidate.skills_detected.length === 0 && <span className="text-body-xs text-faint">No listed skills matched in the snippet</span>}
      </div>

      <TrackingChips candidate={candidate} />

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-hairline">
        <div className="flex items-center gap-2 text-body-xs text-mute min-w-0">
          <PlatformBadge platform={candidate.platform} />
        </div>
        {actions}
      </div>
    </div>
  );
}
