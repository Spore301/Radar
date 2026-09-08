'use client';

import React from 'react';
import { CandidateProfile, CandidateStatus } from '@/lib/types';
import { Download } from 'lucide-react';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { Avatar } from '@/components/ui/Avatar';
import { ScoreBar } from '@/components/candidates/CandidateCard';

interface PipelineTableProps {
  candidates: CandidateProfile[];
  onSelectCandidate: (candidate: CandidateProfile) => void;
  onStatusChange: (id: string, newStatus: CandidateStatus) => void;
  onOpenOutreach: (candidate: CandidateProfile) => void;
}

export function PipelineTable({ candidates, onSelectCandidate, onStatusChange, onOpenOutreach }: PipelineTableProps) {
  const exportToCSV = () => {
    const headers = ['Name', 'Headline', 'Platform', 'Location', 'Match Score', 'Status', 'Session', 'Profile URL', 'Skills'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = candidates.map((c) => [c.name, c.headline, c.platform, c.location, c.match_score, c.status, c.job_title ?? '', c.profile_url, c.skills_detected.join('; ')].map(esc));
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidateradar-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
        <span className="text-body-sm text-mute tabular-nums">{candidates.length} candidates</span>
        <button type="button" onClick={exportToCSV} className="btn-ghost">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Platform</th>
              <th>Match</th>
              <th>Stage</th>
              <th>Session</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="hover:bg-canvas transition-colors">
                <td>
                  <div className="flex items-center gap-2.5 min-w-[200px]">
                    <Avatar name={c.name} src={c.avatar_url} size={28} />
                    <div className="min-w-0">
                      <button type="button" onClick={() => onSelectCandidate(c)} className="text-body-sm font-medium text-ink hover:underline text-left truncate block">
                        {c.name}
                      </button>
                      <p className="text-body-xs text-mute truncate max-w-[260px]">{c.headline}</p>
                    </div>
                  </div>
                </td>
                <td>
                  <PlatformBadge platform={c.platform} />
                </td>
                <td className="min-w-[180px]">
                  <ScoreBar score={c.match_score} />
                </td>
                <td>
                  <select value={c.status} onChange={(e) => onStatusChange(c.id, e.target.value as CandidateStatus)} className="select h-7 text-body-xs w-auto pr-7">
                    <option value="New">New</option>
                    <option value="Reviewed">Reviewed</option>
                    <option value="Saved">Saved</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Replied">Replied</option>
                    <option value="Shortlisted">Shortlisted</option>
                    <option value="Archived">Archived</option>
                  </select>
                </td>
                <td className="text-body-xs text-mute max-w-[200px] truncate">{c.job_title ?? '—'}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" onClick={() => onSelectCandidate(c)} className="btn-ghost btn-sm mr-1.5">
                    View
                  </button>
                  <button type="button" onClick={() => onOpenOutreach(c)} className="btn-primary btn-sm">
                    Message
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
