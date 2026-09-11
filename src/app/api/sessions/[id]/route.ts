import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { deleteSession, getSession, updateSession } from '@/lib/db/sessions';
import { sanitizeSelectedPlatforms } from '@/lib/ai/client';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

/** GET /api/sessions/:id — everything needed to reopen a session where it was left. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const detail = await getSession(params.id, session!.user.id);
  if (!detail) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  return NextResponse.json({ success: true, ...detail });
}

/** PATCH /api/sessions/:id — save edited constraints / query bundle / title / status. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const patch: Parameters<typeof updateSession>[2] = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (body.merged_constraints) {
    patch.merged_constraints = {
      ...body.merged_constraints,
      selected_platforms: sanitizeSelectedPlatforms(
        body.merged_constraints.selected_platforms,
        body.merged_constraints.role_type
      ),
    };
  }
  if (Array.isArray(body.query_bundle)) patch.query_bundle = body.query_bundle;
  if (body.keyword_map) patch.keyword_map = body.keyword_map;
  if (['draft', 'parsing', 'searching', 'complete', 'archived'].includes(body.status)) patch.status = body.status;

  const job = await updateSession(params.id, session!.user.id, patch);
  if (!job) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  return NextResponse.json({ success: true, session: job });
}

/** DELETE /api/sessions/:id — removes the session and, by cascade, its runs, candidates and outreach logs. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const ok = await deleteSession(params.id, session!.user.id);
  if (!ok) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
