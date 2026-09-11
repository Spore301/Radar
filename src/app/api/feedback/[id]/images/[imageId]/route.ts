import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail, requireSession } from '@/lib/session';
import { getFeedbackImage } from '@/lib/db/feedback';

export const dynamic = 'force-dynamic';

/**
 * GET /api/feedback/:id/images/:imageId — streams one stored screenshot.
 * Same ownership rule as the report itself: the reporter, or an admin.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; imageId: string } }) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const image = await getFeedbackImage(params.id, params.imageId, {
    userId: session!.user.id,
    admin: isAdminEmail(session!.user.email),
  });
  if (!image) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    status: 200,
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.bytes),
      // Private to the signed-in viewer; the bytes never change once stored.
      'Cache-Control': 'private, max-age=86400, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
