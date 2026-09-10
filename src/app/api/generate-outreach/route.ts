import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';
import { getUserProfile } from '@/lib/db/users';
import { callDeepSeekAPI } from '@/lib/ai/client';
import { OUTREACH_GENERATOR_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { channelDef } from '@/lib/pipeline/stages';
import type { CandidateProfile, OutreachChannel } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Tone = 'Warm' | 'Professional' | 'Direct' | 'Short & Punchy';

interface Draft {
  subject_line: string | null;
  message_body: string;
  /** What in the indexed profile the message leans on — shown to the recruiter so they can judge the grounding. */
  grounding: string[];
  /** 'ai' when the model wrote it; 'template' when the deterministic fallback did. Never hidden from the UI. */
  source: 'ai' | 'template';
}

/**
 * POST /api/generate-outreach — drafts a message for one candidate.
 *
 * The model writes it when a DeepSeek key is available (recruiter's own key in
 * the x-deepseek-api-key header, else the platform key); otherwise a
 * deterministic template fills in. Either way the draft may only use what was
 * actually indexed about the person, and a LinkedIn connection note is cut to
 * the platform's 300-character cap before it leaves this route.
 */
export async function POST(req: NextRequest) {
  const { session, unauthorized } = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const candidate = body?.candidate as CandidateProfile | undefined;
    const channel = (body?.channel ?? 'LinkedIn DM') as OutreachChannel;
    const tone = (body?.tone ?? 'Warm') as Tone;
    if (!candidate?.name) return NextResponse.json({ error: 'A candidate is required.' }, { status: 400 });

    const profile = await getUserProfile(session!.user.id);
    const recruiter = { name: profile?.name || 'the recruiting team', company: profile?.company || body?.companyName || 'our team' };
    const role = (body?.jobTitle as string) || 'the role';
    const def = channelDef(channel);

    const apiKey = req.headers.get('x-deepseek-api-key') || process.env.DEEPSEEK_API_KEY || null;
    let draft: Draft | null = apiKey ? await draftWithModel(apiKey, candidate, role, recruiter, tone, channel) : null;
    if (!draft) draft = draftFromTemplate(candidate, role, recruiter, tone, channel);

    // Platform caps are enforced server-side, not left to the model's arithmetic.
    if (def.maxChars && draft.message_body.length > def.maxChars) {
      draft.message_body = trimToCap(draft.message_body, def.maxChars);
    }
    if (!def.hasSubject) draft.subject_line = null;

    return NextResponse.json({
      success: true,
      subject_line: draft.subject_line,
      message_body: draft.message_body,
      word_count: draft.message_body.split(/\s+/).filter(Boolean).length,
      char_count: draft.message_body.length,
      grounding: draft.grounding,
      source: draft.source,
    });
  } catch (error: any) {
    console.error('Error generating outreach message:', error);
    return NextResponse.json({ error: error?.message || 'Failed to generate outreach message' }, { status: 500 });
  }
}

// --- model ------------------------------------------------------------------------

async function draftWithModel(
  apiKey: string,
  c: CandidateProfile,
  role: string,
  recruiter: { name: string; company: string },
  tone: Tone,
  channel: OutreachChannel
): Promise<Draft | null> {
  const def = channelDef(channel);
  // Only what was indexed. The model never sees fields it could mistake for facts.
  const userPrompt = `<CANDIDATE_DATA>
Name: ${c.name}
Headline: ${c.headline || '(none)'}
Location: ${c.location || '(unknown)'}
Platform: ${c.platform}
Skills detected on the profile: ${c.skills_detected.length ? c.skills_detected.join(', ') : '(none detected)'}
Indexed snippet: ${c.summary_snippet || '(none)'}
</CANDIDATE_DATA>

<JOB_CONTEXT>
Role: ${role}
Company: ${recruiter.company}
Recruiter (sender): ${recruiter.name}
</JOB_CONTEXT>

<FORMAT>
Channel: ${def.label}
${def.maxChars ? `Hard limit: ${def.maxChars} characters INCLUDING spaces — aim for ${Math.floor(def.maxChars * 0.9)} or fewer.` : ''}
${def.hasSubject ? 'Include a subject line.' : 'No subject line.'}
Tone: ${tone}
</FORMAT>`;

  const out = await callDeepSeekAPI<{ subject_line?: string | null; message_body?: string; grounding?: string[] }>(userPrompt, OUTREACH_GENERATOR_SYSTEM_PROMPT, apiKey, {
    timeoutMs: 45_000,
    retries: 1,
  });
  if (!out || typeof out.message_body !== 'string' || !out.message_body.trim()) return null;
  return {
    subject_line: typeof out.subject_line === 'string' && out.subject_line.trim() ? out.subject_line.trim() : null,
    message_body: out.message_body.trim(),
    grounding: Array.isArray(out.grounding) ? out.grounding.filter((g): g is string => typeof g === 'string').slice(0, 5) : [],
    source: 'ai',
  };
}

// --- deterministic fallback -----------------------------------------------------------

function draftFromTemplate(c: CandidateProfile, role: string, recruiter: { name: string; company: string }, tone: Tone, channel: OutreachChannel): Draft {
  const first = c.name.split(/\s+/)[0] || c.name;
  const skills = c.skills_detected.slice(0, 3);
  const hook = skills.length ? `your work with ${skills.join(', ')}` : c.headline ? `your background as ${c.headline.split(/[|·•-]/)[0].trim()}` : 'your profile';
  const grounding = skills.length ? skills.map((s) => `skill detected: ${s}`) : c.headline ? [`headline: ${c.headline}`] : [];
  const sign = `${recruiter.name}, ${recruiter.company}`;

  if (channel === 'LinkedIn Note') {
    const body =
      tone === 'Short & Punchy'
        ? `Hi ${first} — ${hook} caught my eye. I'm hiring a ${role} at ${recruiter.company} and would value a quick chat. Open to connecting? — ${recruiter.name}`
        : `Hi ${first}, I came across ${hook} and I'm hiring a ${role} at ${recruiter.company}. I'd welcome the chance to connect and share a few details, no pressure either way. — ${recruiter.name}`;
    return { subject_line: null, message_body: trimToCap(body, 300), grounding, source: 'template' };
  }

  if (channel === 'Call') {
    return {
      subject_line: null,
      grounding,
      source: 'template',
      message_body: `Opening: Hi ${first}, this is ${recruiter.name} from ${recruiter.company} — is now a bad time?
Why you: I saw ${hook}${c.location ? ` and that you're based in ${c.location}` : ''}.
The role: we're hiring a ${role}; two sentences on the team and what they'd own.
Ask: would you be open to a 15-minute conversation this week to see if it's worth exploring?
If not now: is there a better time, or someone you'd point me to?
Close: thank them, confirm the follow-up, send a short recap message.`,
    };
  }

  if (channel === 'WhatsApp') {
    return {
      subject_line: null,
      grounding,
      source: 'template',
      message_body: `Hi ${first}, ${recruiter.name} here from ${recruiter.company}. I saw ${hook} and we're hiring a ${role}. Would you be open to a quick 10-minute call this week? Happy to share details first if you prefer.`,
    };
  }

  const subject = channel === 'Email' ? `${role} at ${recruiter.company} — ${first}, a quick question` : null;
  let body: string;
  if (tone === 'Short & Punchy') {
    body = `Hi ${first} — ${hook} stood out. We're hiring a ${role} at ${recruiter.company}. Open to a 10-minute chat this week?\n\n${sign}`;
  } else if (tone === 'Direct') {
    body = `Hi ${first},\n\nI noticed ${hook}. We're hiring a ${role} at ${recruiter.company} and your profile matches what the team needs.\n\nIf you're open to exploring it, I can share the brief and set up a 15-minute call this week. Which day suits you?\n\n${sign}`;
  } else if (tone === 'Professional') {
    body = `Dear ${first},\n\nI'm reaching out about a ${role} position at ${recruiter.company}. ${hook.charAt(0).toUpperCase() + hook.slice(1)} aligns closely with the role's requirements.\n\nIf you'd like to learn more, I'd be glad to arrange a brief introductory conversation at a time that suits you.\n\nKind regards,\n${sign}`;
  } else {
    body = `Hi ${first},\n\nI came across your profile and ${hook} caught my attention. We're growing the team at ${recruiter.company} and looking for a ${role} — someone with exactly that kind of background.\n\nWould you be open to a relaxed 15-minute chat to hear what we're building? No pressure either way.\n\nBest,\n${sign}`;
  }
  return { subject_line: subject, message_body: body, grounding, source: 'template' };
}

/** Cuts at a sentence or word boundary so a capped note never ends mid-word. */
function trimToCap(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const slice = text.slice(0, cap - 1);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  if (sentence > cap * 0.6) return slice.slice(0, sentence + 1).trim();
  const word = slice.lastIndexOf(' ');
  return `${slice.slice(0, word > 0 ? word : slice.length).trim()}…`;
}
