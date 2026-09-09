import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getUserProfile, updateUserProfile } from '@/lib/db/users';
import { clearProviderKey, setProviderKey, verifySerpApiKey } from '@/lib/credentials';

export const dynamic = 'force-dynamic';

/** GET /api/me — profile + whether a SerpAPI key is on file (never the key). */
export async function GET() {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const profile = await getUserProfile(session!.user.id);
  if (!profile) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  return NextResponse.json({ success: true, profile });
}

/**
 * PATCH /api/me — name, company, SerpAPI key (verified against SerpAPI before
 * it is stored), and `complete: true` to finish onboarding.
 */
export async function PATCH(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const userId = session!.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2)) {
    return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
  }
  if (body.company !== undefined && (typeof body.company !== 'string' || body.company.trim().length < 2)) {
    return NextResponse.json({ error: 'Please enter your company or organisation.' }, { status: 400 });
  }

  let serpapi: { last4: string; searchesLeft?: number; planName?: string } | undefined;
  if (typeof body.serpapi_key === 'string' && body.serpapi_key.trim()) {
    const check = await verifySerpApiKey(body.serpapi_key);
    if (!check.ok) {
      return NextResponse.json({ error: `SerpAPI rejected that key: ${check.error ?? 'unknown error'}` }, { status: 400 });
    }
    const { last4 } = await setProviderKey(userId, 'serpapi', body.serpapi_key, new Date());
    serpapi = { last4, searchesLeft: check.searchesLeft, planName: check.planName };
  } else if (body.serpapi_key === null) {
    await clearProviderKey(userId, 'serpapi');
  }

  await updateUserProfile(userId, {
    name: body.name,
    company: body.company,
    complete: body.complete === true,
  });

  const profile = await getUserProfile(userId);
  return NextResponse.json({ success: true, profile, serpapi });
}
