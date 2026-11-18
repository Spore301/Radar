import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getUserProfile, updateUserProfile } from '@/lib/db/users';
import { clearProviderKey, describeProviderKey, setProviderKey, verifySerpApiKey, verifySerperKey } from '@/lib/credentials';

export const dynamic = 'force-dynamic';

/** The profile plus the Serper key summary (users.ts reports SerpAPI only). Never the keys themselves. */
async function profileWithKeys(userId: string) {
  const profile = await getUserProfile(userId);
  if (!profile) return null;
  return { ...profile, serper: await describeProviderKey(userId, 'serper') };
}

/** GET /api/me — profile + which search keys are on file (never the keys). */
export async function GET() {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const profile = await profileWithKeys(session!.user.id);
  if (!profile) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  return NextResponse.json({ success: true, profile });
}

/**
 * PATCH /api/me — name, company, search keys (`serpapi_key`, `serper_key`;
 * each verified against its provider's free account endpoint before it is
 * stored; `null` removes it), and `complete: true` to finish onboarding.
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

  let serper: { last4: string; balance?: number } | undefined;
  if (typeof body.serper_key === 'string' && body.serper_key.trim()) {
    const check = await verifySerperKey(body.serper_key);
    if (!check.ok) {
      const error = check.unverified ? check.error ?? 'Serper could not check the key right now. Try again in a minute.' : `Serper rejected that key: ${check.error ?? 'unknown error'}`;
      return NextResponse.json({ error }, { status: check.unverified ? 502 : 400 });
    }
    try {
      const { last4 } = await setProviderKey(userId, 'serper', body.serper_key, check.unverified ? undefined : new Date());
      serper = { last4, balance: check.balance };
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'The Serper key could not be stored.' }, { status: 500 });
    }
  } else if (body.serper_key === null) {
    await clearProviderKey(userId, 'serper');
  }

  await updateUserProfile(userId, {
    name: body.name,
    company: body.company,
    complete: body.complete === true,
  });

  const profile = await profileWithKeys(userId);
  return NextResponse.json({ success: true, profile, serpapi, serper });
}
