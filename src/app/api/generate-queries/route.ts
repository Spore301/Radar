import { NextRequest, NextResponse } from 'next/server';
import { generateQueriesWithDeepSeek, generateQueryBundleForConstraints } from '@/lib/ai/client';
import { requireSession } from '@/lib/session';

export const maxDuration = 30;
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

    // Generate queries using DeepSeek AI
    const queries = await generateQueriesWithDeepSeek(constraints, customKey);

    return NextResponse.json({
      success: true,
      queries,
    });
  } catch (error: any) {
    console.error('Error generating AI X-Ray queries:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate search queries' },
      { status: 500 }
    );
  }
}
