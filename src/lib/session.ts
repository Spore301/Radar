import { NextResponse } from 'next/server';
import { auth } from './auth';

/**
 * Auth gate for API route handlers. Route Handlers run in the Node.js runtime
 * (unlike middleware, which is Edge-only in Next 14 — see the comment on
 * src/app/(app)/layout.tsx), so a real `auth()` DB check here is safe.
 *
 * Usage:
 *   const { session, unauthorized } = await requireSession();
 *   if (unauthorized) return unauthorized;
 *   // session.user.id is now available
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    return {
      session: null,
      unauthorized: NextResponse.json({ error: 'Unauthorized — please sign in.' }, { status: 401 }),
    };
  }
  return { session, unauthorized: null as null };
}
