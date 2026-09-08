'use client';

import React, { useEffect, useState } from 'react';
import { CandidateProfile, OutreachChannel } from '@/lib/types';
import { Copy, Check, X, RefreshCw, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';

interface OutreachGeneratorModalProps {
  onClose: () => void;
  candidate: CandidateProfile;
  jobTitle?: string;
  onSaveOutreachLog?: (candidateId: string, channel: OutreachChannel, message: string) => void;
}

type Tone = 'Warm' | 'Professional' | 'Direct' | 'Short & Punchy';

// Mounted only with a candidate; callers pass `key={candidate.id}` so switching
// candidates remounts fresh state.
export function OutreachGeneratorModal({ onClose, candidate, jobTitle = 'the role', onSaveOutreachLog }: OutreachGeneratorModalProps) {
  const [tone, setTone] = useState<Tone>('Warm');
  const [channel, setChannel] = useState<OutreachChannel>('LinkedIn DM');
  const [subjectLine, setSubjectLine] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/generate-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate, jobTitle, companyName: 'CandidateRadar', tone, channel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not draft a message.');
      setSubjectLine(data.subject_line || '');
      setMessageBody(data.message_body || '');
    } catch (e: any) {
      setError(e?.message || 'Could not draft a message.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id, tone, channel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(subjectLine ? `Subject: ${subjectLine}\n\n${messageBody}` : messageBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };

  const log = () => {
    onSaveOutreachLog?.(candidate.id, channel, subjectLine ? `Subject: ${subjectLine}\n\n${messageBody}` : messageBody);
    onClose();
  };

  const words = messageBody.split(/\s+/).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="outreach-title">
      <div className="card shadow-modal w-full max-w-[680px] max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-5 py-4 border-b border-hairline flex items-center gap-3">
          <Avatar name={candidate.name} src={candidate.avatar_url} size={32} />
          <div className="min-w-0 flex-1">
            <h2 id="outreach-title" className="text-label-sm text-ink truncate">
              Outreach to {candidate.name}
            </h2>
            <p className="text-body-xs text-mute truncate">
              {jobTitle} · grounded in the indexed profile only
            </p>
          </div>
          <PlatformBadge platform={candidate.platform} />
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Tone</span>
              <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className="select">
                <option value="Warm">Warm</option>
                <option value="Professional">Professional</option>
                <option value="Direct">Direct</option>
                <option value="Short & Punchy">Short & punchy · under 80 words</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} className="select">
                <option value="LinkedIn DM">LinkedIn DM</option>
                <option value="Email">Email · with subject line</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Call">Call script</option>
              </select>
            </label>
          </div>

          {channel === 'Email' && (
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Subject</span>
              <input value={subjectLine} onChange={(e) => setSubjectLine(e.target.value)} className="input" />
            </label>
          )}

          <label className="flex flex-col gap-1.5 relative">
            <span className="field-label flex justify-between">
              Message <span className="text-mute font-normal tabular-nums">{words} words</span>
            </span>
            <textarea rows={9} value={messageBody} onChange={(e) => setMessageBody(e.target.value)} className="textarea" />
            {isLoading && (
              <div className="absolute inset-x-0 bottom-0 top-6 rounded-sm bg-elevated/80 flex items-center justify-center gap-2 text-body-sm text-body">
                <Loader2 className="w-4 h-4 animate-spin" /> Drafting…
              </div>
            )}
          </label>

          {error && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}

          <p className="text-body-xs text-mute">
            Uses only what was indexed: {candidate.skills_detected.length ? candidate.skills_detected.slice(0, 4).join(', ') : 'headline and snippet'}.
          </p>
        </div>

        <footer className="px-5 py-3 border-t border-hairline bg-canvas flex items-center justify-between gap-3">
          <button type="button" onClick={() => void generate()} disabled={isLoading} className="btn-ghost">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void copy()} className="btn-ghost" disabled={!messageBody}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={log} className="btn-primary" disabled={!messageBody || isLoading}>
              Log as sent
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
