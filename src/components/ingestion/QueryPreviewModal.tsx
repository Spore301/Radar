'use client';

import React, { useEffect, useState } from 'react';
import { MergedConstraints, XRayQuery } from '@/lib/types';
import { Trash2, Plus, X, Pencil, Check } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { QueryTokenView } from '@/components/queries/QueryTokenView';
import { QueryBuilder } from '@/components/queries/QueryBuilder';
import { getTemplate, countGoogleWords, GOOGLE_WORD_LIMIT } from '@/lib/search/xrayTemplates';
import { DEFAULT_MAX_PAGES_PER_QUERY, HARD_MAX_PAGES_PER_QUERY, SERP_PAGE_SIZE } from '@/lib/search/serpConfig';

interface QueryPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  queries: XRayQuery[];
  /** Session constraints — feeds the builder palette with titles, skills, location, required phrases and exclusions. */
  constraints?: MergedConstraints | null;
  /** `depth` = max SERP pages (10 results, 1 credit each) to walk per query. */
  onConfirm: (updatedQueries: XRayQuery[], depth: number) => void;
  isLoading: boolean;
}

export function QueryPreviewModal({ isOpen, onClose, queries: initialQueries, constraints, onConfirm, isLoading }: QueryPreviewModalProps) {
  const [queries, setQueries] = useState<XRayQuery[]>(initialQueries || []);
  const [depth, setDepth] = useState<number>(DEFAULT_MAX_PAGES_PER_QUERY);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialQueries && initialQueries.length > 0) setQueries(initialQueries);
  }, [initialQueries, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (editingId ? setEditingId(null) : onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, editingId]);

  if (!isOpen) return null;

  const update = (id: string, query_string: string) => setQueries((prev) => prev.map((q) => (q.id === id ? { ...q, query_string, is_edited: true } : q)));
  const remove = (id: string) => setQueries((prev) => prev.filter((q) => q.id !== id));
  const addCustom = () => {
    const id = `q-custom-${Date.now()}`;
    setQueries((prev) => [
      ...prev,
      {
        id,
        platform: 'LinkedIn',
        query_type: 'custom',
        query_string: 'site:linkedin.com/in/ -intitle:job -intitle:hiring -recruiter',
        query_intent: 'Custom query',
        expected_result_type: 'Profile',
        is_edited: true,
      },
    ]);
    setEditingId(id);
  };

  const maxCredits = queries.length * depth;

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
                    <span className="text-body-sm font-medium text-ink truncate">{template ? template.label : 'Custom query'}</span>
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

        <div className="px-5 py-3 border-t border-hairline bg-canvas flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addCustom} className="btn-ghost">
            <Plus className="w-3.5 h-3.5" /> Custom query
          </button>
          <label className="flex items-center gap-2 text-body-sm text-body">
            <span className="field-label">Depth</span>
            <select value={depth} onChange={(e) => setDepth(parseInt(e.target.value, 10))} className="select w-auto">
              {Array.from({ length: HARD_MAX_PAGES_PER_QUERY }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'page' : 'pages'} · ≤ {n * SERP_PAGE_SIZE} results / query
                </option>
              ))}
            </select>
            <span className="text-body-xs text-mute tabular-nums hidden sm:inline">≤ {maxCredits} credits</span>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={() => onConfirm(queries, depth)} disabled={isLoading || queries.length === 0} className="btn-primary">
              Run {queries.length} {queries.length === 1 ? 'query' : 'queries'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
