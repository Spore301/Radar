import { PrismaClient } from '@prisma/client';

// Standard Prisma + Next.js dev-mode guard: Next's hot-reload re-evaluates this
// module on every edit, which would otherwise open a fresh PrismaClient (and a
// fresh SQLite connection) each time. Stashing the instance on `globalThis`
// survives HMR; in production each server process still only ever creates one.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

let initialized = false;

/**
 * Runs once at process boot (see src/instrumentation.ts). Sets the SQLite
 * pragmas the rest of the app relies on:
 *  - WAL journal mode: lets readers and the writer proceed concurrently, which
 *    is what makes the credit-reservation transaction (src/lib/serp/credits.ts,
 *    added in a later phase) safe under concurrent requests instead of
 *    serializing on SQLITE_BUSY.
 *  - busy_timeout: a writer waits instead of immediately failing when the
 *    database is momentarily locked by another connection.
 *  - foreign_keys=ON: SQLite does not enforce FK constraints unless told to,
 *    per connection — without this, every `onDelete: Cascade` in the schema
 *    would silently do nothing.
 *  - synchronous=NORMAL: safe (and standard) alongside WAL; full fsync-per-
 *    commit durability isn't needed for a local, single-writer dev database.
 */
export async function initDb(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // SQLite's PRAGMA statements echo the value they just set back as a one-row
  // result set — even the "setter" form — so `$executeRawUnsafe` (which
  // requires zero rows) rejects them with P2010. `$queryRawUnsafe` accepts
  // both shapes and is what SQLite's own tooling uses for pragmas.
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
  await prisma.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
  await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
}
