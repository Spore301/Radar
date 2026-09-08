import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { validateBundle } from '@/lib/search/queryValidation';
import { MergedConstraints, XRayQuery } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/search/estimate
//
// Pre-flight cost check for a query bundle — called before a search run is
// ever reserved, so a malformed or duplicate query never reaches (and never
// bills) SerpAPI. This is intentionally the FIRST piece of the metering
// system built, and today it only knows about validation:
//
//   - budget / cache-awareness is added in later phases (CreditPeriod,
//     SerpQueryCache) — until then `budget` is null and `billableCount`
//     conservatively assumes every valid query is a fresh, billable call.
//
// Response shape matches the rest of the app's routes today (`{success,
// error}`, not the `{ok, data, error}` envelope the plan settles on) —
// switching every route to that envelope, including the shared
// requireSession() 401 path, is one coherent pass done together later
// (alongside the pipeline rewrite), not something to half-do in one new
// route while everything else stays on the old shape.
// ---------------------------------------------------------------------------

interface EstimateRequestBody {
  queries?: XRayQuery[];
  constraints?: MergedConstraints;
}

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: EstimateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const { queries, constraints } = body;

  if (!Array.isArray(queries) || queries.length === 0) {
    return NextResponse.json({ error: 'Provide a non-empty "queries" array.' }, { status: 400 });
  }
  if (!constraints) {
    return NextResponse.json({ error: 'Provide "constraints".' }, { status: 400 });
  }

  const results = validateBundle(queries, constraints);

  const validCount = results.filter((r) => r.ok).length;
  const blockedCount = results.length - validCount;

  return NextResponse.json({
    success: true,
    queries: results.map((r) => ({
      queryId: r.queryId,
      ok: r.ok,
      issues: r.issues,
      canonical: r.canonical,
      duplicateOfId: r.duplicateOfId,
      // Populated once src/lib/serp/cache.ts exists (BYOK + cache phase).
      // Until then every valid query is conservatively assumed billable.
      cacheStatus: 'unknown' as const,
    })),
    validCount,
    blockedCount,
    // Equal to validCount at this phase — no cache- or budget-awareness yet,
    // so this is a conservative upper bound, never an undercount.
    billableCount: validCount,
    canProceed: validCount > 0,
    blockReason: validCount > 0 ? null : ('NO_VALID_QUERIES' as const),
    // Filled in once CreditPeriod/CreditLedger exist (budget-observability
    // phase) — reconciled against the user's own SerpAPI /account.json.
    budget: null,
    note: 'Validation only: this estimate does not yet reflect cache hits or remaining budget.',
  });
}
