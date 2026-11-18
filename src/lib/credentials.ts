import crypto from 'node:crypto';
import type { CredentialProvider } from '@prisma/client';
import { prisma } from './db/client';
import { fetchSerpApiAccount } from './search/providers/serpapi';
import { verifySerperKey, type SerperAccountCheck } from './search/providers/serper';

// ---------------------------------------------------------------------------
// Per-user provider credentials, encrypted at rest.
//
// A recruiter's SerpAPI key is the metered asset of this product (free
// accounts get a few hundred searches, so people rotate accounts), and it must
// never sit in browser storage or travel in request bodies. Keys are sealed
// with AES-256-GCM under a key derived from AUTH_SECRET and stored in the
// ProviderCredential table; only the last four characters are kept readable.
//
// Search keys: SerpAPI and/or Serper. At least one is needed to run a search;
// with both, the second is the fallback (see search/providers/index.ts).
// ---------------------------------------------------------------------------

export type Provider = 'serpapi' | 'deepseek' | 'serper';

/**
 * The Prisma enum gains `serper` with this change; until `prisma generate`
 * and the schema push have run, the generated client rejects it. Casting at
 * this one boundary keeps the build green, and every read of a `serper` row
 * below degrades to "no key" instead of throwing, so SerpAPI-only recruiters
 * are unaffected either way.
 */
const dbProvider = (provider: Provider) => provider as CredentialProvider;

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

/**
 * True only for the one failure the Serper fallbacks exist for: the database
 * (or the generated client) does not know the `serper` CredentialProvider value
 * yet. Every other error — a dropped connection, a timeout — must surface, or a
 * recruiter's run could silently move onto the platform keys.
 */
function isUnmigratedSerper(provider: Provider, err: unknown): boolean {
  if (provider !== 'serper') return false;
  const msg = String((err as any)?.message ?? err);
  return /CredentialProvider|invalid input value for enum|Invalid value for argument `provider`/i.test(msg);
}

/** The user's own key for a provider, or null when none is stored. */
export async function getProviderKey(userId: string, provider: Provider): Promise<string | null> {
  let row;
  try {
    row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider: dbProvider(provider) } } });
  } catch (err) {
    if (!isUnmigratedSerper(provider, err)) throw err;
    // Schema not migrated for Serper yet: behave as if no Serper key is stored.
    return null;
  }
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
  try {
    await prisma.providerCredential.upsert({
      where: { userId_provider: { userId, provider: dbProvider(provider) } },
      create: { userId, provider: dbProvider(provider), ...sealed, keyLast4, lastVerifiedAt: verifiedAt ?? null },
      update: { ...sealed, keyLast4, lastVerifiedAt: verifiedAt ?? null },
    });
  } catch (err) {
    if (isUnmigratedSerper(provider, err)) {
      console.error('Storing a Serper key failed (is the CredentialProvider enum migrated?):', err);
      throw new Error('Serper keys cannot be stored until the database is updated for them. Use a SerpAPI key for now, or ask the administrator to apply the schema update.');
    }
    throw err;
  }
  return { last4: keyLast4 };
}

export async function clearProviderKey(userId: string, provider: Provider): Promise<void> {
  try {
    await prisma.providerCredential.deleteMany({ where: { userId, provider: dbProvider(provider) } });
  } catch (err) {
    if (!isUnmigratedSerper(provider, err)) throw err;
  }
}

export interface CredentialSummary {
  configured: boolean;
  last4: string | null;
  verifiedAt: string | null;
}

export async function describeProviderKey(userId: string, provider: Provider): Promise<CredentialSummary> {
  let row;
  try {
    row = await prisma.providerCredential.findUnique({ where: { userId_provider: { userId, provider: dbProvider(provider) } } });
  } catch (err) {
    if (!isUnmigratedSerper(provider, err)) throw err;
    row = null;
  }
  return row
    ? { configured: true, last4: row.keyLast4, verifiedAt: row.lastVerifiedAt?.toISOString() ?? null }
    : { configured: false, last4: null, verifiedAt: null };
}

export interface SerpApiAccount {
  ok: boolean;
  planName?: string;
  searchesPerMonth?: number;
  searchesLeft?: number;
  /** Plan searches plus extra credits — what can still be spent. */
  totalSearchesLeft?: number;
  thisMonthUsage?: number;
  /** Searches made this hour and the plan's hourly throughput (50 on the free plan). */
  thisHourSearches?: number;
  hourlyLimit?: number;
  error?: string;
}

/**
 * Validates a SerpAPI key against the (free, un-metered) account endpoint and
 * returns the plan's remaining searches — the number a recruiter on a free
 * account actually cares about.
 */
export async function verifySerpApiKey(key: string, timeoutMs = 15_000): Promise<SerpApiAccount> {
  try {
    const a = await fetchSerpApiAccount(key, timeoutMs);
    return {
      ok: true,
      planName: a.planName,
      searchesPerMonth: a.searchesPerMonth,
      searchesLeft: a.planSearchesLeft,
      totalSearchesLeft: a.totalSearchesLeft,
      thisMonthUsage: a.thisMonthUsage,
      thisHourSearches: a.thisHourSearches,
      hourlyLimit: a.hourlyLimit,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.name === 'TimeoutError' ? `SerpAPI did not answer within ${Math.round(timeoutMs / 1000)} seconds.` : err?.message || 'Could not reach SerpAPI.',
    };
  }
}

export { verifySerperKey, type SerperAccountCheck };

// --- Search key resolution -----------------------------------------------------

export interface SearchKeys {
  serpapi: string | null;
  serper: string | null;
  /** Whose keys these are: the recruiter's own, or the platform's env fallback. */
  source: 'user' | 'platform' | 'none';
}

/**
 * The search keys a run of this user may spend. The recruiter's own keys
 * (stored encrypted) win; the platform keys in the environment are used only
 * when the recruiter has none at all — never mixed in as a silent fallback
 * that would bill the platform for a recruiter's run.
 */
export async function resolveSearchKeys(userId: string | null): Promise<SearchKeys> {
  if (userId) {
    const [serpapi, serper] = await Promise.all([getProviderKey(userId, 'serpapi'), getProviderKey(userId, 'serper')]);
    if (serpapi || serper) return { serpapi, serper, source: 'user' };
  }
  const serpapi = process.env.SERPAPI_KEY?.trim() || null;
  const serper = process.env.SERPER_API_KEY?.trim() || null;
  return { serpapi, serper, source: serpapi || serper ? 'platform' : 'none' };
}

export interface KeyUsability {
  usable: boolean;
  /** Recruiter-readable reason when not usable. */
  reason?: string;
  kind?: 'auth' | 'out_of_credits';
}

/**
 * Free pre-flight check of one search key: rejected keys and empty accounts
 * are not usable. A check that cannot complete (network, timeout) does not
 * block — the run's own error handling takes over.
 */
export async function checkSearchKey(provider: 'serpapi' | 'serper', key: string): Promise<KeyUsability> {
  if (provider === 'serpapi') {
    const a = await verifySerpApiKey(key, 5_000);
    if (!a.ok) {
      if (a.error && /invalid api key|unauthor|forbidden|401|403/i.test(a.error)) return { usable: false, kind: 'auth', reason: `SerpAPI rejected the stored key (${a.error}).` };
      return { usable: true };
    }
    if (typeof a.totalSearchesLeft === 'number' && a.totalSearchesLeft <= 0) return { usable: false, kind: 'out_of_credits', reason: 'Your SerpAPI account has no searches left this month.' };
    // The hourly figure is a throughput guarantee, not a documented cap, so it
    // never blocks a run up front; a real 429 is classified against it later.
    return { usable: true };
  }
  const s = await verifySerperKey(key, 5_000);
  if (!s.ok) {
    if (!s.unverified) return { usable: false, kind: 'auth', reason: `Serper rejected the stored key (${s.error ?? 'Unauthorized'}).` };
    return { usable: true };
  }
  if (typeof s.balance === 'number' && s.balance <= 0) return { usable: false, kind: 'out_of_credits', reason: 'Your Serper account has no credits left.' };
  return { usable: true };
}
