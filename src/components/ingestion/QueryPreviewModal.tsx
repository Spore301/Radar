'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MergedConstraints, XRayQuery } from '@/lib/types';
import { Trash2, Plus, X, Pencil, Check, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { QueryTokenView } from '@/components/queries/QueryTokenView';
import { QueryBuilder } from '@/components/queries/QueryBuilder';
import { getTemplate, queryLabel, countGoogleWords, GOOGLE_WORD_LIMIT, deriveQueryTerms, linkedinSite } from '@/lib/search/xrayTemplates';
import { validateBundle } from '@/lib/search/queryValidation';
import { readStoredApiKeys } from '@/lib/api/sessions';
import { CreditLine, DepthSelect, searchBudget } from './SearchBudget';

interface QueryPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  queries: XRayQuery[];
  /** Session constraints — feeds the builder palette with titles, skills, location, required phrases and exclusions. */
  constraints?: MergedConstraints | null;
  /** Max SERP pages (10 results, 1 credit each) per query. Owned by the page so the form, this modal and the agent agree. */
  depth: number;
  onDepthChange: (depth: number) => void;
  onConfirm: (updatedQueries: XRayQuery[], depth: number) => void;
  isLoading: boolean;
  /** Why Run is unavailable right now, e.g. a search for this session is still running. */
  runDisabledReason?: string | null;
}

/** The slow planner's lifecycle inside the modal. It never blocks editing or running. */
type AiState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number }
  | { status: 'offer'; planned: XRayQuery[]; summary: string }
  | { status: 'done' | 'unchanged' | 'failed'; note: string };

const isCurated = (q: XRayQuery) => q.is_edited || q.query_type === 'custom';

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function QueryPreviewModal(props: QueryPreviewModalProps) {
  // The dialog mounts fresh on every open, so it always starts from the bundle
  // it was opened with, and closing it cancels any planner call in flight.
  if (!props.isOpen) return null;
  return <QueryPreviewDialog {...props} />;
}

function QueryPreviewDialog({ onClose, queries: initialQueries, constraints, depth, onDepthChange, onConfirm, isLoading, runDisabledReason }: QueryPreviewModalProps) {
  const [queries, setQueries] = useState<XRayQuery[]>(() => initialQueries ?? []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  const [now, setNow] = useState(() => Date.now());
  const aiAbort = useRef<AbortController | null>(null);
  /** Set by any edit made while the planner is thinking, so its answer never silently overwrites the recruiter's work. */
  const editedDuringAi = useRef(false);

  useEffect(() => () => aiAbort.current?.abort(), []);

  useEffect(() => {
    if (ai.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ai.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (editingId ? setEditingId(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editingId]);

  // The same gate the server applies before a credit is spent: a query that
  // fails it is skipped by the run, so say so here, before Run is pressed.
  const checks = useMemo(() => {
    const byId = new Map<string, string[]>();
    validateBundle(queries, (constraints ?? {}) as MergedConstraints).forEach((v) => {
      if (!v.ok) byId.set(v.queryId, v.issues.filter((i) => i.severity === 'error').map((i) => i.message));
    });
    return byId;
  }, [queries, constraints]);

  const budget = useMemo(() => searchBudget(queries, constraints, depth), [queries, constraints, depth]);

  const update = (id: string, query_string: string) => {
    editedDuringAi.current = true;
    setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, query_string, is_edited: true } : q)));
  };
  const remove = (id: string) => {
    editedDuringAi.current = true;
    setQueries((prev) => prev.filter((q) => q.id !== id));
  };
  const addCustom = () => {
    editedDuringAi.current = true;
    const id = `q-custom-${Date.now()}`;
    setQueries((prev) => [
      ...prev,
      {
        id,
        platform: 'LinkedIn',
        query_type: 'custom',
        // Start on the same LinkedIn host the templates use for this role
        // (e.g. site:in.linkedin.com/in/ for an India-bound role).
        query_string: `${customLinkedinSite(constraints)} -intitle:job -intitle:hiring -recruiter`,
        query_intent: 'Custom query',
        expected_result_type: 'Profile',
        is_edited: true,
      },
    ]);
    setEditingId(id);
  };

  // "Improve with AI": the reasoning-model planner, on demand only. It thinks
  // for about a minute, so the modal stays fully usable meanwhile, and its
  // bundle (already validated server-side) replaces the rows only when it
  // arrives, and only if the recruiter hasn't edited anything in between.
  const improveWithAI = async () => {
    if (!constraints) return;
    aiAbort.current?.abort();
    const ctrl = new AbortController();
    aiAbort.current = ctrl;
    const hadCuratedRows = queries.some(isCurated);
    editedDuringAi.current = false;
    setNow(Date.now());
    setAi({ status: 'running', startedAt: Date.now() });
    try {
      const keys = readStoredApiKeys();
      const res = await fetch('/api/generate-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(keys.deepseek ? { 'x-deepseek-api-key': keys.deepseek } : {}) },
        body: JSON.stringify({ constraints, apiKey: keys.deepseek }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      if (ctrl.signal.aborted) return;
      if (!res.ok || !data?.success || !Array.isArray(data.queries) || data.queries.length === 0) {
        setAi({ status: 'failed', note: `${data?.error || `The planner request failed (${res.status}).`} Your queries are unchanged.` });
        return;
      }
      if (!data.plan) {
        setAi({ status: 'unchanged', note: 'The AI planner returned no plan (no DeepSeek key, or no usable answer), so your queries are unchanged.' });
        return;
      }
      const planned = data.queries as XRayQuery[];
      const fallback: string[] = Array.isArray(data.plan.fallbackPlatforms) ? data.plan.fallbackPlatforms : [];
      const summary = `${planned.length} ${planned.length === 1 ? 'query' : 'queries'} · ${data.plan.accepted} planned, ${data.plan.rejected} rejected by validation${fallback.length ? ` · templates for ${fallback.join(', ')}` : ''}`;
      if (hadCuratedRows || editedDuringAi.current) {
        setAi({ status: 'offer', planned, summary });
        return;
      }
      setQueries(planned);
      setEditingId(null);
      setAi({ status: 'done', note: `Replaced with the AI plan: ${summary}.` });
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      setAi({ status: 'failed', note: `${e?.message || 'The planner could not be reached.'} Your queries are unchanged.` });
    }
  };

  const cancelAI = () => {
    aiAbort.current?.abort();
    setAi({ status: 'idle' });
  };

  const runnable = budget.runnable;
  const runBlocked = isLoading || runnable === 0 || Boolean(runDisabledReason);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="query-modal-title">
      <div className="card shadow-modal w-full max-w-[880px] max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-hairline flex items-start justify-between gap-4">
          <div>
            <h2 id="query-modal-title" className="text-label-sm text-ink">
              {queries.length} {queries.length === 1 ? 'query' : 'queries'} · each searched individually
            </h2>
            <p className="text-body-sm text-mute mt-0.5">
              One approved X-Ray type per row, shown as colour-coded syntax pills. Edit a row to type keywords or drag syntax chips into the query.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-hairline">
          {queries.length === 0 ? (
            <div className="p-8 text-center text-body-sm text-mute">No queries. Add a custom one below.</div>
          ) : (
            queries.map((q) => {
              const template = getTemplate(q.query_type);
              const words = countGoogleWords(q.query_string);
              const over = words > GOOGLE_WORD_LIMIT;
              const editing = editingId === q.id;
              return (
                <div key={q.id} data-query-row className={`px-5 py-3.5 flex flex-col gap-2.5 ${editing ? 'bg-canvas' : ''}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <PlatformBadge platform={q.platform} />
                    <span className="text-body-sm font-medium text-ink truncate">{queryLabel(q.query_type)}</span>
                    {q.is_edited && <span className="chip">edited</span>}
                    <span
                      className={`chip tabular-nums ${over ? 'text-warning-deep border-warning' : ''}`}
                      title={over ? `Google ignores words after the ${GOOGLE_WORD_LIMIT}th — the end of this query will be dropped.` : "Within Google's 32-word limit"}
                    >
                      {words} / {GOOGLE_WORD_LIMIT} words
                    </span>
                    <span className="text-body-xs text-mute truncate hidden md:inline">{q.query_intent}</span>
                    <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                      {editing ? (
                        <button type="button" onClick={() => setEditingId(null)} className="btn-ghost btn-sm">
                          <Check className="w-3 h-3" /> Done
                        </button>
                      ) : (
                        <button type="button" onClick={() => setEditingId(q.id)} className="btn-ghost btn-sm">
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      )}
                      <button type="button" onClick={() => remove(q.id)} className="btn-icon h-7 w-7 hover:text-error" aria-label="Remove query">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {template && !editing && (
                    <p className="font-mono text-body-xs text-mute truncate" title={template.pattern}>
                      {template.pattern}
                    </p>
                  )}
                  {!template && q.notes && !editing && <p className="text-body-xs text-mute">{q.notes}</p>}
                  {checks.has(q.id) && (
                    <p className="text-body-xs text-error-deep">Will be skipped — {checks.get(q.id)!.join(' ')}</p>
                  )}

                  {editing ? (
                    <QueryBuilder value={q.query_string} onChange={(next) => update(q.id, next)} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingId(q.id)}
                      className="text-left rounded-sm border border-hairline bg-elevated p-2.5 hover:border-faint transition-colors"
                      title="Click to edit"
                    >
                      <QueryTokenView query={q.query_string} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {ai.status !== 'idle' && (
          <div className="px-5 py-2.5 border-t border-hairline flex items-center gap-3 flex-wrap text-body-xs" aria-live="polite">
            {ai.status === 'running' && (
              <>
                <Loader2 className="w-3.5 h-3.5 text-link animate-spin flex-shrink-0" />
                <span className="text-body flex-1 min-w-[240px]">
                  Planning with DeepSeek · <span className="tabular-nums">{formatElapsed(now - ai.startedAt)}</span>. Keep editing or run these
                  queries now (that cancels the plan). The plan replaces the rows only when it arrives.
                </span>
                <button type="button" onClick={cancelAI} className="btn-ghost btn-sm">
                  Cancel
                </button>
              </>
            )}
            {ai.status === 'offer' && (
              <>
                <Sparkles className="w-3.5 h-3.5 text-ink flex-shrink-0" />
                <span className="text-body flex-1 min-w-[240px]">AI plan ready: {ai.summary}. You have edited or custom queries, so nothing was replaced.</span>
                <button
                  type="button"
                  onClick={() => {
                    setQueries(ai.planned);
                    setEditingId(null);
                    setAi({ status: 'done', note: `Replaced with the AI plan: ${ai.summary}.` });
                  }}
                  className="btn-primary btn-sm"
                >
                  Replace with AI plan
                </button>
                <button type="button" onClick={() => setAi({ status: 'idle' })} className="btn-ghost btn-sm">
                  Keep mine
                </button>
              </>
            )}
            {(ai.status === 'done' || ai.status === 'unchanged' || ai.status === 'failed') && (
              <>
                {ai.status === 'done' ? (
                  <Check className="w-3.5 h-3.5 text-ink flex-shrink-0" strokeWidth={2.5} />
                ) : (
                  <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 ${ai.status === 'failed' ? 'text-error-deep' : 'text-warning-deep'}`} />
                )}
                <span className={`flex-1 min-w-[240px] ${ai.status === 'failed' ? 'text-error-deep' : 'text-body'}`}>{ai.note}</span>
                <button type="button" onClick={() => setAi({ status: 'idle' })} className="btn-ghost btn-sm">
                  Dismiss
                </button>
              </>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-hairline bg-canvas flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addCustom} className="btn-ghost">
            <Plus className="w-3.5 h-3.5" /> Custom query
          </button>
          <button
            type="button"
            onClick={() => void improveWithAI()}
            disabled={!constraints || ai.status === 'running'}
            className="btn-ghost"
            title="Ask DeepSeek to plan the queries. Nothing is searched."
          >
            <Sparkles className="w-3.5 h-3.5" /> Improve with AI
          </button>
          <DepthSelect depth={depth} onChange={onDepthChange} />
          <div className="ml-auto flex items-center gap-3 flex-wrap justify-end">
            <CreditLine budget={budget} />
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={() => onConfirm(queries, depth)} disabled={runBlocked} className="btn-primary">
              Run {runnable} {runnable === 1 ? 'query' : 'queries'}
            </button>
          </div>
          {runDisabledReason && <p className="w-full text-body-xs text-mute text-right">{runDisabledReason}</p>}
        </div>
      </div>
    </div>
  );
}

/** The LinkedIn anchor a hand-added query starts from: the role's country host when known, else the bare host. */
function customLinkedinSite(constraints: MergedConstraints | null | undefined): string {
  if (!constraints?.job_title) return 'site:linkedin.com/in/';
  try {
    return linkedinSite(deriveQueryTerms(constraints));
  } catch {
    return 'site:linkedin.com/in/';
  }
}
