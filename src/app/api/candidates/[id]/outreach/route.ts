import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { logOutreach } from '@/lib/db/sessions';
import type { OutreachChannel } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CHANNELS: OutreachChannel[] = ['LinkedIn DM', 'Email', 'WhatsApp', 'Call'];

/** POST /api/candidates/:id/outreach — log a sent message; candidate moves to Contacted. */
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
  if (!CHANNELS.includes(channel)) return NextResponse.json({ error: 'Invalid outreach channel.' }, { status: 400 });
  if (typeof message !== 'string' || !message.trim()) return NextResponse.json({ error: 'Message body is required.' }, { status: 400 });

  const candidate = await logOutreach(params.id, session!.user.id, channel, message.trim(), typeof template_id === 'string' ? template_id : undefined);
  if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
  return NextResponse.json({ success: true, candidate }, { status: 201 });
}
