// Runs once when the Next.js server process starts. See
// https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
export async function register() {
  // Guard against the edge runtime, which can't load Prisma's Node bindings.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./lib/db/client');
    await initDb();
  }
}
