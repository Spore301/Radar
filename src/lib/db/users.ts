import { prisma } from './client';
import { describeProviderKey, type CredentialSummary } from '../credentials';

// ---------------------------------------------------------------------------
// The signed-in recruiter's profile: who they are, which organisation their
// outreach speaks for, whether onboarding is done, and whether a SerpAPI key
// is on file (never the key itself).
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  company: string | null;
  onboarded: boolean;
  serpapi: CredentialSummary;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    company: user.company,
    onboarded: Boolean(user.onboardedAt),
    serpapi: await describeProviderKey(userId, 'serpapi'),
  };
}

export async function isOnboarded(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } });
  return Boolean(user?.onboardedAt);
}

export interface ProfilePatch {
  name?: string;
  company?: string;
  /** Marks onboarding complete. */
  complete?: boolean;
}

export async function updateUserProfile(userId: string, patch: ProfilePatch): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() || null } : {}),
      ...(patch.company !== undefined ? { company: patch.company.trim() || null } : {}),
      ...(patch.complete ? { onboardedAt: new Date() } : {}),
    },
  });
}

/** The organisation name outreach copy should speak for. */
export async function getUserCompany(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { company: true } });
  return user?.company?.trim() || null;
}
