import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getRunSnapshot, requestAbort } from '@/lib/db/searchRuns';

export const dynamic = 'force-dynamic';

/** GET /api/search-runs/[id] — one run's live progress. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const run = await getRunSnapshot(params.id);
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  return NextResponse.json({ run });
}

/**
 * DELETE /api/search-runs/[id] — asks the worker to stop.
 *
 * Co-operative: a query already sent to SerpAPI is already paid for, so it is
 * allowed to land. Queries not yet started are skipped, and profiles found
 * before the stop are still stored on the session.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const run = await getRunSnapshot(params.id);
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  if (run.status !== 'running') return NextResponse.json({ run });

  await requestAbort(params.id);
  return NextResponse.json({ run: { ...run, statusText: 'Stopping…' } });
}
