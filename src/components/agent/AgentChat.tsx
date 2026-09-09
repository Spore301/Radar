'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUp, Paperclip, ChevronDown, Loader2, Check, ExternalLink, X, PanelRight, Circle, Lock, Sparkles } from 'lucide-react';
import type { MergedConstraints, XRayQuery } from '@/lib/types';
import type { AgentMessage, AgentPhase, AgentState, AgentTurnResponse, ScopeItem } from '@/lib/agent/types';
import { buildScope, decidePhase, EMPTY_STATE, GUARDRAIL } from '@/lib/agent/scope';
import { postNdjson } from '@/lib/api/stream';
import * as api from '@/lib/api/sessions';
import { notifySessionsChanged } from '@/lib/api/sessions';
import { QueryPreviewModal } from '@/components/ingestion/QueryPreviewModal';
import { ProcessingOverlay, ProcessingState, ProcessingLogItem } from '@/components/processing/ProcessingOverlay';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { getTemplate } from '@/lib/search/xrayTemplates';
import { platformLabel } from '@/lib/search/platforms';
import type { QueryRunResult } from '@/lib/search/x-raySearchService';
import { Avatar } from '@/components/ui/Avatar';

// ---------------------------------------------------------------------------
// Agent view — full-height chat (like a messaging app) with a right-hand panel
// holding everything extracted so far. The panel doubles as the scope
// checklist that gates query creation: nothing is built until every item is
// covered and the recruiter has said go.
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<string, string> = { read: 'Reading', extract: 'Extracting', reason: 'Reasoning', queries: 'Building queries', save: 'Saving' };
const PHASE_LABEL: Record<AgentPhase, string> = { gathering: 'Gathering required scope', scoping: 'Completing the scope', confirming: 'Awaiting your go-ahead', ready: 'Queries ready' };

export function AgentChat() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionParam = params.get('session');

  const [sessionId, setSessionId] = useState<string | null>(sessionParam);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [constraints, setConstraints] = useState<MergedConstraints | null>(null);
  const [state, setState] = useState<AgentState>(EMPTY_STATE);
  const [queries, setQueries] = useState<XRayQuery[]>([]);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const phase: AgentPhase = constraints ? decidePhase(constraints, state) : 'gathering';
  const ready = phase === 'ready' && queries.length > 0;
  const scope: ScopeItem[] = useMemo(() => (constraints ? buildScope(constraints, state) : []), [constraints, state]);
  const doneCount = scope.filter((s) => s.state === 'done').length;

  // Restore a session's conversation.
  useEffect(() => {
    if (!sessionParam) return;
    (async () => {
      try {
        const d = await api.getSession(sessionParam);
        setSessionId(sessionParam);
        setSessionTitle(d.job.title);
        setConstraints(d.job.merged_constraints);
        setQueries(d.job.query_bundle);
        setMessages((d.agent_transcript ?? []) as AgentMessage[]);
        setState({ ...EMPTY_STATE, ...((d.agent_state as Partial<AgentState> | null) ?? {}) });
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
      const optimistic: AgentMessage = { id: `tmp-${Date.now()}`, role: 'user', content: content || 'Here is the job description.', at: new Date().toISOString(), ...(attach ? { attachment: { name: attach.name, words: 0 } } : {}) };
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
        setState(res.state);
        if (res.queries.length) setQueries(res.queries);
        setSessionTitle(res.constraints.job_title ? `${res.constraints.job_title}${res.constraints.location ? ` · ${res.constraints.location.split(',')[0]}` : ''}` : null);
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
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      {/* ===== Chat column ===== */}
      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Top bar */}
        <header className="h-12 flex-shrink-0 border-b border-hairline px-4 flex items-center justify-between gap-3 bg-canvas">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-body" strokeWidth={1.75} />
            <span className="text-label-sm text-ink truncate">{sessionTitle ?? 'Agent'}</span>
            {constraints && <span className="chip hidden sm:inline-flex">{PHASE_LABEL[phase]}</span>}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => router.push('/dashboard/agent')} className="btn-ghost btn-sm">
              New
            </button>
            <button type="button" onClick={() => setPanelOpen((v) => !v)} className={`btn-icon ${panelOpen ? 'border-ink' : ''}`} aria-pressed={panelOpen} aria-label="Toggle scope panel" title="Scope panel">
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[780px] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
            {messages.length === 0 && !busy && (
              <div className="my-16 flex flex-col items-center text-center gap-4">
                <span className="w-10 h-10 rounded-sm bg-ink text-white flex items-center justify-center">
                  <Sparkles className="w-5 h-5" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-heading-md">Describe the role, or attach the JD.</p>
                  <p className="text-body-sm text-mute mt-1 max-w-[52ch]">
                    I gather the full scope first, show my reasoning at every step, and only build queries once you confirm — searches cost credits.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-[640px]">
                  {['Senior React developer in Pune, must know TypeScript and Next.js', 'Business Development Associate in Kolkata for our EdTech sales team', 'Product designer, Bengaluru or remote, strong on design systems in Figma'].map((s) => (
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
                <div className={`max-w-[85%] flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'w-full'}`}>
                  {m.role === 'assistant' && m.thoughts && m.thoughts.length > 0 && (
                    <div className="w-full rounded-sm border border-hairline bg-canvas">
                      <button type="button" onClick={() => setOpenThoughts((o) => ({ ...o, [m.id]: !o[m.id] }))} className="w-full flex items-center justify-between px-3 h-8 text-left" aria-expanded={Boolean(openThoughts[m.id])}>
                        <span className="eyebrow">Reasoning · {m.thoughts.length} steps</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-mute transition-transform ${openThoughts[m.id] ? 'rotate-180' : ''}`} />
                      </button>
                      {openThoughts[m.id] && (
                        <ol className="px-3 pb-3 flex flex-col gap-1.5 text-body-sm text-body list-decimal list-inside">
                          {m.thoughts.map((t, i) => (
                            <li key={i} className={/^search budget/i.test(t) ? 'text-ink' : ''}>
                              {/^search budget/i.test(t) && <Lock className="w-3 h-3 inline mr-1 -mt-0.5" />}
                              {t}
                            </li>
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
                        {m.questions.flatMap((q) =>
                          (q.options ?? []).map((o) => (
                            <button key={`${q.id}-${o}`} type="button" onClick={() => void send(o)} className={o === 'Build the queries' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>
                              {o}
                            </button>
                          ))
                        )}
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
        </div>

        {/* Composer */}
        <div className="flex-shrink-0 border-t border-hairline bg-canvas">
          <div className="max-w-[780px] mx-auto px-4 sm:px-6 py-3 flex flex-col gap-2">
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
            <div className="flex items-end gap-2 rounded-md border border-hairline bg-elevated p-1.5 focus-within:border-ink transition-colors">
              <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-icon h-9 w-9 flex-shrink-0 border-transparent" aria-label="Attach job description" title="Attach a JD (PDF, DOCX, TXT)">
                <Paperclip className="w-4 h-4" />
              </button>
              <textarea
                ref={textRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                placeholder={messages.length ? 'Reply…' : 'Describe the role you are hiring for…'}
                className="flex-1 bg-transparent border-0 outline-none resize-none text-body-md text-ink py-2 max-h-40"
                aria-label="Message the agent"
              />
              <button type="button" onClick={() => void send(draft, file)} disabled={busy !== null || (!draft.trim() && !file)} className="btn-primary h-9 w-9 px-0 flex-shrink-0" aria-label="Send">
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
            <p className="text-body-xs text-mute text-center">Enter to send · Shift+Enter for a new line · nothing is searched until you confirm the scope</p>
          </div>
        </div>
      </section>

      {/* ===== Right panel: everything extracted so far ===== */}
      {panelOpen && (
        <aside className="lg:w-[380px] xl:w-[420px] flex-shrink-0 border-t lg:border-t-0 lg:border-l border-hairline bg-elevated flex flex-col min-h-0 lg:h-screen" aria-label="Extracted scope">
          <div className="h-12 flex-shrink-0 px-4 border-b border-hairline flex items-center justify-between">
            <span className="text-label-sm text-ink">Scope so far</span>
            <span className="text-body-xs text-mute tabular-nums">
              {doneCount} / {scope.length || 9}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* guardrail */}
            <div className="px-4 py-3 border-b border-hairline flex gap-2.5 text-body-xs text-body">
              <Lock className="w-3.5 h-3.5 text-ink flex-shrink-0 mt-0.5" />
              <span>{GUARDRAIL}</span>
            </div>

            {/* checklist */}
            <div className="px-4 pt-4 pb-2">
              <span className="eyebrow">In this brief</span>
            </div>
            <ul className="px-2 pb-3 flex flex-col">
              {(scope.length ? scope : buildScope({ ...({} as MergedConstraints), job_title: '', location: '', remote_eligible: false, must_have_skills: [], nice_to_have_skills: [], domain: [], seniority: 'Any', years_of_experience: { min: 0, max: 10 }, selected_platforms: [], additional_details: '', role_type: 'Other', education: '', results_cap: 50 }, EMPTY_STATE)).map((it) => (
                <li key={it.field} className="flex items-start gap-2.5 px-2 py-2 rounded-sm">
                  {it.state === 'done' ? (
                    <span className="w-4 h-4 rounded-full bg-ink text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </span>
                  ) : (
                    <Circle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${it.state === 'optional' ? 'text-hairline' : 'text-faint'}`} strokeWidth={1.5} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`text-body-sm ${it.state === 'done' ? 'text-ink' : 'text-body'}`}>{it.label}</div>
                    {it.value ? (
                      <div className="text-body-xs text-mute break-words">{it.value}</div>
                    ) : (
                      <div className="text-body-xs text-faint">{it.state === 'optional' ? 'optional' : 'not yet'}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* details */}
            {constraints && constraints.nice_to_have_skills.length > 0 && (
              <div className="border-t border-hairline px-4 py-4 flex flex-col gap-3">
                {constraints.nice_to_have_skills.length > 0 && (
                  <div>
                    <span className="eyebrow">Nice to have</span>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {constraints.nice_to_have_skills.slice(0, 10).map((s) => (
                        <span key={s} className="chip">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* queries */}
            {queries.length > 0 && (
              <div className="border-t border-hairline px-4 py-4 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Queries · {queries.length}</span>
                  <button type="button" onClick={() => setModalOpen(true)} className="btn-ghost btn-sm">
                    Review
                  </button>
                </div>
                <ul className="flex flex-col gap-1">
                  {queries.slice(0, 8).map((q) => (
                    <li key={q.id} className="flex items-center gap-1.5 text-body-xs text-body">
                      <PlatformBadge platform={q.platform} /> {getTemplate(q.query_type)?.label ?? 'Custom'}
                    </li>
                  ))}
                  {queries.length > 8 && <li className="text-body-xs text-mute">+{queries.length - 8} more</li>}
                </ul>
              </div>
            )}
          </div>

          {sessionId && (
            <div className="flex-shrink-0 border-t border-hairline p-3 flex gap-2">
              <button type="button" onClick={() => router.push(`/dashboard?session=${encodeURIComponent(sessionId)}`)} className="btn-ghost flex-1">
                Edit in the form
              </button>
              {ready && (
                <button type="button" onClick={() => setModalOpen(true)} className="btn-primary flex-1">
                  Review {queries.length} queries
                </button>
              )}
            </div>
          )}
        </aside>
      )}

      <QueryPreviewModal isOpen={modalOpen} onClose={() => setModalOpen(false)} queries={queries} constraints={constraints} onConfirm={runSearch} isLoading={processing !== null} />
      <ProcessingOverlay state={processing} onCancel={() => setProcessing(null)} />
    </div>
  );
}
