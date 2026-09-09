'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Paperclip, ChevronDown, Loader2, Check, ExternalLink, X } from 'lucide-react';
import type { MergedConstraints, XRayQuery } from '@/lib/types';
import type { AgentMessage, AgentTurnResponse } from '@/lib/agent/types';
import { postNdjson } from '@/lib/api/stream';
import * as api from '@/lib/api/sessions';
import { notifySessionsChanged } from '@/lib/api/sessions';
import { QueryPreviewModal } from '@/components/ingestion/QueryPreviewModal';
import { ProcessingOverlay, ProcessingState, ProcessingLogItem } from '@/components/processing/ProcessingOverlay';
import { PlatformBadge, PlatformLogo } from '@/components/platforms/PlatformLogo';
import { getTemplate } from '@/lib/search/xrayTemplates';
import { platformLabel } from '@/lib/search/platforms';
import type { QueryRunResult } from '@/lib/search/x-raySearchService';
import { Avatar } from '@/components/ui/Avatar';

// ---------------------------------------------------------------------------
// Agent view. A conversation that does the whole flow: attach or paste a JD,
// or describe the role; the agent shows its reasoning trace, asks only for
// blocking gaps, and when constraints are complete offers the approved query
// bundle to review and run — same templates, same search, same session store.
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<string, string> = { read: 'Reading', extract: 'Extracting', reason: 'Reasoning', queries: 'Building queries', save: 'Saving' };

export function AgentChat() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionParam = params.get('session');

  const [sessionId, setSessionId] = useState<string | null>(sessionParam);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [constraints, setConstraints] = useState<MergedConstraints | null>(null);
  const [queries, setQueries] = useState<XRayQuery[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Restore a session's conversation.
  useEffect(() => {
    if (!sessionParam) return;
    (async () => {
      try {
        const d = await api.getSession(sessionParam);
        setSessionId(sessionParam);
        setConstraints(d.job.merged_constraints);
        setQueries(d.job.query_bundle);
        const t = (d.agent_transcript ?? []) as AgentMessage[];
        setMessages(t);
        const last = [...t].reverse().find((m) => m.role === 'assistant');
        setReady(Boolean(last?.ready) && d.job.query_bundle.length > 0);
      } catch (e: any) {
        setError(e?.message || 'Could not open that session.');
      }
    })();
  }, [sessionParam]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string, attach?: File | null) => {
      const content = text.trim();
      if (!content && !attach) return;
      setError(null);
      setBusy('Sending…');
      const optimistic: AgentMessage = {
        id: `tmp-${Date.now()}`,
        role: 'user',
        content: content || 'Here is the job description.',
        at: new Date().toISOString(),
        ...(attach ? { attachment: { name: attach.name, words: 0 } } : {}),
      };
      setMessages((m) => [...m, optimistic]);
      setDraft('');
      setFile(null);

      try {
        const keys = api.readStoredApiKeys();
        const headers: Record<string, string> = keys.deepseek ? { 'x-deepseek-api-key': keys.deepseek } : {};
        let init: RequestInit;
        if (attach) {
          const fd = new FormData();
          fd.append('file', attach);
          fd.append('text', content);
          if (sessionId) fd.append('sessionId', sessionId);
          init = { method: 'POST', body: fd, headers };
        } else {
          init = { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, text: content }) };
        }
        const res = await postNdjson<AgentTurnResponse>('/api/agent/turn', init, (ev) => {
          if (ev.type === 'stage') setBusy(`${STAGE_LABEL[ev.key] ?? ev.key}…`);
        });
        setSessionId(res.sessionId);
        setMessages(res.transcript);
        setConstraints(res.constraints);
        setReady(res.ready);
        if (res.queries.length) setQueries(res.queries);
        setOpenThoughts((o) => ({ ...o, [res.message.id]: true }));
        if (!sessionParam || sessionParam !== res.sessionId) router.replace(`/dashboard/agent?session=${encodeURIComponent(res.sessionId)}`);
        notifySessionsChanged();
      } catch (e: any) {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setError(e?.message || 'The agent could not respond.');
      } finally {
        setBusy(null);
      }
    },
    [sessionId, sessionParam, router]
  );

  // --- run the search from here -------------------------------------------------
  const runSearch = async (queriesToRun: XRayQuery[], depth: number) => {
    setModalOpen(false);
    if (!sessionId || !constraints) return;
    setError(null);
    const items: ProcessingLogItem[] = queriesToRun.map((q) => ({ id: q.id, platform: q.platform, label: getTemplate(q.query_type)?.label ?? 'Custom query', state: 'active', meta: 'queued' }));
    setProcessing({ stage: 'search', title: `Running ${queriesToRun.length} X-Ray queries individually`, status: 'Connecting…', progress: 0, items, startedAt: Date.now() });
    try {
      const data = await api.runSearch({ jobId: sessionId, constraints, queries: queriesToRun, apiKeys: api.readStoredApiKeys(), serpOptions: { maxPagesPerQuery: depth } }, (ev) => {
        if (ev.type === 'query_done') {
          const r = ev.result as QueryRunResult;
          setProcessing((p) =>
            p
              ? {
                  ...p,
                  progress: (ev.done / ev.total) * 0.9,
                  status: `${ev.done} of ${ev.total} queries done · ${ev.indexedSoFar} profiles indexed so far`,
                  items: p.items?.map((it) => (it.id === r.queryId ? { ...it, state: r.status === 'completed' ? 'done' : r.status === 'skipped' ? 'skipped' : 'failed', meta: r.status === 'completed' ? `${r.indexedCount}/${r.resultCount}` : r.error?.slice(0, 40) || r.status } : it)),
                }
              : p
          );
        } else if (ev.type === 'query_start') {
          setProcessing((p) => (p ? { ...p, status: `Searching ${platformLabel(ev.platform)} · ${getTemplate(ev.queryType)?.label ?? 'Custom'}…` } : p));
        } else if (ev.type === 'stage') {
          setProcessing((p) => (p ? { ...p, status: ev.label, progress: 0.95 } : p));
        }
      });
      setProcessing(null);
      setRunSummary(`Run complete · ${data.stats.queriesRun}/${data.stats.queriesRun + data.stats.queriesFailed} queries · ${data.stats.total} indexed · ${data.candidates.length} profiles stored${data.stats.creditsUsed ? ` · ${data.stats.creditsUsed} credits` : ''}`);
      notifySessionsChanged();
    } catch (e: any) {
      setProcessing(null);
      setError(e?.message || 'The search run failed.');
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft, file);
    }
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      {/* Conversation */}
      <section className="card flex flex-col min-h-[70vh] max-h-[calc(100vh-140px)]">
        <div ref={listRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="m-auto max-w-[52ch] text-center flex flex-col gap-3">
              <p className="text-heading-md">Describe the role, or attach the JD.</p>
              <p className="text-body-sm text-mute">
                I will extract the constraints, show you how I read them, ask only for what is missing, and build the same approved X-Ray queries the form would.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {['Senior React developer in Pune, must know TypeScript and Next.js', 'Hiring a Business Development Associate in Kolkata for our EdTech sales team', 'Product designer, Bengaluru or remote, strong on design systems in Figma'].map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="btn-ghost text-left h-auto py-1.5 whitespace-normal">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
              {m.role === 'assistant' && <Avatar name="Agent" size={28} className="mt-0.5" />}
              <div className={`max-w-[80%] flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : ''}`}>
                {m.role === 'assistant' && m.thoughts && m.thoughts.length > 0 && (
                  <div className="w-full rounded-sm border border-hairline bg-canvas">
                    <button type="button" onClick={() => setOpenThoughts((o) => ({ ...o, [m.id]: !o[m.id] }))} className="w-full flex items-center justify-between px-3 h-8 text-left" aria-expanded={Boolean(openThoughts[m.id])}>
                      <span className="eyebrow">Reasoning · {m.thoughts.length} steps</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-mute transition-transform ${openThoughts[m.id] ? 'rotate-180' : ''}`} />
                    </button>
                    {openThoughts[m.id] && (
                      <ol className="px-3 pb-3 flex flex-col gap-1.5 text-body-sm text-body list-decimal list-inside">
                        {m.thoughts.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
                <div className={`rounded-md px-3.5 py-2.5 text-body-md ${m.role === 'user' ? 'bg-ink text-white' : 'bg-elevated border border-hairline text-ink'}`}>
                  {m.attachment && (
                    <div className={`flex items-center gap-1.5 text-body-xs mb-1.5 ${m.role === 'user' ? 'text-white/70' : 'text-mute'}`}>
                      <Paperclip className="w-3 h-3" /> {m.attachment.name}
                      {m.attachment.words ? ` · ${m.attachment.words} words` : ''}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
                {m.role === 'assistant' && m.questions && m.questions.length > 0 && m.id === lastAssistant?.id && (
                  <div className="flex flex-col gap-2 w-full">
                    {m.questions.length > 1 && (
                      <ol className="text-body-sm text-body list-decimal list-inside">
                        {m.questions.map((q) => (
                          <li key={q.id}>{q.text}</li>
                        ))}
                      </ol>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {m.questions.flatMap((q) => (q.options ?? []).map((o) => (
                        <button key={`${q.id}-${o}`} type="button" onClick={() => void send(o)} className="btn-ghost btn-sm">
                          {o}
                        </button>
                      )))}
                    </div>
                  </div>
                )}
                {m.role === 'assistant' && m.ready && m.id === lastAssistant?.id && queries.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setModalOpen(true)} className="btn-primary">
                      Review {queries.length} queries
                    </button>
                    <button type="button" onClick={() => router.push(`/dashboard?session=${encodeURIComponent(sessionId ?? '')}`)} className="btn-ghost">
                      Open in dashboard <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex gap-3">
              <Avatar name="Agent" size={28} />
              <div className="rounded-md px-3.5 py-2.5 bg-elevated border border-hairline text-body-sm text-mute flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy}
              </div>
            </div>
          )}

          {runSummary && (
            <div className="rounded-sm border border-hairline bg-canvas px-3 py-2 text-body-sm text-ink flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4" strokeWidth={2.5} /> {runSummary}
              </span>
              <button type="button" onClick={() => router.push(`/dashboard?session=${encodeURIComponent(sessionId ?? '')}`)} className="btn-ghost btn-sm">
                Open results
              </button>
            </div>
          )}
          {error && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}
        </div>

        {/* Composer */}
        <div className="border-t border-hairline p-3 flex flex-col gap-2">
          {file && (
            <div className="flex items-center gap-2 text-body-xs text-body">
              <span className="chip">
                <Paperclip className="w-3 h-3" /> {file.name}
              </span>
              <button type="button" onClick={() => setFile(null)} className="btn-icon h-6 w-6" aria-label="Remove attachment">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-icon h-10 w-10 flex-shrink-0" aria-label="Attach job description" title="Attach a JD (PDF, DOCX, TXT)">
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              ref={textRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={messages.length ? 'Reply…' : 'Describe the role you are hiring for…'}
              className="textarea min-h-10 max-h-40 py-2.5"
              aria-label="Message the agent"
            />
            <button type="button" onClick={() => void send(draft, file)} disabled={busy !== null || (!draft.trim() && !file)} className="btn-primary h-10 w-10 px-0 flex-shrink-0" aria-label="Send">
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
          <p className="text-body-xs text-mute">Enter to send · Shift+Enter for a new line</p>
        </div>
      </section>

      {/* Constraints so far */}
      <aside className="card p-4 flex flex-col gap-3 lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Constraints so far</span>
          {ready ? <span className="chip text-ink">complete</span> : constraints?.job_title ? <span className="chip">in progress</span> : null}
        </div>
        {!constraints?.job_title && !constraints?.location ? (
          <p className="text-body-sm text-mute">Nothing extracted yet.</p>
        ) : (
          <dl className="flex flex-col gap-2 text-body-sm">
            <Row k="Title" v={constraints.job_title || '—'} />
            <Row k="Seniority" v={constraints.seniority} />
            <Row k="Location" v={[constraints.location, constraints.remote_eligible ? 'Remote OK' : null].filter(Boolean).join(' · ') || '—'} />
            <Row k="Must-have" v={constraints.must_have_skills.length ? constraints.must_have_skills.join(', ') : '—'} />
            {constraints.nice_to_have_skills.length > 0 && <Row k="Nice-to-have" v={constraints.nice_to_have_skills.slice(0, 6).join(', ')} />}
            <Row k="Domain" v={constraints.domain.length ? constraints.domain.join(', ') : '—'} />
            <div className="flex flex-col gap-1">
              <dt className="text-mute">Platforms</dt>
              <dd className="flex flex-wrap gap-1">
                {constraints.selected_platforms.map((p) => (
                  <span key={p} className="chip">
                    <PlatformLogo platform={p} size={10} /> {platformLabel(p)}
                  </span>
                ))}
              </dd>
            </div>
            {constraints.additional_details && <Row k="Details" v={constraints.additional_details} />}
          </dl>
        )}
        {sessionId && (
          <button type="button" onClick={() => router.push(`/dashboard?session=${encodeURIComponent(sessionId)}`)} className="btn-ghost w-full">
            Edit in the form
          </button>
        )}
        {queries.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-hairline">
            <span className="eyebrow">Queries · {queries.length}</span>
            <ul className="flex flex-col gap-1">
              {queries.slice(0, 6).map((q) => (
                <li key={q.id} className="flex items-center gap-1.5 text-body-xs text-body">
                  <PlatformBadge platform={q.platform} /> {getTemplate(q.query_type)?.label ?? 'Custom'}
                </li>
              ))}
              {queries.length > 6 && <li className="text-body-xs text-mute">+{queries.length - 6} more</li>}
            </ul>
          </div>
        )}
      </aside>

      <QueryPreviewModal isOpen={modalOpen} onClose={() => setModalOpen(false)} queries={queries} constraints={constraints} onConfirm={runSearch} isLoading={processing !== null} />
      <ProcessingOverlay state={processing} onCancel={() => setProcessing(null)} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-mute">{k}</dt>
      <dd className="text-ink break-words">{v}</dd>
    </div>
  );
}
