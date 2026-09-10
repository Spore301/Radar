import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { listOutreachLogs, logOutreach } from '@/lib/db/sessions';
import { CHANNEL_IDS, channelDef } from '@/lib/pipeline/stages';
import type { OutreachChannel } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** GET /api/candidates/:id/outreach — the candidate's outreach history, newest first. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const logs = await listOutreachLogs(params.id);
  return NextResponse.json({ success: true, logs });
}

/**
 * POST /api/candidates/:id/outreach — log a sent message or connection note.
 * The candidate moves to Contacted unless already further along; a follow-up
 * date is suggested when none is set.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const { channel, message, template_id } = body ?? {};
  if (!CHANNEL_IDS.includes(channel)) return NextResponse.json({ error: 'Invalid outreach channel.' }, { status: 400 });
  if (typeof message !== 'string' || !message.trim()) return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  // The platform's own cap is enforced here too, so a note that LinkedIn would
  // refuse is never logged as sent.
  const def = channelDef(channel as OutreachChannel);
  if (def.maxChars && message.trim().length > def.maxChars) {
    return NextResponse.json({ error: `A ${def.label.toLowerCase()} is limited to ${def.maxChars} characters (this one is ${message.trim().length}).` }, { status: 400 });
  }

  const candidate = await logOutreach(params.id, session!.user.id, channel, message.trim(), typeof template_id === 'string' ? template_id : undefined);
  if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ success: true, candidate }, { status: 201 });
}
