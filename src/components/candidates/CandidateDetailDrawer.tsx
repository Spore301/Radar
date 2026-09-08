'use client';

import React, { useEffect, useState } from 'react';
import { CandidateProfile, OutreachChannel, CandidateStatus } from '@/lib/types';
import { X, ExternalLink, MapPin } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';
import { scoreTier, TIER_LABEL, TIER_TEXT } from '@/lib/utils/tier';

interface CandidateDetailDrawerProps {
  candidate: CandidateProfile;
  onClose: () => void;
  /** Persists the edit; when it returns a promise the footer shows "Saving…" until it settles. */
  onUpdateCandidate: (updated: CandidateProfile) => void | Promise<void>;
  onOpenAIGenerator: (candidate: CandidateProfile) => void;
}

const BREAKDOWN: Array<{ key: keyof CandidateProfile['match_breakdown']; label: string; max: number }> = [
  { key: 'skills_must_have_score', label: 'Must-have skills', max: 40 },
  { key: 'skills_nice_to_have_score', label: 'Nice-to-have skills', max: 15 },
  { key: 'seniority_score', label: 'Seniority', max: 20 },
  { key: 'location_score', label: 'Location / remote', max: 15 },
  { key: 'domain_score', label: 'Domain', max: 10 },
];

// Mounted only with a candidate; callers pass `key={candidate.id}` so switching
// candidates remounts fresh state.
export function CandidateDetailDrawer({ candidate, onClose, onUpdateCandidate, onOpenAIGenerator }: CandidateDetailDrawerProps) {
  const [status, setStatus] = useState<CandidateStatus>(candidate.status);
  const [channel, setChannel] = useState<OutreachChannel>(candidate.outreach_channel || 'LinkedIn DM');
  const [notes, setNotes] = useState(candidate.notes || '');
  const [nextFollowUp, setNextFollowUp] = useState(candidate.next_follow_up ? candidate.next_follow_up.slice(0, 10) : '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(candidate.tags || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty =
    status !== candidate.status ||
    channel !== (candidate.outreach_channel || 'LinkedIn DM') ||
    notes !== (candidate.notes || '') ||
    nextFollowUp !== (candidate.next_follow_up ? candidate.next_follow_up.slice(0, 10) : '') ||
    JSON.stringify(tags) !== JSON.stringify(candidate.tags || []);

  const save = async () => {
    setSaving(true);
    try {
      await onUpdateCandidate({ ...candidate, status, outreach_channel: channel, notes, next_follow_up: nextFollowUp, tags });
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const tier = scoreTier(candidate.match_score);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 cursor-default" />
      <aside className="w-full max-w-[480px] h-full bg-elevated border-l border-hairline shadow-modal flex flex-col animate-slide-left">
        <header className="px-5 py-4 border-b border-hairline flex items-start gap-3">
          <Avatar name={candidate.name} src={candidate.avatar_url} size={40} />
          <div className="min-w-0 flex-1">
            <h2 id="drawer-title" className="text-heading-sm text-ink truncate">
              {candidate.name}
            </h2>
            <p className="text-body-sm text-body line-clamp-2">{candidate.headline}</p>
            <div className="mt-1.5 flex items-center gap-2 text-body-xs text-mute">
              <PlatformBadge platform={candidate.platform} />
              <span className="flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3" /> {candidate.location}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 flex items-center gap-2 border-b border-hairline">
            <a href={candidate.profile_url} target="_blank" rel="noopener noreferrer" className="btn-ghost flex-1">
              View profile <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button type="button" onClick={() => onOpenAIGenerator(candidate)} className="btn-primary flex-1">
              Draft outreach
            </button>
          </div>

          <section className="px-5 py-4 border-b border-hairline flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Match</span>
              <span className="text-heading-md text-ink tabular-nums">
                {candidate.match_score}
                <span className={`text-body-sm ml-2 ${TIER_TEXT[tier]}`}>{TIER_LABEL[tier]}</span>
              </span>
            </div>
            <dl className="grid grid-cols-[1fr_120px_44px] gap-x-3 gap-y-2 items-center text-body-sm">
              {BREAKDOWN.map((row) => {
                const v = candidate.match_breakdown[row.key];
                return (
                  <React.Fragment key={row.key}>
                    <dt className="text-body">{row.label}</dt>
                    <dd className="track">
                      <div className="track-fill" style={{ width: `${(v / row.max) * 100}%` }} />
                    </dd>
                    <dd className="text-body-xs text-mute tabular-nums text-right">
                      {v} / {row.max}
                    </dd>
                  </React.Fragment>
                );
              })}
            </dl>
            <p className="text-body-sm text-body">{candidate.match_rationale}</p>
            {candidate.missing_signals.length > 0 && (
              <ul className="text-body-xs text-mute flex flex-col gap-0.5">
                {candidate.missing_signals.map((m) => (
                  <li key={m}>· {m}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-5 py-4 border-b border-hairline flex flex-col gap-2">
            <span className="eyebrow">Detected skills</span>
            <div className="flex flex-wrap gap-1">
              {candidate.skills_detected.length === 0 && <span className="text-body-sm text-faint">None of the listed skills appear in the indexed snippet.</span>}
              {candidate.skills_detected.map((s) => (
                <span key={s} className="chip text-ink">
                  {s}
                </span>
              ))}
            </div>
          </section>

          <section className="px-5 py-4 border-b border-hairline flex flex-col gap-2">
            <span className="eyebrow">Indexed snippet</span>
            <p className="text-body-sm text-body leading-relaxed">{candidate.summary_snippet}</p>
          </section>

          <section className="px-5 py-4 flex flex-col gap-4">
            <span className="eyebrow">Pipeline</span>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Stage</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as CandidateStatus)} className="select">
                  <option value="New">New</option>
                  <option value="Reviewed">Reviewed</option>
                  <option value="Saved">Saved</option>
                  <option value="Contacted">Contacted</option>
                  <option value="Replied">Replied</option>
                  <option value="Shortlisted">Shortlisted</option>
                  <option value="Archived">Archived</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="field-label">Channel</span>
                <select value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} className="select">
                  <option value="LinkedIn DM">LinkedIn DM</option>
                  <option value="Email">Email</option>
                  <option value="WhatsApp">WhatsApp</option>
                  <option value="Call">Call</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 col-span-2">
                <span className="field-label">Next follow-up</span>
                <input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} className="input" />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Notes</span>
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Private recruiter notes" className="textarea" />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="field-label">Tags</span>
              <div className="flex flex-wrap items-center gap-1.5 min-h-8 px-2 py-1.5 bg-elevated border border-hairline rounded-sm focus-within:border-ink">
                {tags.map((t) => (
                  <span key={t} className="chip text-ink">
                    {t}
                    <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="text-mute hover:text-ink">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  onBlur={addTag}
                  placeholder={tags.length ? 'Add…' : 'Add a tag and press Enter'}
                  className="flex-1 min-w-[100px] h-5 bg-transparent text-body-sm text-ink outline-none"
                />
              </div>
            </div>
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-hairline bg-canvas flex items-center justify-between gap-3">
          <span className="text-body-xs text-mute" aria-live="polite">
            {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved to the session'}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Close
            </button>
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
