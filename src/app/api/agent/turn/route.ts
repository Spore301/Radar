import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { ndjsonResponse } from '@/lib/api/ndjson';
import { runAgentTurn } from '@/lib/agent/engine';
import { extractTextFromBuffer } from '@/lib/extractors/jdTextExtractor';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const STAGES = ['read', 'extract', 'reason', 'queries', 'save'] as const;

/**
 * POST /api/agent/turn — one conversational turn, streamed as NDJSON stages
 * then a `done` AgentTurnResponse. Accepts JSON, or multipart with a JD file.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  let sessionId: string | null = null;
  let text = '';
  let jdText: string | null = null;
  let attachmentName: string | null = null;
  const deepseekKey = req.headers.get('x-deepseek-api-key');

  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      sessionId = (form.get('sessionId') as string | null) || null;
      text = (form.get('text') as string | null) || '';
      const file = form.get('file') as File | null;
      if (file) {
        const extraction = await extractTextFromBuffer(Buffer.from(await file.arrayBuffer()), file.name);
        jdText = extraction.text || null;
        attachmentName = file.name;
      }
    } else {
      const body = await req.json();
      sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      text = typeof body.text === 'string' ? body.text : '';
      jdText = typeof body.jd_text === 'string' && body.jd_text.trim() ? body.jd_text : null;
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 });
  }

  if (!text.trim() && !jdText) {
    return NextResponse.json({ error: 'Say something about the role, or attach a job description.' }, { status: 400 });
  }

  return ndjsonResponse(async (emit) =>
    runAgentTurn({
      userId: session!.user.id,
      sessionId,
      text,
      jdText,
      attachmentName,
      deepseekKey,
      onStage: (key, label) => emit({ type: 'stage', key, label, index: STAGES.indexOf(key), total: STAGES.length }),
    })
  );
}
