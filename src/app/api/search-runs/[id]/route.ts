import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getRunSnapshot, requestAbort } from '@/lib/db/searchRuns';

export const dynamic = 'force-dynamic';

// Both handlers are scoped to the run's owner inside the database query (see
// getRunSnapshot / requestAbort). A run id belonging to another user is
// reported as 404, exactly like one that does not exist — signing in is not
// authorisation to read or stop somebody else's search.

/** GET /api/search-runs/[id] — one of your own runs' live progress. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const run = await getRunSnapshot(params.id, session!.user.id);
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  return NextResponse.json({ run });
}

/**
 * DELETE /api/search-runs/[id] — asks the worker to stop one of your runs.
 *
 * Co-operative: a query already sent to SerpAPI is already paid for, so it is
 * allowed to land. Queries not yet started are skipped, and profiles found
 * before the stop are still stored on the session.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const run = await getRunSnapshot(params.id, session!.user.id);
  if (!run) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  if (run.status !== 'running') return NextResponse.json({ run });

  if (!(await requestAbort(params.id, session!.user.id))) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }
  return NextResponse.json({ run: { ...run, statusText: 'Stopping…' } });
}
