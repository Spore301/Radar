'use client';

import React, { useEffect, useState } from 'react';
import { CandidateProfile, OutreachChannel } from '@/lib/types';
import { Copy, Check, X, RefreshCw, Loader2, Sparkles, FileText } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { CHANNELS, channelDef } from '@/lib/pipeline/stages';
import { readStoredApiKeys } from '@/lib/api/sessions';

interface OutreachGeneratorModalProps {
  onClose: () => void;
  candidate: CandidateProfile;
  jobTitle?: string;
  onSaveOutreachLog?: (candidateId: string, channel: OutreachChannel, message: string) => void;
}

type Tone = 'Warm' | 'Professional' | 'Direct' | 'Short & Punchy';

/**
 * Which channel to open on:
 *  - a connection note has actually been SENT (outreach_date set) → the next
 *    touch is a LinkedIn message, once they accept;
 *  - otherwise the recruiter's stored preference, if any;
 *  - otherwise the platform default: a connection note on LinkedIn, email elsewhere.
 */
function defaultChannel(c: CandidateProfile): OutreachChannel {
  if (c.outreach_date && c.outreach_channel === 'LinkedIn Note') return 'LinkedIn DM';
  if (c.outreach_channel) return c.outreach_channel;
  return c.platform === 'LinkedIn' ? 'LinkedIn Note' : 'Email';
}

// Mounted only with a candidate; callers pass a key so switching candidates
// remounts fresh state.
export function OutreachGeneratorModal({ onClose, candidate, jobTitle = 'the role', onSaveOutreachLog }: OutreachGeneratorModalProps) {
  const [tone, setTone] = useState<Tone>('Warm');
  const [channel, setChannel] = useState<OutreachChannel>(() => defaultChannel(candidate));
  const [subjectLine, setSubjectLine] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [grounding, setGrounding] = useState<string[]>([]);
  const [source, setSource] = useState<'ai' | 'template' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const def = channelDef(channel);
  const chars = messageBody.length;
  const overCap = Boolean(def.maxChars && chars > def.maxChars);
  const words = messageBody.split(/\s+/).filter(Boolean).length;

  const generate = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const keys = readStoredApiKeys();
      const res = await fetch('/api/generate-outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(keys.deepseek ? { 'x-deepseek-api-key': keys.deepseek } : {}) },
        body: JSON.stringify({ candidate, jobTitle, tone, channel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not draft a message.');
      setSubjectLine(data.subject_line || '');
      setMessageBody(data.message_body || '');
      setGrounding(Array.isArray(data.grounding) ? data.grounding : []);
      setSource(data.source === 'ai' ? 'ai' : 'template');
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

  const fullText = () => (subjectLine && def.hasSubject ? `Subject: ${subjectLine}\n\n${messageBody}` : messageBody);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked
    }
  };

  const log = () => {
    if (overCap) return;
    onSaveOutreachLog?.(candidate.id, channel, fullText());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="outreach-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
              <span className="field-label">Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} className="select" aria-label="Channel">
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.maxChars ? ` · ${c.maxChars} chars` : c.hasSubject ? ' · with subject' : ''}
                  </option>
                ))}
              </select>
              <span className="text-body-xs text-mute">{def.hint}</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Tone</span>
              <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className="select" aria-label="Tone">
                <option value="Warm">Warm</option>
                <option value="Professional">Professional</option>
                <option value="Direct">Direct</option>
                <option value="Short & Punchy">Short & punchy</option>
              </select>
            </label>
          </div>

          {def.hasSubject && (
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Subject</span>
              <input value={subjectLine} onChange={(e) => setSubjectLine(e.target.value)} className="input" />
            </label>
          )}

          <label className="flex flex-col gap-1.5 relative">
            <span className="field-label flex justify-between">
              <span>{channel === 'LinkedIn Note' ? 'Connection note' : channel === 'Call' ? 'Call script' : 'Message'}</span>
              <span className={`font-normal tabular-nums ${overCap ? 'text-error-deep' : 'text-mute'}`} data-char-count={chars}>
                {def.maxChars ? `${chars} / ${def.maxChars} characters` : `${words} words`}
              </span>
            </span>
            <textarea
              rows={channel === 'LinkedIn Note' ? 5 : 9}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className={`textarea ${overCap ? 'border-error' : ''}`}
              aria-invalid={overCap || undefined}
            />
            {isLoading && (
              <div className="absolute inset-x-0 bottom-0 top-6 rounded-sm bg-elevated/80 flex items-center justify-center gap-2 text-body-sm text-body">
                <Loader2 className="w-4 h-4 animate-spin" /> Drafting…
              </div>
            )}
          </label>

          {overCap && (
            <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">
              LinkedIn will refuse a note over {def.maxChars} characters. Trim {chars - (def.maxChars ?? 0)} to log it as sent.
            </div>
          )}
          {error && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}

          <div className="flex flex-wrap items-center gap-1.5 text-body-xs text-mute">
            {source && (
              <span className="chip" title={source === 'ai' ? 'Written by the model from the indexed profile' : 'Deterministic template — add a DeepSeek key in Settings for a written draft'}>
                {source === 'ai' ? <Sparkles className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                {source === 'ai' ? 'AI draft' : 'Template'}
              </span>
            )}
            <span>Uses only:</span>
            {(grounding.length ? grounding : candidate.skills_detected.length ? candidate.skills_detected.slice(0, 4).map((s) => `skill: ${s}`) : ['headline and snippet']).map((g) => (
              <span key={g} className="chip">
                {g}
              </span>
            ))}
          </div>
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
            <button type="button" onClick={log} className="btn-primary" disabled={!messageBody || isLoading || overCap} title={overCap ? 'Over the character limit' : undefined}>
              Log as sent
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
