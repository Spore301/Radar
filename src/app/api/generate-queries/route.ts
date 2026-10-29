import { NextRequest, NextResponse } from 'next/server';
import { planQueries } from '@/lib/ai/client';
import { requireSession } from '@/lib/session';

// The reasoning model thinks before it plans; give it room.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const { constraints, apiKey: clientApiKey } = body;

    if (!constraints) {
      return NextResponse.json(
        { error: 'Missing constraints in request body' },
        { status: 400 }
      );
    }

    const customKey = clientApiKey || req.headers.get('x-deepseek-api-key') || process.env.DEEPSEEK_API_KEY;

    // The reasoning model plans the bundle; every query is validated before it is returned.
    const { queries, analysis, report } = await planQueries(constraints, customKey);

    return NextResponse.json({
      success: true,
      queries,
      analysis,
      plan: report ? { accepted: report.accepted, rejected: report.rejected.length, fallbackPlatforms: report.fallbackPlatforms } : null,
    });
  } catch (error: any) {
    console.error('Error generating AI X-Ray queries:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate search queries' },
      { status: 500 }
    );
  }
}
