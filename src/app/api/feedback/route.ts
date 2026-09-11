import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail, requireSession } from '@/lib/session';
import { createFeedback, listFeedback, type FeedbackKind } from '@/lib/db/feedback';
import { compressImage, ImageRejectedError, MAX_IMAGES_PER_REPORT, MAX_INPUT_BYTES } from '@/lib/feedback/images';

export const dynamic = 'force-dynamic';

const KINDS: FeedbackKind[] = ['bug', 'idea', 'other'];
const MAX_MESSAGE_CHARS = 4000;

/**
 * GET /api/feedback?scope=mine|all — the caller's reports; `all` is honoured
 * only for admins and otherwise silently falls back to `mine`.
 */
export async function GET(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const admin = isAdminEmail(session!.user.email);
  const all = new URL(req.url).searchParams.get('scope') === 'all';
  const feedback = await listFeedback({ userId: session!.user.id, admin }, all);
  return NextResponse.json({ success: true, is_admin: admin, scope: admin && all ? 'all' : 'mine', feedback });
}

/**
 * POST /api/feedback — multipart form: kind, message, page_url, images[].
 * Every image is re-encoded to WebP and downscaled before it is stored
 * (src/lib/feedback/images.ts); the response carries the resulting sizes so
 * the client can show what was saved.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Send the report as multipart form data.' }, { status: 400 });
  }

  const kindRaw = String(form.get('kind') ?? 'bug');
  const kind: FeedbackKind = KINDS.includes(kindRaw as FeedbackKind) ? (kindRaw as FeedbackKind) : 'bug';
  const message = String(form.get('message') ?? '').trim();
  if (!message) return NextResponse.json({ error: 'Describe what happened.' }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Keep the description under ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
  }
  const pageUrl = String(form.get('page_url') ?? '').trim().slice(0, 500) || null;

  const files = form.getAll('images').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
  if (files.length > MAX_IMAGES_PER_REPORT) {
    return NextResponse.json({ error: `Attach at most ${MAX_IMAGES_PER_REPORT} images.` }, { status: 400 });
  }
  const oversize = files.find((f) => f.size > MAX_INPUT_BYTES);
  if (oversize) {
    return NextResponse.json({ error: `"${oversize.name}" is over ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB.` }, { status: 400 });
  }

  try {
    const images = await Promise.all(
      files.map(async (f) => {
        const original = Buffer.from(await f.arrayBuffer());
        return { compressed: await compressImage(original), originalBytes: original.length, originalName: f.name?.slice(0, 200) ?? null };
      })
    );
    const report = await createFeedback(
      session!.user.id,
      { kind, message, pageUrl, userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null },
      images
    );
    return NextResponse.json({ success: true, feedback: report }, { status: 201 });
  } catch (err: any) {
    if (err instanceof ImageRejectedError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('Could not store feedback:', err);
    return NextResponse.json({ error: 'The report could not be saved. Please try again.' }, { status: 500 });
  }
}
