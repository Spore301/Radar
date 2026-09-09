import crypto from 'node:crypto';
import { prisma } from './db/client';

// ---------------------------------------------------------------------------
// Per-user provider credentials, encrypted at rest.
//
// A recruiter's SerpAPI key is the metered asset of this product (free
// accounts get a few hundred searches, so people rotate accounts), and it must
// never sit in browser storage or travel in request bodies. Keys are sealed
// with AES-256-GCM under a key derived from AUTH_SECRET and stored in the
// ProviderCredential table; only the last four characters are kept readable.
// ---------------------------------------------------------------------------

export type Provider = 'serpapi' | 'deepseek';

function sealingKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET is required to encrypt provider credentials.');
    }
    console.warn('AUTH_SECRET is not set — provider credentials are sealed with a development-only key.');
    return crypto.createHash('sha256').update('candidateradar-dev-insecure').digest();
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function seal(plain: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { ciphertext: enc.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function open(row: { ciphertext: string; iv: string; authTag: string }): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** The user's own key for a provider, or null when none is stored. */
export async function getProviderKey(userId: string, provider: Provider): Promise<string | null> {
  const row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  if (!row) return null;
  try {
    return open(row);
  } catch (err) {
    // AUTH_SECRET rotated, or a corrupt row: the key is unrecoverable; behave as if absent.
    console.error(`Could not decrypt ${provider} credential for user ${userId}:`, err);
    return null;
  }
}

export async function setProviderKey(userId: string, provider: Provider, key: string, verifiedAt?: Date): Promise<{ last4: string }> {
  const trimmed = key.trim();
  if (trimmed.length < 8) throw new Error('That key is too short to be valid.');
  const sealed = seal(trimmed);
  const keyLast4 = trimmed.slice(-4);
  await prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...sealed, keyLast4, lastVerifiedAt: verifiedAt ?? null },
    update: { ...sealed, keyLast4, lastVerifiedAt: verifiedAt ?? null },
  });
  return { last4: keyLast4 };
}

export async function clearProviderKey(userId: string, provider: Provider): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { userId, provider } });
}

export interface CredentialSummary {
  configured: boolean;
  last4: string | null;
  verifiedAt: string | null;
}

export async function describeProviderKey(userId: string, provider: Provider): Promise<CredentialSummary> {
  const row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  return row
    ? { configured: true, last4: row.keyLast4, verifiedAt: row.lastVerifiedAt?.toISOString() ?? null }
    : { configured: false, last4: null, verifiedAt: null };
}

export interface SerpApiAccount {
  ok: boolean;
  planName?: string;
  searchesPerMonth?: number;
  searchesLeft?: number;
  thisMonthUsage?: number;
  error?: string;
}

/**
 * Validates a SerpAPI key against the (free, un-metered) account endpoint and
 * returns the plan's remaining searches — the number a recruiter on a free
 * account actually cares about.
 */
export async function verifySerpApiKey(key: string): Promise<SerpApiAccount> {
  try {
    const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key.trim())}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : `SerpAPI responded with HTTP ${res.status}` };
    }
    return {
      ok: true,
      planName: data.plan_name,
      searchesPerMonth: typeof data.searches_per_month === 'number' ? data.searches_per_month : undefined,
      searchesLeft: typeof data.plan_searches_left === 'number' ? data.plan_searches_left : undefined,
      thisMonthUsage: typeof data.this_month_usage === 'number' ? data.this_month_usage : undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'SerpAPI did not answer within 15 seconds.' : err?.message || 'Could not reach SerpAPI.' };
  }
}
