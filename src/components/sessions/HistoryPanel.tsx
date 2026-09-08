'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X, Loader2, Search } from 'lucide-react';
import { SessionSummary } from '@/lib/types';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';
import * as api from '@/lib/api/sessions';
import { SESSIONS_CHANGED_EVENT, notifySessionsChanged } from '@/lib/api/sessions';

interface HistoryPanelProps {
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayGroup(iso: string): 'Today' | 'Yesterday' | 'This week' | 'Earlier' {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return 'Today';
  if (t >= startToday - 86400000) return 'Yesterday';
  if (t >= startToday - 6 * 86400000) return 'This week';
  return 'Earlier';
}

function metaLine(s: SessionSummary): string {
  if (s.status !== 'complete' && s.candidate_count === 0) return 'Constraints saved · no run yet';
  const parts = [`${s.candidate_count} ${s.candidate_count === 1 ? 'profile' : 'profiles'}`];
  if (s.shortlisted_count) parts.push(`${s.shortlisted_count} shortlisted`);
  if (s.contacted_count) parts.push(`${s.contacted_count} contacted`);
  return parts.join(' · ');
}

/**
 * Chat-style list of every stored JD-to-leads session. Opens beside the
 * sidebar as a level-2 surface; selecting a row navigates to that session.
 */
export function HistoryPanel({ activeSessionId, onSelect, onNew, onClose }: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setSessions(await api.listSessions());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(SESSIONS_CHANGED_EVENT, load);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, load);
  }, [load]);

  const handleDelete = async (s: SessionSummary) => {
    if (!window.confirm(`Delete "${s.title}" and all its candidates and outreach history?`)) return;
    try {
      await api.deleteSession(s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      notifySessionsChanged({ deletedId: s.id });
      if (s.id === activeSessionId) onNew();
    } catch (e: any) {
      setError(e?.message || 'Could not delete the session.');
    }
  };

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q ? sessions.filter((s) => `${s.title} ${s.location} ${s.seniority}`.toLowerCase().includes(q)) : sessions;
    const order: Array<ReturnType<typeof dayGroup>> = ['Today', 'Yesterday', 'This week', 'Earlier'];
    const map = new Map<string, SessionSummary[]>();
    for (const s of visible) {
      const g = dayGroup(s.updated_at);
      map.set(g, [...(map.get(g) ?? []), s]);
    }
    return order.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [sessions, filter]);

  return (
    <section
      id="history-panel"
      role="dialog"
      aria-label="Session history"
      className="fixed z-40 top-0 left-0 lg:left-[232px] h-screen w-full max-w-[360px] lg:w-[320px] bg-elevated border-r border-hairline shadow-float flex flex-col animate-slide-right"
    >
      <header className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-hairline">
        <h2 className="text-label-sm text-ink">History</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onNew} className="btn-ghost btn-sm">
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <button type="button" onClick={onClose} className="btn-icon h-7 w-7" aria-label="Close history">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="px-3 py-2.5 border-b border-hairline">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-mute absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sessions…"
            className="input pl-8"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-4 py-6 text-body-sm text-mute flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {error && !loading && <div className="mx-3 my-2 px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}
        {!loading && !error && sessions.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-body-sm text-ink font-medium">No sessions yet</p>
            <p className="text-body-sm text-mute mt-1">Parse a job description and it is saved here, like a thread you can reopen.</p>
          </div>
        )}
        {!loading && !error && sessions.length > 0 && grouped.length === 0 && (
          <div className="px-4 py-6 text-body-sm text-mute">No sessions match “{filter}”.</div>
        )}

        {grouped.map((group) => (
          <div key={group.label} className="px-2 pt-2">
            <div className="eyebrow px-2 pb-1">{group.label}</div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((s) => {
                const active = s.id === activeSessionId;
                return (
                  <li key={s.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelect(s.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`w-full text-left px-2.5 py-2 pr-9 rounded-sm transition-colors ${
                        active ? 'bg-hairline-soft' : 'hover:bg-hairline-soft'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-body-sm font-medium text-ink truncate">{s.title}</span>
                        <span className="text-body-xs text-mute whitespace-nowrap tabular-nums">{timeAgo(s.updated_at)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-body-xs text-mute">
                        {active && <span className="w-1.5 h-1.5 rounded-full bg-link flex-shrink-0" aria-hidden />}
                        <span className="truncate">{metaLine(s)}</span>
                        <span className="ml-auto flex items-center gap-1 flex-shrink-0">
                          {s.platforms.slice(0, 5).map((p) => (
                            <PlatformLogo key={p} platform={p} size={10} />
                          ))}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${s.title}`}
                      onClick={() => void handleDelete(s)}
                      className="absolute right-1.5 top-1.5 btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
