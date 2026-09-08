import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { listCandidates } from '@/lib/db/sessions';
import type { CandidateStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUSES: CandidateStatus[] = ['New', 'Reviewed', 'Saved', 'Contacted', 'Replied', 'Shortlisted', 'Archived'];

/**
 * GET /api/candidates?jobId=&status=Shortlisted,Contacted
 * Cross-session listing for the pipeline board. Each candidate carries the
 * title of the session that found them.
 */
export async function GET(req: NextRequest) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId') ?? undefined;
  const statuses = (url.searchParams.get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CandidateStatus => STATUSES.includes(s as CandidateStatus));

  const candidates = await listCandidates({ jobId, statuses });
  return NextResponse.json({ success: true, candidates });
}
