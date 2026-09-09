import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/** GET /api/health — liveness + a trivial database round-trip, for load balancers and uptime checks. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'up', time: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, db: 'down', error: err?.message ?? 'unknown' }, { status: 503 });
  }
}
