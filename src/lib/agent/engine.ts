import { prisma } from '../db/client';
import { createSession, getSession, updateSession } from '../db/sessions';
import { callDeepSeekAPI, generateQueriesWithDeepSeek, heuristicParseJD, looksLikeJobDescription, sanitizeSelectedPlatforms, defaultPlatformsForRole } from '../ai/client';
import { AGENT_SYSTEM_PROMPT } from '../ai/prompts';
import { parseLocation } from '../search/location';
import { isSoftSkill } from '../search/xrayTemplates';
import { platformLabel } from '../search/platforms';
import { missingFields, uncoveredScope, buildScope, decidePhase, GUARDRAIL, EMPTY_STATE } from './scope';
import type { MergedConstraints, XRayQuery } from '../types';
import type { AgentField, AgentMessage, AgentModelOutput, AgentPhase, AgentQuestion, AgentState, AgentTurnResponse, ScopeItem } from './types';

// ---------------------------------------------------------------------------
// Agent engine — one conversational turn.
//
// The governing rule, enforced here in code rather than left to the model:
//
//   "Searches are expensive. I shall not initiate query creation until I have
//    the full scope of the recruitment."
//
// Every SerpAPI page is a credit, so the engine walks four phases and only
// builds queries in the last one:
//   gathering  → a required field is missing (title, location/remote, a hard
//                skill or domain)
//   scoping    → required fields present; extended scope (seniority, years,
//                nice-to-haves, domain, exclusions, platforms) not yet covered
//   confirming → everything covered; the agent summarises and asks for a
//                go-ahead
//   ready      → the recruiter explicitly confirmed; queries are generated
//
// The model supplies extraction, wording and its own read of the phase; the
// engine merges, decides the phase, and can only move a model's read
// backwards, never forwards.
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
  target_organizations: [],
  excluded_organizations: [],
  organization_scope: 'any',
  results_cap: 50,
};



const uniq = (xs: string[]) => Array.from(new Map(xs.map((x) => [x.trim().toLowerCase(), x.trim()])).values()).filter(Boolean);

const CONFIRM_RE = /^\s*(yes|yep|yeah|ok(ay)?|sure|go ahead|proceed|build( the queries| it| them)?|do it|looks good|lgtm|confirm(ed)?|start( the search)?|run it|let'?s go)\b[.!\s]*$/i;
const DECLINE_RE = /^\s*(none|no|nothing( else| more)?|n\/a|skip|not (applicable|needed)|any|doesn'?t matter|no preference|default(s)?( are fine)?|that'?s all|nope)\b[.!\s]*$/i;

// --- merging ------------------------------------------------------------------

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
  if (next.target_organizations?.length) out.target_organizations = uniq([...(prev.target_organizations ?? []), ...next.target_organizations]).slice(0, 8);
  if (next.excluded_organizations?.length) {
    out.excluded_organizations = uniq([...(prev.excluded_organizations ?? []), ...next.excluded_organizations]).slice(0, 6);
    out.target_organizations = (out.target_organizations ?? []).filter((o) => !out.excluded_organizations!.some((x) => x.toLowerCase() === o.toLowerCase()));
  }
  if (next.organization_scope === 'current' || next.organization_scope === 'any') out.organization_scope = next.organization_scope;
  if (next.selected_platforms?.length) out.selected_platforms = sanitizeSelectedPlatforms(next.selected_platforms, out.role_type);
  if (typeof next.additional_details === 'string' && next.additional_details.trim()) {
    out.additional_details = uniq([...(prev.additional_details ?? '').split('\n'), next.additional_details.trim()]).join('\n');
  }
  if (out.selected_platforms.length === 0) out.selected_platforms = defaultPlatformsForRole(out.role_type);
  return out;
}

// Scope logic lives in ./scope so the chat panel can rebuild it client-side.

// --- questions --------------------------------------------------------------------

const QUESTION_CATALOGUE: Record<AgentField, AgentQuestion> = {
  job_title: { id: 'q-title', field: 'job_title', text: 'What is the exact job title you are hiring for?' },
  location: { id: 'q-location', field: 'location', text: 'Which city should candidates be in — or is the role remote?', options: ['Remote'] },
  must_have_skills: { id: 'q-skills', field: 'must_have_skills', text: 'Which one to three hard skills or tools are non-negotiable? If none, name the industry or domain instead.' },
  seniority: { id: 'q-seniority', field: 'seniority', text: 'How senior is the role?', options: ['Junior', 'Mid', 'Senior', 'Staff', 'Lead', 'Any'] },
  years_of_experience: { id: 'q-years', field: 'years_of_experience', text: 'How many years of experience should they have?', options: ['0–2', '2–5', '5–8', '8+', 'Any'] },
  domain: { id: 'q-domain', field: 'domain', text: 'Which industry or domain should candidates come from?', options: ['None in particular'] },
  organizations: {
    id: 'q-orgs',
    field: 'organizations',
    text: 'Should candidates come from specific companies or institutions — and does that mean their current employer, or anywhere in their history? Any to exclude, such as clients or competitors?',
    options: ['No preference'],
  },
  additional_details: { id: 'q-details', field: 'additional_details', text: 'Anything that must appear on a profile, or must not — exact phrases, companies to avoid, profile types to exclude (agencies, freelancers, students)?', options: ['None'] },
  selected_platforms: { id: 'q-platforms', field: 'selected_platforms', text: 'I plan to search these platforms. Keep them, or name the ones you want?', options: ['Keep them'] },
};

function questionFor(field: AgentField, c: MergedConstraints): AgentQuestion {
  const q = QUESTION_CATALOGUE[field];
  if (field === 'selected_platforms') return { ...q, text: `I plan to search ${c.selected_platforms.map(platformLabel).join(', ')}. Keep them, or name the ones you want?` };
  return q;
}

function scopeSummary(c: MergedConstraints): string {
  const bits = [
    `${c.seniority !== 'Any' ? `${c.seniority} ` : ''}${c.job_title}`,
    c.location ? `in ${c.location}${c.remote_eligible ? ' (remote OK)' : ''}` : c.remote_eligible ? 'remote' : '',
    c.must_have_skills.length ? `must have ${c.must_have_skills.join(', ')}` : '',
    c.domain.length ? `in ${c.domain.join(' / ')}` : '',
    c.target_organizations?.length ? `${c.organization_scope === 'current' ? 'currently at' : 'from'} ${c.target_organizations.join(', ')}` : '',
    c.excluded_organizations?.length ? `excluding ${c.excluded_organizations.join(', ')}` : '',
    !(c.years_of_experience.min === 0 && c.years_of_experience.max === 10) ? `${c.years_of_experience.min}–${c.years_of_experience.max} years` : '',
    c.additional_details?.trim() ? `with: ${c.additional_details.trim().replace(/\n/g, '; ')}` : 'no extra exclusions',
    `across ${c.selected_platforms.map(platformLabel).join(', ')}`,
  ].filter(Boolean);
  return `Here is the full scope: ${bits.join(' · ')}. Each query costs search credits, so I have not built anything yet — shall I build the queries now?`;
}

// --- interpreting a reply against what was asked -----------------------------------

/** Years band options → numbers. */
function parseYears(text: string): { min: number; max: number } | null {
  const m = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})/);
  if (m) return { min: +m[1], max: +m[2] };
  const plus = text.match(/(\d{1,2})\s*\+/);
  if (plus) return { min: +plus[1], max: +plus[1] + 5 };
  return null;
}

/**
 * Deterministic reading of a short reply to the last question(s) asked —
 * runs with or without the model so a one-word answer always lands.
 */
function applyReplyToAsked(prev: MergedConstraints, state: AgentState, lastAsked: AgentField[], text: string): { constraints: MergedConstraints; covered: AgentField[]; declined: boolean } {
  const c = { ...prev };
  const covered: AgentField[] = [];
  const t = text.trim();
  const declined = DECLINE_RE.test(t);
  for (const f of lastAsked) {
    covered.push(f);
    if (declined) continue;
    if (f === 'seniority') {
      const m = t.match(/\b(junior|mid|senior|staff|lead|principal|executive|director|any)\b/i);
      if (m) {
        const v = m[1].toLowerCase();
        c.seniority = v === 'principal' ? 'Staff' : v === 'director' ? 'Executive' : ((v[0].toUpperCase() + v.slice(1)) as MergedConstraints['seniority']);
      }
    } else if (f === 'years_of_experience') {
      const y = parseYears(t);
      if (y) c.years_of_experience = y;
    } else if (f === 'location') {
      const p = parseLocation(t);
      if (p.display) c.location = p.display;
      if (p.remote) c.remote_eligible = true;
    } else if (f === 'job_title' && t.split(/\s+/).length <= 8) {
      c.job_title = t;
    } else if (f === 'must_have_skills' && t.split(/\s+/).length <= 14) {
      c.must_have_skills = uniq([...c.must_have_skills, ...t.split(/[,/]|\band\b/).map((x) => x.trim()).filter((x) => x && !isSoftSkill(x))]);
    } else if (f === 'domain' && t.split(/\s+/).length <= 10) {
      c.domain = uniq([...c.domain, ...t.split(/[,/]|\band\b/).map((x) => x.trim()).filter(Boolean)]).slice(0, 6);
    } else if (f === 'organizations' && t.split(/\s+/).length <= 24) {
      // "Google, Meta or Amazon — current only; not Infosys" → targets, scope, exclusions.
      const [positive, ...negatives] = t.split(/\b(?:not|no|exclude|excluding|avoid|except|but not)\b/i);
      const names = (chunk: string) =>
        chunk
          .replace(/\b(currently|current(ly)? (at|employed)|working at|employed at|worked at|ex-?|alumni of|from|at|only|people|candidates|anyone)\b/gi, ' ')
          .split(/[,/;]|\bor\b|\band\b/i)
          .map((x) => x.replace(/[—–-]+$/g, '').trim())
          .filter((x) => x && x.length <= 40 && !/^(none|any|no preference)$/i.test(x));
      const targets = names(positive);
      const excluded = negatives.flatMap(names);
      if (targets.length) c.target_organizations = uniq([...(c.target_organizations ?? []), ...targets]).slice(0, 8);
      if (excluded.length) c.excluded_organizations = uniq([...(c.excluded_organizations ?? []), ...excluded]).slice(0, 6);
      if (/\b(current(ly)?|working at|employed)\b/i.test(positive)) c.organization_scope = 'current';
      else if (/\b(ex-?|worked at|alumni|past|history|any(where)?)\b/i.test(positive)) c.organization_scope = 'any';
    } else if (f === 'additional_details') {
      c.additional_details = uniq([...(c.additional_details ?? '').split('\n'), t]).join('\n');
    } else if (f === 'selected_platforms') {
      const named = sanitizeSelectedPlatforms(t.split(/[,/]|\band\b/).map((x) => x.trim()), c.role_type);
      if (!/keep/i.test(t) && named.length) c.selected_platforms = named;
    }
  }
  return { constraints: c, covered, declined };
}

// --- keyless fallback -----------------------------------------------------------------

function heuristicTurn(prev: MergedConstraints, userText: string, jdText: string | null | undefined): AgentModelOutput['constraints'] {
  const source = [jdText ?? '', userText].filter(Boolean).join('\n\n');
  if (!source.trim()) return {};
  const padded = source.split(/\s+/).length < 25 ? `${source}\n\nrole requirements skills experience` : source;
  const c = heuristicParseJD(padded).merged_constraints;
  return {
    ...(c.job_title ? { job_title: c.job_title } : {}),
    role_type: c.role_type,
    ...(c.seniority !== 'Any' ? { seniority: c.seniority } : {}),
    ...(c.location ? { location: c.location } : {}),
    ...(c.remote_eligible ? { remote_eligible: true } : {}),
    ...(c.must_have_skills.length ? { must_have_skills: c.must_have_skills } : {}),
    ...(c.nice_to_have_skills.length ? { nice_to_have_skills: c.nice_to_have_skills } : {}),
    ...(c.domain.length ? { domain: c.domain } : {}),
  };
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
  const phase = ['gathering', 'scoping', 'confirming', 'ready'].includes(raw.phase) ? (raw.phase as AgentPhase) : undefined;
  return {
    thoughts: strs(raw.thoughts, 7),
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
    phase,
    confirms_build: raw.confirms_build === true,
    ready: Boolean(raw.ready),
  };
}

// --- the turn -------------------------------------------------------------------------

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResponse> {
  const { userId, text, jdText, onStage } = input;
  const apiKey = input.deepseekKey || process.env.DEEPSEEK_API_KEY || null;

  // --- load or start ---------------------------------------------------------------
  let sessionId = input.sessionId;
  let prev: MergedConstraints = EMPTY;
  let state: AgentState = { ...EMPTY_STATE };
  let transcript: AgentMessage[] = [];
  let rawJd = '';
  if (sessionId) {
    const detail = await getSession(sessionId);
    if (!detail) throw new Error('Session not found.');
    prev = { ...EMPTY, ...detail.job.merged_constraints };
    transcript = (detail.agent_transcript ?? []) as AgentMessage[];
    state = { ...EMPTY_STATE, ...((detail.agent_state as Partial<AgentState> | null) ?? {}) };
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

  // What did we ask last time? A reply to it counts as covering that field.
  const lastAssistant = [...transcript].reverse().find((m) => m.role === 'assistant');
  const lastAsked = (lastAssistant?.questions ?? []).map((q) => q.field);
  const wasConfirming = lastAssistant?.phase === 'confirming';

  // --- deterministic read of the reply, then the model ------------------------------
  const replied = applyReplyToAsked(prev, state, lastAsked, userMessage.content);
  let constraints = replied.constraints;
  const covered = new Set<AgentField>([...state.coveredFields, ...replied.covered]);

  onStage?.('extract', apiKey ? 'Extracting constraints with DeepSeek…' : 'Extracting constraints…');
  let out: AgentModelOutput | null = null;
  if (apiKey) {
    const convo = transcript
      .slice(-12)
      .map((m) => `${m.role === 'user' ? 'Recruiter' : 'Agent'}: ${m.content}`)
      .join('\n');
    const prompt =
      `<CURRENT_CONSTRAINTS>\n${JSON.stringify(constraints)}\n</CURRENT_CONSTRAINTS>\n` +
      `<STATE>\n${JSON.stringify({ askedFields: state.askedFields, coveredFields: Array.from(covered), confirmed: state.confirmed, lastPhase: state.phase, lastAsked, wasConfirming })}\n</STATE>\n` +
      `<CONVERSATION>\n${convo || '(start)'}\n</CONVERSATION>\n<USER_MESSAGE>\n${userMessage.content}\n</USER_MESSAGE>\n` +
      (jdText ? `<JD_TEXT>\n${jdText.slice(0, 7000)}\n</JD_TEXT>\n` : '') +
      `<PLATFORMS>LinkedIn, GitHub, StackOverflow, Wellfound, Behance, Dribbble, Xing, Resumes, MultiSite</PLATFORMS>`;
    out = coerceModelOutput(await callDeepSeekAPI<any>(prompt, AGENT_SYSTEM_PROMPT, apiKey, { timeoutMs: 75_000, retries: 1 }));
  }
  const extracted = out?.constraints ?? heuristicTurn(prev, userMessage.content, jdText);
  constraints = mergeConstraints(constraints, extracted);

  // --- consent: explicit only ---------------------------------------------------------
  onStage?.('reason', 'Checking the scope against the search-budget guardrail…');
  const userConfirms = CONFIRM_RE.test(userMessage.content) || /^build the queries$/i.test(userMessage.content.trim()) || (out?.confirms_build === true && CONFIRM_RE.test(userMessage.content.split(/[.!?]/)[0] ?? ''));
  let confirmed = state.confirmed;
  if (wasConfirming && userConfirms) confirmed = true;
  // New information after a confirmation request re-opens the scope: the recruiter changed something.
  if (wasConfirming && !userConfirms && Object.keys(extracted).filter((k) => k !== 'role_type').length > 0) confirmed = false;

  const nextState: AgentState = {
    askedFields: uniq([...state.askedFields, ...lastAsked]) as AgentField[],
    coveredFields: Array.from(covered),
    confirmed,
    phase: 'gathering',
  };
  const phase = decidePhase(constraints, nextState);
  nextState.phase = phase;
  const ready = phase === 'ready';

  // --- what to ask / say ----------------------------------------------------------------
  let questions: AgentQuestion[] = [];
  let reply = '';
  if (phase === 'gathering') {
    const fields = missingFields(constraints).slice(0, 2);
    const modelQs = (out?.questions ?? []).filter((q) => fields.includes(q.field));
    questions = modelQs.length ? modelQs : fields.map((f) => questionFor(f, constraints));
    reply = out?.reply && out.phase !== 'ready' ? out.reply : questions.length === 1 ? questions[0].text : 'Two things before anything else:';
  } else if (phase === 'scoping') {
    const fields = uncoveredScope(constraints, nextState).slice(0, 2);
    const modelQs = (out?.questions ?? []).filter((q) => fields.includes(q.field));
    questions = modelQs.length ? modelQs : fields.map((f) => questionFor(f, constraints));
    reply = out?.reply && (out.phase === 'scoping' || out.phase === 'gathering') ? out.reply : `Required details are in. Before I spend credits on a search, a bit more scope:`;
  } else if (phase === 'confirming') {
    questions = [{ id: 'q-confirm', field: 'additional_details', text: 'Shall I build the queries now?', options: ['Build the queries', 'Change something'] }];
    reply = scopeSummary(constraints);
  }

  // --- build only when ready -------------------------------------------------------------
  let queries: XRayQuery[] = [];
  if (ready) {
    onStage?.('queries', 'Scope confirmed — filling the approved X-Ray templates…');
    queries = await generateQueriesWithDeepSeek(constraints, apiKey ?? undefined);
    reply = `Scope confirmed. ${queries.length} queries are ready to review across ${constraints.selected_platforms.map(platformLabel).join(', ')}. Nothing has been searched yet — review them, then run.`;
  }

  // --- reasoning trace: guardrail first, always ---------------------------------------------
  const missing = missingFields(constraints);
  const uncovered = uncoveredScope(constraints, nextState);
  const thoughts: string[] = [
    `Search budget: ${GUARDRAIL} Phase is "${phase}".`,
    jdText ? `Read the attached job description (${jdText.split(/\s+/).length} words).` : `Read the recruiter's message${lastAsked.length ? ` as an answer about ${lastAsked.map((f) => f.replace(/_/g, ' ')).join(' and ')}` : ''}.`,
    ...(out?.thoughts ?? []).filter((t) => !/^search budget/i.test(t)).slice(0, 3),
    missing.length
      ? `Still missing required scope: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')} — cannot search without it.`
      : uncovered.length
        ? `Required scope is complete; still to cover: ${uncovered.map((m) => m.replace(/_/g, ' ')).join(', ')}.`
        : confirmed
          ? 'Full scope gathered and the recruiter has confirmed — building queries now.'
          : 'Full scope gathered; summarising it and asking for a go-ahead before spending any credits.',
    questions.length && phase !== 'confirming' ? `Asking about ${questions.map((q) => q.field.replace(/_/g, ' ')).join(' and ')}.` : '',
  ].filter(Boolean);

  const assistant: AgentMessage = { id: mid(), role: 'assistant', content: reply, at: now(), thoughts, questions, constraints, ready, phase };
  const nextTranscript = [...transcript, userMessage, assistant];

  // --- persist ----------------------------------------------------------------------------
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
  await prisma.job.update({ where: { id: sessionId }, data: { agentTranscript: JSON.parse(JSON.stringify({ messages: nextTranscript, state: nextState })) } });

  return { sessionId, message: assistant, constraints, missing, scope: buildScope(constraints, nextState), phase, ready, queries, transcript: nextTranscript, state: nextState };
}
