import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isOnboarded } from '@/lib/db/users';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  title: 'RADR. See every candidate, own every decision.',
  description:
    'RADR. turns a job description into approved X-Ray searches across nine platforms, indexes every public profile Google returns, and tracks each candidate through your pipeline.',
};

// The public front door. Anyone signed in is sent straight to where they left
// off; everyone else sees the landing page (src/components/landing).
export default async function LandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect((await isOnboarded(session.user.id)) ? '/dashboard' : '/onboarding');
  }
  return <Landing />;
}
