import { prisma } from '../db/client';
import { createSession, getSession, updateSession } from '../db/sessions';
import { callDeepSeekAPI, generateQueriesWithDeepSeek, heuristicParseJD, looksLikeJobDescription, sanitizeSelectedPlatforms, defaultPlatformsForRole } from '../ai/client';
import { AGENT_SYSTEM_PROMPT } from '../ai/prompts';
import { parseLocation } from '../search/location';
import { isSoftSkill } from '../search/xrayTemplates';
import type { MergedConstraints, XRayQuery } from '../types';
import type { AgentField, AgentMessage, AgentModelOutput, AgentQuestion, AgentTurnResponse } from './types';

// ---------------------------------------------------------------------------
// Agent engine — one conversational turn.
//
// Deterministic frame, model in the middle: the engine owns what "complete"
// means, merges the model's extraction into the session's constraints without
// letting it overwrite confirmed values with blanks, decides readiness itself,
// and generates the same approved query bundle the dashboard would. With no
// DeepSeek key the extraction falls back to the heuristic parser and a fixed
// question catalogue, so the agent still works keyless.
// ---------------------------------------------------------------------------

export type AgentStage = (key: 'read' | 'extract' | 'reason' | 'queries' | 'save', label: string) => void;

export interface AgentTurnInput {
  userId: string;
  sessionId: string | null;
  text: string;
  jdText?: string | null;
  attachmentName?: string | null;
  deepseekKey?: string | null;
  onStage?: AgentStage;
}

const now = () => new Date().toISOString();
const mid = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const EMPTY: MergedConstraints = {
  job_title: '',
  role_type: 'Other',
  seniority: 'Any',
  years_of_experience: { min: 0, max: 10 },
  location: '',
  remote_eligible: false,
  must_have_skills: [],
  nice_to_have_skills: [],
  domain: [],
  education: '',
  selected_platforms: [],
  additional_details: '',
  results_cap: 50,
};

const uniq = (xs: string[]) => Array.from(new Map(xs.map((x) => [x.trim().toLowerCase(), x.trim()])).values()).filter(Boolean);

/** Merge model output into the running constraints; blanks never overwrite values. */
function mergeConstraints(prev: MergedConstraints, next: AgentModelOutput['constraints']): MergedConstraints {
  const out: MergedConstraints = { ...prev };
  if (next.job_title?.trim()) out.job_title = next.job_title.trim();
  if (next.role_type && ['Engineering', 'Design', 'Marketing', 'Sales', 'Operations', 'Other'].includes(next.role_type)) out.role_type = next.role_type;
  if (next.seniority && ['Junior', 'Mid', 'Senior', 'Staff', 'Lead', 'Executive', 'Any'].includes(next.seniority)) out.seniority = next.seniority;
  if (next.years_of_experience && Number.isFinite(next.years_of_experience.min) && Number.isFinite(next.years_of_experience.max)) {
    out.years_of_experience = { min: Math.max(0, next.years_of_experience.min), max: Math.max(next.years_of_experience.min, next.years_of_experience.max) };
  }
  if (typeof next.location === 'string' && next.location.trim()) {
    const parsed = parseLocation(next.location);
    out.location = parsed.display || next.location.trim();
    if (parsed.remote) out.remote_eligible = true;
  }
  if (typeof next.remote_eligible === 'boolean' && next.remote_eligible) out.remote_eligible = true;
  if (next.must_have_skills?.length) {
    const hard = next.must_have_skills.filter((s) => !isSoftSkill(s));
    const soft = next.must_have_skills.filter((s) => isSoftSkill(s));
    out.must_have_skills = uniq([...prev.must_have_skills, ...hard]);
    out.nice_to_have_skills = uniq([...prev.nice_to_have_skills, ...soft]);
  }
  if (next.nice_to_have_skills?.length) out.nice_to_have_skills = uniq([...out.nice_to_have_skills, ...next.nice_to_have_skills]).filter((s) => !out.must_have_skills.includes(s));
  if (next.domain?.length) out.domain = uniq([...prev.domain, ...next.domain]).slice(0, 6);
  if (next.selected_platforms?.length) out.selected_platforms = sanitizeSelectedPlatforms(next.selected_platforms, out.role_type);
  if (typeof next.additional_details === 'string' && next.additional_details.trim()) {
    out.additional_details = [prev.additional_details, next.additional_details.trim()].filter(Boolean).join('\n');
  }
  if (out.selected_platforms.length === 0) out.selected_platforms = defaultPlatformsForRole(out.role_type);
  return out;
}

/** The engine's own definition of "enough to search" — never delegated to the model. */
export function missingFields(c: MergedConstraints): AgentField[] {
  const missing: AgentField[] = [];
  if (!c.job_title.trim()) missing.push('job_title');
  if (!c.location.trim() && !c.remote_eligible) missing.push('location');
  if (c.must_have_skills.filter((s) => !isSoftSkill(s)).length === 0 && c.domain.length === 0) missing.push('must_have_skills');
  return missing;
}

const QUESTION_CATALOGUE: Record<AgentField, AgentQuestion> = {
  job_title: { id: 'q-title', field: 'job_title', text: 'What is the exact job title you are hiring for?' },
  location: { id: 'q-location', field: 'location', text: 'Which city should candidates be in — or is the role remote?', options: ['Remote'] },
  seniority: { id: 'q-seniority', field: 'seniority', text: 'How senior is the role?', options: ['Junior', 'Mid', 'Senior', 'Staff', 'Lead'] },
  must_have_skills: { id: 'q-skills', field: 'must_have_skills', text: 'Which one to three hard skills or tools are non-negotiable? If none, name the industry or domain instead.' },
  domain: { id: 'q-domain', field: 'domain', text: 'Which industry or domain should candidates come from?' },
  selected_platforms: { id: 'q-platforms', field: 'selected_platforms', text: 'Which platforms should I search?' },
  additional_details: { id: 'q-details', field: 'additional_details', text: 'Anything that must or must not appear on a profile — exact phrases, companies to avoid, profile types to exclude?' },
  years_of_experience: { id: 'q-years', field: 'years_of_experience', text: 'How many years of experience?' },
};

/** Keyless fallback: heuristic extraction from everything the recruiter has said, plus catalogue questions. */
function heuristicTurn(prev: MergedConstraints, userText: string, jdText: string | null | undefined): AgentModelOutput {
  const thoughts: string[] = [];
  const source = [jdText ?? '', userText].filter(Boolean).join('\n\n');
  let extracted: AgentModelOutput['constraints'] = {};

  if (source.trim()) {
    const padded = source.split(/\s+/).length < 25 ? `${source}\n\nrole requirements skills experience` : source; // let short prompts through the JD sanity gate
    const h = heuristicParseJD(padded);
    const c = h.merged_constraints;
    thoughts.push(jdText ? `Read the attached description (${source.split(/\s+/).length} words).` : 'Read the recruiter’s message.');
    extracted = {
      ...(c.job_title ? { job_title: c.job_title } : {}),
      role_type: c.role_type,
      ...(c.seniority !== 'Any' ? { seniority: c.seniority } : {}),
      ...(c.location ? { location: c.location } : {}),
      ...(c.remote_eligible ? { remote_eligible: true } : {}),
      ...(c.must_have_skills.length ? { must_have_skills: c.must_have_skills } : {}),
      ...(c.nice_to_have_skills.length ? { nice_to_have_skills: c.nice_to_have_skills } : {}),
      ...(c.domain.length ? { domain: c.domain } : {}),
    };
    // A one-line answer to an open question: treat it as the value for the first missing field.
    const gaps = missingFields(prev);
    if (!extracted.job_title && gaps[0] === 'job_title' && userText.split(/\s+/).length <= 8) extracted.job_title = userText.trim();
    if (!extracted.location && gaps.includes('location') && parseLocation(userText).display) extracted.location = userText.trim();
    if (!extracted.must_have_skills && gaps.includes('must_have_skills') && !gaps.includes('job_title') && userText.split(/[,/]|\band\b/).length <= 4 && userText.split(/\s+/).length <= 12) {
      extracted.must_have_skills = userText.split(/[,/]|\band\b/).map((s) => s.trim()).filter(Boolean);
    }
    const got = Object.keys(extracted).filter((k) => k !== 'role_type');
    thoughts.push(got.length ? `Extracted: ${got.join(', ')}.` : 'Found nothing new to extract from this message.');
  }

  const merged = mergeConstraints(prev, extracted);
  const missing = missingFields(merged);
  const questions = missing.slice(0, 2).map((f) => QUESTION_CATALOGUE[f]);
  if (missing.length) thoughts.push(`Still missing: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')} — asking for ${questions.length === 1 ? 'it' : 'them'} before searching.`);
  else thoughts.push('Title, location and a searchable skill or domain are all present — building the approved query bundle.');

  const reply = missing.length
    ? questions.length === 1
      ? questions[0].text
      : 'Two things before I search:'
    : `Constraints are complete for ${merged.job_title}${merged.location ? ` in ${merged.location}` : ''}. Building the queries now.`;

  return { thoughts, constraints: extracted, questions, reply, ready: missing.length === 0 };
}

function coerceModelOutput(raw: any): AgentModelOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const strs = (v: unknown, max = 8) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, max) : []);
  const c = raw.constraints && typeof raw.constraints === 'object' ? raw.constraints : {};
  const questions: AgentQuestion[] = Array.isArray(raw.questions)
    ? raw.questions
        .filter((q: any) => q && typeof q.text === 'string' && typeof q.field === 'string')
        .slice(0, 2)
        .map((q: any, i: number) => ({ id: typeof q.id === 'string' ? q.id : `q-${i}`, field: q.field as AgentField, text: q.text.trim(), options: strs(q.options, 6) }))
    : [];
  return {
    thoughts: strs(raw.thoughts, 6),
    constraints: {
      ...(typeof c.job_title === 'string' ? { job_title: c.job_title } : {}),
      ...(typeof c.role_type === 'string' ? { role_type: c.role_type } : {}),
      ...(typeof c.seniority === 'string' ? { seniority: c.seniority } : {}),
      ...(c.years_of_experience && typeof c.years_of_experience.min === 'number' ? { years_of_experience: c.years_of_experience } : {}),
      ...(typeof c.location === 'string' ? { location: c.location } : {}),
      ...(typeof c.remote_eligible === 'boolean' ? { remote_eligible: c.remote_eligible } : {}),
      ...(Array.isArray(c.must_have_skills) ? { must_have_skills: strs(c.must_have_skills, 10) } : {}),
      ...(Array.isArray(c.nice_to_have_skills) ? { nice_to_have_skills: strs(c.nice_to_have_skills, 12) } : {}),
      ...(Array.isArray(c.domain) ? { domain: strs(c.domain, 6) } : {}),
      ...(Array.isArray(c.selected_platforms) ? { selected_platforms: strs(c.selected_platforms, 9) } : {}),
      ...(typeof c.additional_details === 'string' ? { additional_details: c.additional_details } : {}),
    },
    questions,
    reply: typeof raw.reply === 'string' ? raw.reply.trim() : '',
    ready: Boolean(raw.ready),
  };
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResponse> {
  const { userId, text, jdText, onStage } = input;
  const apiKey = input.deepseekKey || process.env.DEEPSEEK_API_KEY || null;

  // --- load or start the session --------------------------------------------
  let sessionId = input.sessionId;
  let prev: MergedConstraints = EMPTY;
  let transcript: AgentMessage[] = [];
  let rawJd = '';
  if (sessionId) {
    const detail = await getSession(sessionId);
    if (!detail) throw new Error('Session not found.');
    prev = { ...EMPTY, ...detail.job.merged_constraints };
    transcript = (detail.agent_transcript ?? []) as AgentMessage[];
    rawJd = detail.job.raw_jd_text;
  }

  if (jdText) {
    onStage?.('read', `Reading the attached job description (${jdText.split(/\s+/).length} words)…`);
    const sanity = looksLikeJobDescription(jdText);
    if (!sanity.ok) throw new Error(`The attachment doesn't look like a job description. ${sanity.reason ?? ''}`.trim());
    rawJd = jdText;
  }

  const userMessage: AgentMessage = {
    id: mid(),
    role: 'user',
    content: text.trim() || (jdText ? 'Here is the job description.' : ''),
    at: now(),
    ...(jdText && input.attachmentName ? { attachment: { name: input.attachmentName, words: jdText.split(/\s+/).length } } : {}),
  };

  // --- extract + reason -------------------------------------------------------
  onStage?.('extract', apiKey ? 'Extracting constraints with DeepSeek…' : 'Extracting constraints…');
  let out: AgentModelOutput | null = null;
  if (apiKey) {
    const convo = transcript
      .slice(-10)
      .map((m) => `${m.role === 'user' ? 'Recruiter' : 'Agent'}: ${m.content}`)
      .join('\n');
    const prompt = `<CURRENT_CONSTRAINTS>\n${JSON.stringify(prev)}\n</CURRENT_CONSTRAINTS>\n<CONVERSATION>\n${convo || '(start)'}\n</CONVERSATION>\n<USER_MESSAGE>\n${userMessage.content}\n</USER_MESSAGE>\n${
      jdText ? `<JD_TEXT>\n${jdText.slice(0, 7000)}\n</JD_TEXT>\n` : ''
    }<PLATFORMS>LinkedIn, GitHub, StackOverflow, Wellfound, Behance, Dribbble, Xing, Resumes, MultiSite</PLATFORMS>`;
    out = coerceModelOutput(await callDeepSeekAPI<any>(prompt, AGENT_SYSTEM_PROMPT, apiKey, { timeoutMs: 75_000, retries: 1 }));
  }
  onStage?.('reason', 'Checking what is still missing…');
  if (!out) out = heuristicTurn(prev, userMessage.content, jdText);

  const constraints = mergeConstraints(prev, out.constraints);
  const missing = missingFields(constraints);
  const ready = missing.length === 0; // the engine decides, not the model
  const questions = ready ? [] : out.questions.length ? out.questions : missing.slice(0, 2).map((f) => QUESTION_CATALOGUE[f]);
  const thoughts = out.thoughts.length ? out.thoughts : heuristicTurn(prev, userMessage.content, jdText).thoughts;

  // --- queries when complete ---------------------------------------------------
  let queries: XRayQuery[] = [];
  if (ready) {
    onStage?.('queries', 'Filling the approved X-Ray templates…');
    queries = await generateQueriesWithDeepSeek(constraints, apiKey ?? undefined);
  }

  const reply =
    out.reply ||
    (ready ? `Constraints are complete for ${constraints.job_title}. ${queries.length} queries are ready to review.` : questions[0]?.text || 'Tell me more about the role.');

  const assistant: AgentMessage = { id: mid(), role: 'assistant', content: reply, at: now(), thoughts, questions, constraints, ready };
  const nextTranscript = [...transcript, userMessage, assistant];

  // --- persist ------------------------------------------------------------------
  onStage?.('save', 'Saving the session…');
  const title = constraints.job_title ? `${constraints.job_title}${constraints.location ? ` · ${constraints.location.split(',')[0]}` : ''}` : 'Untitled role · agent';
  if (!sessionId) {
    const job = await createSession(userId, {
      raw_jd_text: rawJd,
      structured_jd: {
        job_title: constraints.job_title || null,
        role_type: constraints.role_type,
        seniority: constraints.seniority === 'Any' ? null : constraints.seniority,
        years_of_experience: constraints.years_of_experience,
        location: { primary: constraints.location || null, country: null, remote_eligible: constraints.remote_eligible },
        skills: { must_have: constraints.must_have_skills, nice_to_have: constraints.nice_to_have_skills },
        domain: constraints.domain,
        education: null,
        responsibilities_summary: rawJd.split(/\s+/).slice(0, 60).join(' '),
        confidence_scores: { seniority: constraints.seniority === 'Any' ? 0 : 0.8, skills_must_have: constraints.must_have_skills.length ? 0.8 : 0.2 },
        extraction_warnings: [],
      },
      merged_constraints: constraints,
      query_bundle: queries,
      keyword_map: { primary_title_variants: constraints.job_title ? [constraints.job_title] : [], skill_synonyms: {}, domain_keywords: constraints.domain, seniority_signals: [], negative_keywords: [] },
      title,
    });
    sessionId = job.id;
  } else {
    await updateSession(sessionId, { merged_constraints: constraints, ...(queries.length ? { query_bundle: queries } : {}), title });
    if (jdText) await prisma.job.update({ where: { id: sessionId }, data: { rawJdText: jdText } });
  }
  await prisma.job.update({ where: { id: sessionId }, data: { agentTranscript: JSON.parse(JSON.stringify(nextTranscript)) } });

  return { sessionId, message: assistant, constraints, missing, ready, queries, transcript: nextTranscript };
}
