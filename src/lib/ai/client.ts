import {
  StructuredJD,
  MergedConstraints,
  XRayQuery,
  KeywordMap,
  CandidatePlatform,
  RoleType,
  SeniorityLevel,
} from '../types';

import {
  JD_STRUCTURING_SYSTEM_PROMPT,
  XRAY_QUERY_TERMS_SYSTEM_PROMPT,
  KEYWORD_MAP_SYSTEM_PROMPT,
} from './prompts';
import { buildQueryBundle, deriveQueryTerms, mergeQueryTerms, QueryTerms } from '../search/xrayTemplates';
import { normalizePlatform } from '../search/platforms';
import { parseLocation, detectCityInText, cityDisplay } from '../search/location';
import { isSoftSkill } from '../search/xrayTemplates';

// Helper function to safely parse JSON from AI response
function tryParseJSON<T>(text: string): T | null {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch (e) {
    return null;
  }
}

/**
 * DeepSeek AI API Call Handler
 */
export async function callDeepSeekAPI<T>(
  userPrompt: string,
  systemPrompt: string,
  apiKey: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const retries = options.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        // A hung model call used to hold the route open until the platform
        // killed it, which surfaced to recruiters as an opaque timeout.
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('DeepSeek API Error:', res.status, errText);
        if (res.status >= 500 && attempt < retries) continue;
        return null;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || '';
      return tryParseJSON<T>(content);
    } catch (err: any) {
      const timedOut = /timeout|aborted/i.test(String(err?.name || err?.message));
      console.error(`DeepSeek API exception${timedOut ? ' (timeout)' : ''}:`, err?.message || err);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Restricts a platform list to the approved registry (coercing loose
 * spellings) and applies the role-type default when nothing valid is left.
 */
export function sanitizeSelectedPlatforms(
  platforms: unknown,
  roleType: RoleType = 'Engineering'
): CandidatePlatform[] {
  const list = Array.isArray(platforms) ? platforms : [];
  const valid = list.map(normalizePlatform).filter((p): p is CandidatePlatform => p !== null);
  const unique = Array.from(new Set(valid));
  return unique.length > 0 ? unique : defaultPlatformsForRole(roleType);
}

export function defaultPlatformsForRole(roleType: RoleType): CandidatePlatform[] {
  if (roleType === 'Engineering') return ['LinkedIn', 'GitHub', 'StackOverflow', 'Wellfound', 'MultiSite'];
  if (roleType === 'Design') return ['LinkedIn', 'Behance', 'Dribbble', 'Wellfound', 'Resumes'];
  return ['LinkedIn', 'Wellfound', 'Xing', 'Resumes'];
}

/**
 * Generates the X-Ray bundle. DeepSeek supplies the sourcing vocabulary
 * (title synonyms, skill spellings, adjacent terms, ...); the approved
 * templates in src/lib/search/xrayTemplates.ts decide the query shapes. The
 * model therefore cannot introduce a platform or query type outside the list,
 * and with no API key the grounded heuristic vocabulary is used instead.
 */
export async function generateQueriesWithDeepSeek(
  constraints: MergedConstraints,
  customApiKey?: string
): Promise<XRayQuery[]> {
  const apiKey = customApiKey || process.env.DEEPSEEK_API_KEY;
  const platforms = sanitizeSelectedPlatforms(constraints.selected_platforms, constraints.role_type);
  const baseTerms = deriveQueryTerms(constraints);

  if (!apiKey) {
    return buildQueryBundle(baseTerms, platforms);
  }

  console.log('Generating DeepSeek X-Ray vocabulary for:', constraints.job_title);

  const userPrompt = `<USER_CONSTRAINTS>
Job Title: ${constraints.job_title}
Role Type: ${constraints.role_type}
Seniority: ${constraints.seniority}
Experience Range: ${constraints.years_of_experience?.min ?? 0} to ${constraints.years_of_experience?.max ?? 10} years
Location: ${constraints.location || 'Not specified'} (Remote Eligible: ${constraints.remote_eligible})
Must-Have Skills (searchable): ${baseTerms.must_have_skills.length ? baseTerms.must_have_skills.join(', ') : 'None — use domain_terms to anchor the queries'}
Soft skills from the JD (NOT search terms): ${(constraints.must_have_skills ?? []).filter((sk) => !baseTerms.must_have_skills.includes(sk)).join(', ') || 'none'}
Nice-To-Have Skills: ${constraints.nice_to_have_skills?.length ? constraints.nice_to_have_skills.join(', ') : 'None'}
Domain: ${constraints.domain?.length ? constraints.domain.join(', ') : 'Not specified'}
Selected Platforms: ${platforms.join(', ')}
</USER_CONSTRAINTS>

<ADDITIONAL_DETAILS priority="highest">
${(constraints.additional_details ?? constraints.soft_constraints ?? '').trim() || '(none provided)'}
</ADDITIONAL_DETAILS>`;

  const aiTerms = await callDeepSeekAPI<Partial<QueryTerms>>(userPrompt, XRAY_QUERY_TERMS_SYSTEM_PROMPT, apiKey);
  const terms = mergeQueryTerms(baseTerms, aiTerms);
  return buildQueryBundle(terms, platforms);
}

/**
 * Deterministic bundle from the confirmed constraints alone — used client-side
 * as the instant fallback when the AI route fails, and by the demo job.
 */
export function generateQueryBundleForConstraints(constraints: MergedConstraints): XRayQuery[] {
  const platforms = sanitizeSelectedPlatforms(constraints.selected_platforms, constraints.role_type);
  return buildQueryBundle(deriveQueryTerms(constraints), platforms);
}

/**
 * Main JD Parse Controller
 */
/** Progress hook for the streaming /api/parse-jd route. */
export type ParseStageKey = 'structure' | 'queries' | 'keywords';
export type ParseStageHook = (key: ParseStageKey, label: string) => void;

const ROLE_TYPES: RoleType[] = ['Engineering', 'Design', 'Marketing', 'Sales', 'Operations', 'Other'];
const SENIORITIES: SeniorityLevel[] = ['Junior', 'Mid', 'Senior', 'Staff', 'Lead', 'Executive'];

/** Typical experience bands, used only when the JD gives no range. */
const YEARS_BY_SENIORITY: Record<SeniorityLevel | 'Any', { min: number; max: number }> = {
  Junior: { min: 0, max: 2 },
  Mid: { min: 2, max: 5 },
  Senior: { min: 5, max: 8 },
  Staff: { min: 8, max: 12 },
  Lead: { min: 8, max: 15 },
  Executive: { min: 10, max: 20 },
  Any: { min: 0, max: 10 },
};

const strList = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : [];
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 60 ? Math.round(v) : null);

/**
 * Does this text plausibly describe a job? Guards against a pasted email, a
 * résumé, or a stray paragraph being parsed into a confident-looking session.
 */
export function looksLikeJobDescription(text: string): { ok: boolean; reason?: string } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 25) return { ok: false, reason: `Only ${words} words — a job description needs more than a line or two.` };
  const signals = /\b(responsibilit|requirement|qualification|experience|skills?|role|position|hiring|we are looking|you will|candidate|job|about the team|what you|must have|nice to have)\b/i;
  if (!signals.test(text)) return { ok: false, reason: 'No role, responsibilities or requirements language found.' };
  if (/\b(curriculum vitae|résumé|resume)\b/i.test(text.slice(0, 300)) && /\b(objective|work experience|education)\b/i.test(text)) {
    return { ok: false, reason: 'This reads like a résumé, not a job description.' };
  }
  return { ok: true };
}

/**
 * Coerces whatever the model returned into a well-typed StructuredJD. Every
 * field is validated individually so one bad value (a seniority outside the
 * enum, a string where a number was expected) degrades to null rather than
 * discarding the whole parse.
 */
export function coerceStructuredJD(raw: any): StructuredJD | null {
  if (!raw || typeof raw !== 'object') return null;
  const warnings = strList(raw.extraction_warnings, 10);
  if (warnings.some((w) => /INPUT_NOT_JD/i.test(w))) return { ...emptyStructuredJD(), extraction_warnings: ['INPUT_NOT_JD'] };
  const roleType = ROLE_TYPES.includes(raw.role_type) ? (raw.role_type as RoleType) : null;
  const seniority = SENIORITIES.includes(raw.seniority) ? (raw.seniority as SeniorityLevel) : null;
  return {
    job_title: typeof raw.job_title === 'string' && raw.job_title.trim() ? raw.job_title.trim().slice(0, 80) : null,
    role_type: roleType,
    seniority,
    years_of_experience: { min: numOrNull(raw.years_of_experience?.min), max: numOrNull(raw.years_of_experience?.max) },
    location: {
      primary: typeof raw.location?.primary === 'string' && raw.location.primary.trim() ? raw.location.primary.trim() : null,
      country: typeof raw.location?.country === 'string' && raw.location.country.trim() ? raw.location.country.trim() : null,
      remote_eligible: Boolean(raw.location?.remote_eligible),
    },
    skills: { must_have: strList(raw.skills?.must_have), nice_to_have: strList(raw.skills?.nice_to_have) },
    domain: strList(raw.domain, 8),
    education: typeof raw.education === 'string' && raw.education.trim() ? raw.education.trim() : null,
    responsibilities_summary: typeof raw.responsibilities_summary === 'string' ? raw.responsibilities_summary.trim().slice(0, 1200) : '',
    confidence_scores: {
      seniority: typeof raw.confidence_scores?.seniority === 'number' ? Math.min(1, Math.max(0, raw.confidence_scores.seniority)) : seniority ? 0.7 : 0,
      skills_must_have: typeof raw.confidence_scores?.skills_must_have === 'number' ? Math.min(1, Math.max(0, raw.confidence_scores.skills_must_have)) : 0.7,
    },
    extraction_warnings: warnings,
  };
}

function emptyStructuredJD(): StructuredJD {
  return {
    job_title: null,
    role_type: null,
    seniority: null,
    years_of_experience: { min: null, max: null },
    location: { primary: null, country: null, remote_eligible: false },
    skills: { must_have: [], nice_to_have: [] },
    domain: [],
    education: null,
    responsibilities_summary: '',
    confidence_scores: { seniority: 0, skills_must_have: 0 },
    extraction_warnings: [],
  };
}

/**
 * Turns a structured JD (from the model, the heuristic, or a merge of both)
 * into search constraints without inventing anything. Location is normalised
 * through the location table ("Kolkata" → "Kolkata, India"), seniority stays
 * "Any" when unstated, years fall back to the seniority band, and the
 * recruiter is told plainly when there is nothing hard to search on.
 */
export function constraintsFromStructuredJD(structured: StructuredJD, jdText: string): MergedConstraints {
  const roleType = structured.role_type ?? 'Other';
  const seniority: MergedConstraints['seniority'] = structured.seniority ?? 'Any';

  const rawLoc = [structured.location.primary, structured.location.country].filter(Boolean).join(', ');
  let parsed = parseLocation(rawLoc);
  if (!parsed.display) {
    const city = detectCityInText(jdText);
    if (city) parsed = parseLocation(cityDisplay(city));
  }
  const remote = structured.location.remote_eligible || parsed.remote || /\b(remote|work from home|wfh|hybrid|distributed)\b/i.test(jdText);

  const band = YEARS_BY_SENIORITY[seniority];
  const min = structured.years_of_experience.min ?? band.min;
  const max = Math.max(min, structured.years_of_experience.max ?? (structured.years_of_experience.min != null ? structured.years_of_experience.min + 3 : band.max));

  const mustHave = structured.skills.must_have;
  const niceToHave = structured.skills.nice_to_have.filter((sk) => !mustHave.some((m) => m.toLowerCase() === sk.toLowerCase()));

  const hardMust = mustHave.filter((sk) => !isSoftSkill(sk));
  const hardNice = niceToHave.filter((sk) => !isSoftSkill(sk));
  if (hardMust.length === 0 && hardNice.length > 0) {
    structured.extraction_warnings.push(
      `No searchable must-have skill was found; queries will anchor on the title and domain. ${hardNice.slice(0, 3).join(', ')} ${hardNice.length === 1 ? 'is' : 'are'} in nice-to-have — promote one to must-have to sharpen the search.`
    );
  }
  if (!parsed.display && !remote) {
    structured.extraction_warnings.push('No location found in the JD. Add a city in the constraints or queries will not be location-anchored.');
  }

  return {
    job_title: structured.job_title ?? '',
    role_type: roleType,
    seniority,
    years_of_experience: { min, max },
    location: parsed.display,
    remote_eligible: remote,
    must_have_skills: mustHave,
    nice_to_have_skills: niceToHave,
    domain: structured.domain,
    education: structured.education ?? '',
    selected_platforms: defaultPlatformsForRole(roleType),
    additional_details: '',
    results_cap: 50,
  };
}

/** Field-by-field: prefer the model's value, fall back to the heuristic's when the model left a gap. */
function mergeStructured(ai: StructuredJD, heuristic: StructuredJD): StructuredJD {
  return {
    job_title: ai.job_title ?? heuristic.job_title,
    role_type: ai.role_type ?? heuristic.role_type,
    seniority: ai.seniority ?? heuristic.seniority,
    years_of_experience: {
      min: ai.years_of_experience.min ?? heuristic.years_of_experience.min,
      max: ai.years_of_experience.max ?? heuristic.years_of_experience.max,
    },
    location: {
      primary: ai.location.primary ?? heuristic.location.primary,
      country: ai.location.country ?? heuristic.location.country ?? null,
      remote_eligible: ai.location.remote_eligible || heuristic.location.remote_eligible,
    },
    skills: {
      must_have: ai.skills.must_have.length ? ai.skills.must_have : heuristic.skills.must_have,
      nice_to_have: ai.skills.nice_to_have.length ? ai.skills.nice_to_have : heuristic.skills.nice_to_have,
    },
    domain: ai.domain.length ? ai.domain : heuristic.domain,
    education: ai.education ?? heuristic.education,
    responsibilities_summary: ai.responsibilities_summary || heuristic.responsibilities_summary,
    confidence_scores: ai.confidence_scores,
    extraction_warnings: Array.from(new Set([...ai.extraction_warnings, ...heuristic.extraction_warnings.filter((w) => /location|skill/i.test(w) && !ai.location.primary)])),
  };
}

export async function parseJDWithAI(
  jdText: string,
  customApiKey?: string,
  onStage?: ParseStageHook
): Promise<{
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
}> {
  const sanity = looksLikeJobDescription(jdText);
  if (!sanity.ok) {
    throw new Error(`This doesn't look like a job description. ${sanity.reason ?? ''}`.trim());
  }

  const apiKey = customApiKey || process.env.DEEPSEEK_API_KEY;
  const heuristic = heuristicParseJD(jdText);

  if (apiKey) {
    onStage?.('structure', 'Structuring the JD with DeepSeek (title, seniority, skills, location)…');
    const raw = await callDeepSeekAPI<any>(`<JD_TEXT>\n${jdText}\n</JD_TEXT>`, JD_STRUCTURING_SYSTEM_PROMPT, apiKey);
    const ai = coerceStructuredJD(raw);

    if (ai?.extraction_warnings.includes('INPUT_NOT_JD')) {
      throw new Error("This doesn't look like a job description — the parser found no role, requirements or responsibilities.");
    }

    if (ai && ai.job_title) {
      const structured = mergeStructured(ai, heuristic.structured_jd);
      const merged_constraints = constraintsFromStructuredJD(structured, jdText);

      onStage?.('queries', 'Asking DeepSeek for sourcing vocabulary and filling the approved X-Ray templates…');
      const query_bundle = await generateQueriesWithDeepSeek(merged_constraints, apiKey);

      onStage?.('keywords', 'Building the keyword map (title variants, synonyms, negatives)…');
      const keywordResult = await callDeepSeekAPI<KeywordMap>(`<STRUCTURED_JD>\n${JSON.stringify(structured)}\n</STRUCTURED_JD>`, KEYWORD_MAP_SYSTEM_PROMPT, apiKey);

      return { structured_jd: structured, merged_constraints, query_bundle, keyword_map: keywordResult ?? heuristic.keyword_map };
    }
    onStage?.('structure', 'DeepSeek returned nothing usable — falling back to the heuristic parser…');
  } else {
    onStage?.('structure', 'No DeepSeek key — parsing with the heuristic extractor…');
  }

  onStage?.('queries', 'Filling the approved X-Ray templates from the extracted constraints…');
  onStage?.('keywords', 'Building the keyword map…');
  return heuristic;
}

/**
 * Deterministic fallback parser. It only ever reports what it can find in the
 * text: no default city, no default skills, no default seniority. Gaps become
 * warnings the recruiter (or the agent) can fill.
 */
const KNOWN_HARD_SKILLS = [
  // engineering
  'React', 'React Native', 'Next.js', 'Vue', 'Angular', 'TypeScript', 'JavaScript', 'Node.js', 'Python', 'Django', 'Flask', 'FastAPI', 'Go', 'Java',
  'Spring Boot', 'Kotlin', 'Swift', 'C++', 'C#', '.NET', 'Ruby on Rails', 'PHP', 'Laravel', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'GraphQL',
  'REST', 'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Microservices', 'System Design', 'Machine Learning', 'Deep Learning',
  'PyTorch', 'TensorFlow', 'LLM', 'LangChain', 'Prompt Engineering', 'Generative AI', 'SQL', 'Spark', 'Airflow', 'dbt', 'Snowflake',
  // design
  'Figma', 'Sketch', 'Adobe XD', 'Framer', 'Lottie', 'Design Systems', 'User Research', 'Prototyping', 'Wireframing', 'Usability Testing', 'Illustrator', 'Photoshop', 'After Effects',
  // sales / marketing / ops
  'Salesforce', 'HubSpot', 'Zoho', 'Pipedrive', 'CRM', 'Lead Generation', 'Cold Calling', 'Telecalling', 'Inside Sales', 'B2B Sales', 'Account Management',
  'Excel', 'Google Sheets', 'Power BI', 'Tableau', 'Looker', 'Google Analytics', 'SEO', 'SEM', 'Google Ads', 'Meta Ads', 'Performance Marketing',
  'Content Marketing', 'Email Marketing', 'Copywriting', 'Canva', 'Notion', 'Jira', 'Asana', 'Zendesk', 'Freshdesk',
];

const TITLE_LINE_RE = /(?:job\s*title|title|role|position|designation|opening)\s*[:\-–]\s*([^\n\r]{3,80})/i;
const HIRING_RE = /(?:hiring|looking for|seeking|searching for|recruiting)\s+(?:an?\s+|for\s+(?:an?\s+)?)?([A-Z][A-Za-z/&.\- ]{3,60}?)(?=\s+(?:to|who|with|at|in|for|based|,|\.|\n))/;

export function heuristicParseJD(jdText: string): {
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
} {
  const text = jdText.toLowerCase();
  const warnings: string[] = [];

  // --- title ---------------------------------------------------------------
  let title: string | null = null;
  const labelled = jdText.match(TITLE_LINE_RE);
  if (labelled) title = labelled[1].trim();
  if (!title) {
    const hiring = jdText.match(HIRING_RE);
    if (hiring) title = hiring[1].trim();
  }
  if (!title) {
    const firstLine = jdText.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length >= 4 && l.length <= 70 && l.split(/\s+/).length <= 8 && /[A-Za-z]/.test(l));
    if (firstLine && /\b(engineer|developer|designer|manager|consultant|analyst|associate|executive|lead|head|specialist|architect|scientist|marketer|recruiter|representative|intern)\b/i.test(firstLine)) {
      title = firstLine.replace(/[|:–-].*$/, '').trim();
    }
  }
  if (!title) warnings.push('Could not find a job title in the text. Enter it in the constraints.');

  // --- role type -----------------------------------------------------------
  let role_type: RoleType = 'Other';
  if (/\b(sales|business development|account executive|\bbdr\b|\bsdr\b|revenue|telecall|inside sales|lead generation)\b/i.test(text)) role_type = 'Sales';
  else if (/\b(marketing|seo|growth|campaign|social media|content|brand)\b/i.test(text)) role_type = 'Marketing';
  else if (/\b(figma|ux|ui design|product design|design system|sketch|framer|dribbble|behance)\b/i.test(text)) role_type = 'Design';
  else if (/\b(engineer|developer|software|backend|frontend|full[- ]stack|devops|data scientist|machine learning|api|sql)\b/i.test(text)) role_type = 'Engineering';
  else if (/\b(operations|hr\b|recruiter|people ops|logistics|supply chain|admin)\b/i.test(text)) role_type = 'Operations';

  // --- seniority -----------------------------------------------------------
  let seniority: SeniorityLevel | null = null;
  let seniorityConfidence = 0.85;
  const head = (title ?? '') + ' ' + jdText.slice(0, 400);
  if (/\b(staff|principal)\b/i.test(head)) seniority = 'Staff';
  else if (/\b(senior|sr\.?)\b/i.test(head)) seniority = 'Senior';
  else if (/\b(lead|head of|director)\b/i.test(head)) seniority = 'Lead';
  else if (/\b(junior|jr\.?|associate|entry[- ]level|fresher|trainee)\b/i.test(head)) seniority = 'Junior';
  else if (/\b(vp|vice president|chief|cxo|c-level)\b/i.test(head)) seniority = 'Executive';
  else {
    seniorityConfidence = 0.4;
    warnings.push('No explicit seniority in the title or opening lines; left as "Any".');
  }

  // --- years ---------------------------------------------------------------
  let minExp: number | null = null;
  let maxExp: number | null = null;
  const expMatch = text.match(/(\d{1,2})\s*(?:-|–|to|\+)\s*(\d{1,2})?\s*\+?\s*(?:years|yrs)/i);
  if (expMatch) {
    minExp = parseInt(expMatch[1], 10);
    maxExp = expMatch[2] ? parseInt(expMatch[2], 10) : minExp + 3;
  }

  // --- location ------------------------------------------------------------
  const remoteEligible = /\b(remote|work from home|wfh|hybrid|distributed)\b/i.test(text);
  const city = detectCityInText(jdText);
  const locationPrimary = city ? city.name : null;
  const locationCountry = city ? city.country : null;
  if (!city && !remoteEligible) warnings.push('No location found in the JD.');

  // --- skills --------------------------------------------------------------
  const found = KNOWN_HARD_SKILLS.filter((skill) => new RegExp(`(?<![\\w.+#-])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w+#-])`, 'i').test(jdText));
  // Skills named in a "requirements / must have" block are must-haves; the rest are nice-to-have.
  const reqBlock = jdText.match(/(?:requirements?|must[- ]haves?|qualifications?|what you(?:'ll)? need|you have)[\s\S]{0,1200}/i)?.[0] ?? '';
  const mustHave = found.filter((sk) => reqBlock && new RegExp(`(?<![\\w.+#-])${sk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w+#-])`, 'i').test(reqBlock)).slice(0, 5);
  const niceToHave = found.filter((sk) => !mustHave.includes(sk)).slice(0, 8);
  if (found.length === 0) warnings.push('No recognisable hard skills or tools found; queries will anchor on the title and domain.');

  // --- domain --------------------------------------------------------------
  const domain: string[] = [];
  if (/\b(saas|b2b)\b/i.test(text)) domain.push('SaaS / B2B');
  if (/\b(fintech|banking|payments|lending|insurance)\b/i.test(text)) domain.push('FinTech');
  if (/\b(e-?commerce|retail|marketplace|d2c)\b/i.test(text)) domain.push('E-commerce');
  if (/\b(edtech|education|learning|students?|courses?)\b/i.test(text)) domain.push('EdTech');
  if (/\b(health|medical|pharma|clinic)\b/i.test(text)) domain.push('HealthTech');
  if (/\b(ai|artificial intelligence|machine learning|genai|llm)\b/i.test(text)) domain.push('AI / Machine Learning');
  if (/\b(logistics|supply chain|mobility)\b/i.test(text)) domain.push('Logistics');

  const structured_jd: StructuredJD = {
    job_title: title,
    role_type,
    seniority,
    years_of_experience: { min: minExp, max: maxExp },
    location: { primary: locationPrimary, country: locationCountry, remote_eligible: remoteEligible },
    skills: { must_have: mustHave, nice_to_have: niceToHave },
    domain,
    education: /\b(b\.?tech|b\.?e\.?|bachelor|mba|master'?s|degree|graduate)\b/i.test(text) ? (jdText.match(/[^.\n]*\b(b\.?tech|b\.?e\.?|bachelor|mba|master'?s|degree|graduate)\b[^.\n]*/i)?.[0].trim().slice(0, 120) ?? 'Degree mentioned') : null,
    responsibilities_summary: jdText.trim().split(/\s+/).slice(0, 60).join(' '),
    confidence_scores: { seniority: seniorityConfidence, skills_must_have: found.length ? 0.6 : 0.2 },
    extraction_warnings: warnings,
  };

  const merged_constraints = constraintsFromStructuredJD(structured_jd, jdText);
  const query_bundle = merged_constraints.job_title ? generateQueryBundleForConstraints(merged_constraints) : [];

  const keyword_map: KeywordMap = {
    primary_title_variants: title ? [title, ...(seniority ? [`${seniority} ${title}`] : [])] : [],
    skill_synonyms: {},
    domain_keywords: domain,
    seniority_signals: seniority ? [seniority.toLowerCase()] : [],
    negative_keywords: ['intern', 'fresher', 'trainee', 'recruiter'],
  };

  return { structured_jd, merged_constraints, query_bundle, keyword_map };
}
