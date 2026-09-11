import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail, requireSession } from '@/lib/session';
import { deleteFeedback, setFeedbackStatus } from '@/lib/db/feedback';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

/** PATCH /api/feedback/:id — admins mark a report resolved or reopen it. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  if (!isAdminEmail(session!.user.email)) {
    return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if (body?.status !== 'open' && body?.status !== 'resolved') {
    return NextResponse.json({ error: 'status must be "open" or "resolved".' }, { status: 400 });
  }

  const report = await setFeedbackStatus(params.id, body.status);
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  return NextResponse.json({ success: true, feedback: report });
}

/** DELETE /api/feedback/:id — the reporter withdraws their report, or an admin removes it. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const ok = await deleteFeedback(params.id, { userId: session!.user.id, admin: isAdminEmail(session!.user.email) });
  if (!ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
