import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { createSession, listSessions } from '@/lib/db/sessions';
import { sanitizeSelectedPlatforms } from '@/lib/ai/client';

export const dynamic = 'force-dynamic';

/** GET /api/sessions — the history sidebar: every stored JD-to-leads session, newest first. */
export async function GET() {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;
  const sessions = await listSessions();
  return NextResponse.json({ success: true, sessions });
}

/**
 * POST /api/sessions — start a session from an already-parsed JD (the demo
 * role, or a client that parsed elsewhere). Parsing via /api/parse-jd creates
 * the session itself, so the normal upload path never calls this.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const { raw_jd_text, structured_jd, merged_constraints, query_bundle, keyword_map, title } = body ?? {};
  if (!structured_jd || !merged_constraints) {
    return NextResponse.json({ error: 'Provide structured_jd and merged_constraints.' }, { status: 400 });
  }

  const constraints = {
    ...merged_constraints,
    selected_platforms: sanitizeSelectedPlatforms(merged_constraints.selected_platforms, merged_constraints.role_type),
  };

  const job = await createSession(session!.user.id, {
    raw_jd_text: typeof raw_jd_text === 'string' ? raw_jd_text : '',
    structured_jd,
    merged_constraints: constraints,
    query_bundle: Array.isArray(query_bundle) ? query_bundle : [],
    keyword_map: keyword_map ?? {
      primary_title_variants: [],
      skill_synonyms: {},
      domain_keywords: [],
      seniority_signals: [],
      negative_keywords: [],
    },
    title,
  });

  return NextResponse.json({ success: true, session: job }, { status: 201 });
}
