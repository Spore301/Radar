'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KanbanBoard } from '@/components/outreach/KanbanBoard';
import { PipelineTable } from '@/components/outreach/PipelineTable';
import { CandidateDetailDrawer } from '@/components/candidates/CandidateDetailDrawer';
import { OutreachGeneratorModal } from '@/components/outreach/OutreachGeneratorModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { CandidateProfile, CandidateStatus, OutreachChannel, SessionSummary } from '@/lib/types';
import * as api from '@/lib/api/sessions';
import { LayoutGrid, List, RefreshCw, Loader2 } from 'lucide-react';
import Link from 'next/link';

/**
 * Cross-session CRM board. Every candidate here is a stored row: moving a card,
 * editing notes, or logging outreach writes back to the session that found
 * them, so the same state shows up when that session is reopened.
 */
export default function PipelinePage() {
  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateProfile | null>(null);
  const [outreachCandidate, setOutreachCandidate] = useState<CandidateProfile | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cands, sess] = await Promise.all([api.listCandidates(sessionFilter === 'all' ? {} : { jobId: sessionFilter }), api.listSessions()]);
      setCandidates(cands);
      setSessions(sess);
    } catch (e: any) {
      setError(e?.message || 'Could not load the pipeline.');
    } finally {
      setLoading(false);
    }
  }, [sessionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyCandidate = (updated: CandidateProfile) => {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? { ...updated, job_title: c.job_title ?? updated.job_title } : c)));
    setSelectedCandidate((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
  };

  const handleStatusChange = async (id: string, newStatus: CandidateStatus) => {
    const before = candidates.find((c) => c.id === id);
    if (!before) return;
    applyCandidate({ ...before, status: newStatus });
    try {
      applyCandidate(await api.updateCandidate(id, { status: newStatus }));
    } catch (e: any) {
      applyCandidate(before);
      setError(e?.message || 'Could not save the stage change.');
    }
  };

  const handleUpdateCandidate = async (updated: CandidateProfile) => {
    const before = candidates.find((c) => c.id === updated.id);
    applyCandidate(updated);
    try {
      applyCandidate(
        await api.updateCandidate(updated.id, {
          status: updated.status,
          outreach_channel: updated.outreach_channel ?? null,
          next_follow_up: updated.next_follow_up || null,
          notes: updated.notes ?? null,
          tags: updated.tags ?? [],
        })
      );
    } catch (e: any) {
      if (before) applyCandidate(before);
      setError(e?.message || 'Could not save the changes.');
    }
  };

  const handleSaveOutreachLog = async (candidateId: string, channel: OutreachChannel, message: string) => {
    try {
      applyCandidate(await api.logOutreach(candidateId, channel, message));
    } catch (e: any) {
      setError(e?.message || 'Could not log the outreach.');
    }
  };

  const counts = {
    shortlisted: candidates.filter((c) => c.status === 'Shortlisted').length,
    contacted: candidates.filter((c) => c.status === 'Contacted' || c.status === 'Replied').length,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Pipeline · ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`}
        title="Outreach pipeline"
        description={
          candidates.length
            ? `${candidates.length} candidates · ${counts.shortlisted} shortlisted · ${counts.contacted} contacted. Every change is saved to the session that found the person.`
            : 'Every candidate from every session, with stage, notes and outreach saved to the database.'
        }
        actions={
          <>
            <select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="select w-auto max-w-[240px]" aria-label="Session">
              <option value="all">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.candidate_count}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void load()} className="btn-icon" aria-label="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <div className="seg" role="group" aria-label="View">
              <button type="button" aria-pressed={viewMode === 'kanban'} onClick={() => setViewMode('kanban')} className="seg-item">
                <LayoutGrid className="w-3.5 h-3.5" /> Board
              </button>
              <button type="button" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')} className="seg-item">
                <List className="w-3.5 h-3.5" /> Table
              </button>
            </div>
          </>
        }
      />

      {error && (
        <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {loading && candidates.length === 0 ? (
        <div className="card p-10 flex items-center justify-center gap-2 text-body-sm text-mute">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading pipeline…
        </div>
      ) : candidates.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-3">
          <p className="text-body-md font-medium text-ink">No candidates yet</p>
          <p className="text-body-sm text-mute max-w-[44ch]">Run a search from a job description. Every profile it indexes is stored in that session and appears here.</p>
          <Link href="/" className="btn-primary">
            New search
          </Link>
        </div>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard candidates={candidates} onSelectCandidate={setSelectedCandidate} onStatusChange={handleStatusChange} onOpenOutreach={setOutreachCandidate} />
      ) : (
        <PipelineTable candidates={candidates} onSelectCandidate={setSelectedCandidate} onStatusChange={handleStatusChange} onOpenOutreach={setOutreachCandidate} />
      )}

      {selectedCandidate && (
        <CandidateDetailDrawer
          key={selectedCandidate.id}
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onUpdateCandidate={handleUpdateCandidate}
          onOpenAIGenerator={setOutreachCandidate}
        />
      )}

      {outreachCandidate && (
        <OutreachGeneratorModal
          key={outreachCandidate.id}
          onClose={() => setOutreachCandidate(null)}
          candidate={outreachCandidate}
          jobTitle={outreachCandidate.job_title?.split(' · ')[0] || 'the role'}
          onSaveOutreachLog={handleSaveOutreachLog}
        />
      )}
    </div>
  );
}
