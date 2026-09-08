import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromBuffer, extractTextFromRawString } from '@/lib/extractors/jdTextExtractor';
import { parseJDWithAI } from '@/lib/ai/client';
import { requireSession } from '@/lib/session';
import { createSession } from '@/lib/db/sessions';
import { ndjsonResponse } from '@/lib/api/ndjson';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const STAGES = ['extract', 'structure', 'queries', 'keywords', 'session'] as const;
const STAGE_INDEX = Object.fromEntries(STAGES.map((k, i) => [k, i])) as Record<(typeof STAGES)[number], number>;

/**
 * POST /api/parse-jd — streams NDJSON progress (`stage` events, then `done`).
 * Stages: extract text → structure with AI → fill query templates → keyword
 * map → store the session. Validation problems (no text) return plain JSON
 * before the stream starts.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  const contentType = req.headers.get('content-type') || '';
  const customApiKey = req.headers.get('x-deepseek-api-key') || process.env.DEEPSEEK_API_KEY;

  // Read the request fully up front — the body can't be consumed inside the
  // stream producer after the response has started.
  let file: File | null = null;
  let rawText: string | null = null;
  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      file = (formData.get('file') as File | null) ?? null;
      rawText = (formData.get('raw_text') as string | null) ?? null;
    } else {
      const body = await req.json();
      rawText = typeof body?.raw_jd_text === 'string' ? body.raw_jd_text : null;
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the request body.' }, { status: 400 });
  }

  if (!file && !(rawText && rawText.trim())) {
    return NextResponse.json({ error: 'No job description text provided' }, { status: 400 });
  }

  return ndjsonResponse(async (emit) => {
    const stage = (key: (typeof STAGES)[number], label: string) =>
      emit({ type: 'stage', key, label, index: STAGE_INDEX[key], total: STAGES.length });

    stage('extract', file ? `Extracting text from ${file.name}…` : 'Cleaning up the pasted job description…');
    let text = '';
    let wordCount = 0;
    let warnings: string[] = [];
    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extraction = await extractTextFromBuffer(buffer, file.name);
      text = extraction.text;
      wordCount = extraction.wordCount;
      warnings = extraction.warnings;
    } else {
      const extraction = extractTextFromRawString(rawText!);
      text = extraction.text;
      wordCount = extraction.wordCount;
      warnings = extraction.warnings;
    }
    if (!text.trim()) {
      throw new Error('The file contained no readable text.');
    }

    const parseOutput = await parseJDWithAI(text, customApiKey, (key, label) => stage(key, label));

    parseOutput.structured_jd.extraction_warnings = [...warnings, ...parseOutput.structured_jd.extraction_warnings];

    stage('session', 'Saving this JD as a new session…');
    const storedSession = await createSession(session!.user.id, {
      raw_jd_text: text,
      structured_jd: parseOutput.structured_jd,
      merged_constraints: parseOutput.merged_constraints,
      query_bundle: parseOutput.query_bundle,
      keyword_map: parseOutput.keyword_map,
    });

    return {
      success: true,
      raw_jd_text: text,
      word_count: wordCount,
      ...parseOutput,
      session: storedSession,
    };
  });
}
