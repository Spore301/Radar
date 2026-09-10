import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { updateCandidate } from '@/lib/db/sessions';
import { CHANNEL_IDS, STAGE_ORDER } from '@/lib/pipeline/stages';

export const dynamic = 'force-dynamic';

// One definition of the stages and channels (src/lib/pipeline/stages.ts).
const STATUSES = STAGE_ORDER;
const CHANNELS = CHANNEL_IDS;

/** PATCH /api/candidates/:id — shortlist / stage / notes / tags / follow-up, persisted to the session. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const patch: Parameters<typeof updateCandidate>[2] = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: `Invalid status "${body.status}".` }, { status: 400 });
    patch.status = body.status;
  }
  if (body.outreach_channel !== undefined) {
    if (body.outreach_channel !== null && !CHANNELS.includes(body.outreach_channel)) {
      return NextResponse.json({ error: `Invalid outreach channel "${body.outreach_channel}".` }, { status: 400 });
    }
    patch.outreach_channel = body.outreach_channel;
  }
  if (body.next_follow_up !== undefined) patch.next_follow_up = body.next_follow_up || null;
  if (body.notes !== undefined) patch.notes = typeof body.notes === 'string' ? body.notes : null;
  if (body.tags !== undefined) {
    patch.tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : [];
  }

  const candidate = await updateCandidate(params.id, session!.user.id, patch);
  if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ success: true, candidate });
}
