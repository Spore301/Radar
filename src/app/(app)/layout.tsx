import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';

// Auth gate for every page under this route group ('/', '/pipeline',
// '/templates', '/settings' — the group segment "(app)" adds no URL segment
// of its own). `/signin` and `/api/auth/*` live outside this group and are
// reachable without a session.
//
// This check does NOT live in src/middleware.ts. Next.js 14 middleware only
// runs in the Edge runtime, and our session strategy is 'database' (via the
// Prisma adapter) — Prisma's query engine cannot run there. A server-component
// layout runs in the Node.js runtime, same as every other server component and
// route handler in this app, so `auth()` here does a real, correct DB check.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect('/signin');
  }

  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
