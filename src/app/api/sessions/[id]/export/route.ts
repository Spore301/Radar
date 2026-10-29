import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getSession } from '@/lib/db/sessions';
import { exportFileName, leadsToCsv } from '@/lib/export/leadsCsv';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/:id/export — every lead found for one session (one
 * search) as a CSV download, best match first. Scoped to the session's owner
 * like every other session read: another user's id is a 404.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const detail = await getSession(params.id, session!.user.id);
  if (!detail) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

  const name = exportFileName(detail.job.title);
  return new NextResponse(leadsToCsv(detail.candidates), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      // Personal data of third parties: never cache it on a shared proxy.
      'Cache-Control': 'private, no-store',
    },
  });
}
