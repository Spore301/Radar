import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getUserProfile } from '@/lib/db/users';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=%2Fonboarding');
  const profile = await getUserProfile(session.user.id);
  if (profile?.onboarded) redirect('/dashboard');
  return <OnboardingFlow initialName={profile?.name ?? ''} initialCompany={profile?.company ?? ''} email={profile?.email ?? null} />;
}
