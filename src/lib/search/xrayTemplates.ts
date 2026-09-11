import { CandidatePlatform, MergedConstraints, SeniorityLevel, XRayQuery } from '../types';
import { PLATFORM_IDS } from './platforms';
import { parseLocation } from './location';

// ---------------------------------------------------------------------------
// X-Ray query templates.
//
// This module is the only place a query string is ever assembled. Every
// template below corresponds 1:1 to an entry in the approved "X-Ray Query
// Types by Job Board" list — the AI (or the heuristic fallback) supplies the
// *vocabulary* (role synonyms, skills, location, seniority, ...) and the
// template decides the shape. That guarantees the generated bundle can never
// drift outside the approved set, no matter what the model returns.
// ---------------------------------------------------------------------------

/** The vocabulary a template is filled from. Produced by the AI or by deriveQueryTerms(). */
export interface QueryTerms {
  /** 3–6 job-title variants (unquoted). The first should be the JD title itself. */
  role_synonyms: string[];
  /**
   * Must-have skills that are actually searchable on a profile page: tools,
   * languages, frameworks, certifications, domains. Soft skills
   * (communication, leadership, …) are stripped before they get here — AND'ing
   * them into a query returns almost nothing and discriminates nobody.
   */
  must_have_skills: string[];
  /**
   * Domain / industry phrases ("Machine Learning", "FinTech", "B2B SaaS").
   * Stand in for the skills clause when a role has no searchable hard skills
   * (consultants, managers, sales) so queries stay anchored to the field.
   */
  domain_terms: string[];
  /** Genuine industry alternates per skill, e.g. { React: ['ReactJS', 'React.js'] }. */
  skill_synonyms: Record<string, string[]>;
  /** Lower-case role-adjacent words for GitHub bios, e.g. 'frontend', 'machine learning'. */
  role_adjacent_terms: string[];
  /** Discipline phrases for Behance / Dribbble, e.g. 'UI Design', 'Brand Identity'. */
  discipline_terms: string[];
  /** Single seniority word for the AROUND(n) variant; null when the JD is open on seniority. */
  seniority_term: string | null;
  /** City / region spellings (no 'Remote' — that comes from `remote`). */
  location_terms: string[];
  /** Whether 'Remote' should be OR'd into location clauses. */
  remote: boolean;
  /** Country-code TLD for the geo-domain variant, e.g. '.de'. Empty when the location maps to no country — the variant is then skipped. */
  geo_tld: string;
  /**
   * Phrases from the recruiter's additional details that every profile must
   * mention (AND'd, quoted) — e.g. "fintech", "design systems lead". Max 2.
   */
  required_phrases: string[];
  /**
   * Terms from the additional details that disqualify a result, appended as
   * -"term" to every query — e.g. agency, freelance, intern, a competitor name.
   */
  exclude_terms: string[];
  /**
   * Companies / institutions a profile must show at least one of. OR'd into
   * every query right after the site operator; on LinkedIn with org_scope
   * 'current' it becomes intitle:(…) because the page title carries the
   * current employer. Max 6 per query — the word budget is the limit.
   */
  target_orgs: string[];
  /** Companies / institutions whose mention disqualifies a result: -"name" on every query. */
  excluded_orgs: string[];
  /** 'current' — current employer only (LinkedIn title); 'any' — anywhere on the page. */
  org_scope: 'current' | 'any';
}

export interface XRayTemplate {
  id: string;
  platform: CandidatePlatform;
  label: string;
  /** The approved pattern, kept verbatim for display alongside the filled query. */
  pattern: string;
  expected_result_type: XRayQuery['expected_result_type'];
  intent: (t: QueryTerms) => string;
  /** Returns null when the template isn't applicable to these terms (e.g. no seniority). */
  build: (t: QueryTerms) => string | null;
}

// --- Clause helpers ---------------------------------------------------------

const quote = (s: string) => `"${s.replace(/"/g, '').trim()}"`;

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

/** ("a" OR "b") — or just "a" when there's a single term. */
export function orGroup(terms: string[], max = 6): string {
  const list = uniq(terms).slice(0, max);
  if (list.length === 0) return '';
  if (list.length === 1) return quote(list[0]);
  return `(${list.map(quote).join(' OR ')})`;
}

// Soft skills and generic competencies. They are real requirements for the
// recruiter's evaluation, but as X-Ray terms they only shrink recall: every
// profile claims "communication", none is found by it.
const SOFT_SKILLS = new Set(
  [
    'communication', 'communication skills', 'verbal communication', 'written communication', 'presentation', 'presentation skills',
    'presentations', 'facilitation', 'facilitation skills', 'leadership', 'team leadership', 'teamwork', 'collaboration', 'problem solving',
    'problem-solving', 'critical thinking', 'analytical skills', 'analytical thinking', 'stakeholder management', 'time management',
    'organization', 'organisation', 'attention to detail', 'adaptability', 'creativity', 'interpersonal skills', 'negotiation',
    'decision making', 'decision-making', 'mentoring', 'coaching', 'public speaking', 'storytelling', 'ownership', 'self-starter',
    'work ethic', 'multitasking', 'empathy', 'client management', 'relationship management', 'people management', 'strategic thinking',
    'business acumen', 'consulting', 'consulting skills', 'training', 'workshops', 'documentation', 'reporting', 'planning',
    'project management', 'program management', 'agile', 'scrum', 'english', 'fluent english', 'hindi', 'customer service',
  ].map((x) => x.toLowerCase())
);

/** True for competencies that should never be AND'd into a search string. */
export function isSoftSkill(skill: string): boolean {
  const k = skill.trim().toLowerCase().replace(/\s+skills?$/, '');
  return SOFT_SKILLS.has(k) || SOFT_SKILLS.has(`${k} skills`) || /\b(skills?|ability|abilities|mindset|attitude|oriented)\b/.test(k);
}

/**
 * Must-have skills are non-negotiable, so they are AND'd; each skill is OR'd
 * with its synonyms. Capped at 3 skills — Google silently truncates long
 * queries and a 5-way AND on a profile page returns almost nothing.
 */
export function skillsClause(t: QueryTerms, max = 2): string {
  const skills = uniq(t.must_have_skills);
  if (skills.length === 0) return '';

  // A "skill" of three or more words is a descriptor, not a keyword — an LLM
  // produces things like "AI productivity systems". Requiring several of those
  // on one profile page matches nobody, so they become alternatives instead.
  const phrasey = skills.filter((sk) => sk.trim().split(/\s+/).length >= 3);
  if (phrasey.length > 1) {
    return orGroup(skills, 4);
  }

  // Short, concrete skills are genuinely non-negotiable, so they stay AND'd —
  // but two is the ceiling. Three exact terms on one page is where recall dies.
  const groups = skills.slice(0, max).map((skill) => orGroup([skill, ...(t.skill_synonyms?.[skill] ?? [])], 2));
  if (groups.length === 1) return groups[0].startsWith('(') ? groups[0] : `(${groups[0]})`;
  // Space is AND in Google; an explicit AND between groups parses unreliably.
  return groups.join(' ');
}

/** Skills as topics (OR'd) — for pages where any one signal is enough. */
export function skillsAsTopics(t: QueryTerms, max = 4): string {
  const all = uniq(t.must_have_skills).slice(0, max);
  return orGroup(all, max);
}

/**
 * The "what they work on" clause for role-based templates: the AND'd hard
 * skills when there are any, otherwise the domain terms OR'd — so a role with
 * only soft-skill requirements still searches "AI Consultant" + ("Machine
 * Learning" OR "Generative AI") instead of "AI Consultant" + nothing.
 */
export function topicClause(t: QueryTerms): string {
  const skills = skillsClause(t);
  if (skills) return skills;
  return orGroup(t.domain_terms ?? [], 3);
}

/**
 * Location spellings only. "Remote" is deliberately NOT OR'd in even when the
 * role is remote-eligible: on a profile page it matches almost everyone and
 * was the single biggest source of off-target results.
 */
export function locationClause(t: QueryTerms, _includeRemote = false): string {
  return orGroup(uniq(t.location_terms), 3);
}

/**
 * Recruiter-mandated phrases. Rendered as ONE OR group — a profile page that
 * carries any of them counts. AND'ing several ("BCG" "Bain") demands that a
 * single profile mention every one, which on Google returns nothing; the
 * recruiter's intent ("from BCG or Bain") is the alternative, not the
 * conjunction. Entries may themselves be "a|b" alternatives.
 */
export function requiredClause(t: QueryTerms): string {
  const alternatives = uniq((t.required_phrases ?? []).flatMap((p) => p.split('|'))).slice(0, 4);
  return orGroup(alternatives, 4);
}

/** Recruiter exclusions as -"term" (multi-word) or -term (single word); excluded organisations ride along. */
export function excludeClause(t: QueryTerms): string {
  const negate = (x: string) => (/\s/.test(x) ? `-${quote(x)}` : `-${x.replace(/^-+/, '')}`);
  return uniq([...(t.exclude_terms ?? []).slice(0, 6), ...(t.excluded_orgs ?? []).slice(0, 4)])
    .map(negate)
    .join(' ');
}

/**
 * The organisation constraint for one template. LinkedIn page titles read
 * "Name – Title – Company", so "current employer only" is enforceable there
 * with intitle:; everywhere else (and for 'any') a plain OR group means the
 * name appears somewhere on the page — current or past.
 */
export function orgClause(t: QueryTerms, platform: CandidatePlatform): string {
  const group = orGroup(t.target_orgs ?? [], 6);
  if (!group) return '';
  return platform === 'LinkedIn' && t.org_scope === 'current' ? `intitle:${group}` : group;
}

// Inserts the organisation clause right after the leading site:/filetype:
// operator (or a parenthesised group of them), so the query reads naturally in
// the preview. Google itself is indifferent to operator order.
const LEADING_OPERATOR = /^(\((?:site|filetype):\S+(?:\s+OR\s+(?:site|filetype):\S+)*\)|(?:site|filetype):\S+)\s*/;

function withOrgClause(query: string, t: QueryTerms, platform: CandidatePlatform): string {
  const clause = orgClause(t, platform);
  if (!clause) return query;
  const m = query.match(LEADING_OPERATOR);
  return m ? `${m[1]} ${clause} ${query.slice(m[0].length)}`.trim() : `${clause} ${query}`;
}

// --- Google's word budget ---------------------------------------------------
//
// Google silently ignores everything after the 32nd word, and it counts every
// word inside a quoted phrase. A query that runs long therefore loses exactly
// the parts at the end — exclusions and location — and returns broad, poor
// matches. Every template is fitted to this budget before it ships.
export const GOOGLE_WORD_LIMIT = 32;

export function countGoogleWords(query: string): number {
  // Operators (site:x, filetype:pdf, -term, OR, AND, AROUND(5)) count as one
  // word each; quoted phrases count each word inside them.
  return query
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Progressively simplifies the vocabulary until the built query fits the
 * word budget. Order matters: cosmetic breadth goes first (skill synonyms,
 * extra title variants), recruiter intent goes last (required phrases and
 * exclusions are trimmed only if nothing else is left).
 */
function fitToBudget(tpl: XRayTemplate, terms: QueryTerms): string | null {
  const attempts: Array<(t: QueryTerms) => QueryTerms> = [
    (t) => t,
    (t) => ({ ...t, skill_synonyms: {} }),
    (t) => ({ ...t, role_synonyms: t.role_synonyms.slice(0, 3) }),
    (t) => ({ ...t, location_terms: t.location_terms.slice(0, 1), domain_terms: (t.domain_terms ?? []).slice(0, 2) }),
    (t) => ({ ...t, must_have_skills: t.must_have_skills.slice(0, 2) }),
    (t) => ({ ...t, role_synonyms: t.role_synonyms.slice(0, 2), discipline_terms: t.discipline_terms.slice(0, 2), role_adjacent_terms: t.role_adjacent_terms.slice(0, 2) }),
    (t) => ({ ...t, exclude_terms: t.exclude_terms.slice(0, 3), excluded_orgs: (t.excluded_orgs ?? []).slice(0, 2) }),
    (t) => ({ ...t, target_orgs: (t.target_orgs ?? []).slice(0, 4) }),
    (t) => ({ ...t, required_phrases: t.required_phrases.slice(0, 2) }),
    (t) => ({ ...t, target_orgs: (t.target_orgs ?? []).slice(0, 3) }),
    (t) => ({ ...t, role_synonyms: t.role_synonyms.slice(0, 1), must_have_skills: t.must_have_skills.slice(0, 1) }),
  ];
  let current = terms;
  let built: string | null = null;
  for (const step of attempts) {
    current = step(current);
    const raw = tpl.build(current);
    if (!raw) return null;
    built = withOrgClause(raw, current, tpl.platform);
    if (countGoogleWords(built) <= GOOGLE_WORD_LIMIT) return built;
  }
  return built;
}

export function rolesClause(t: QueryTerms): string {
  return orGroup(t.role_synonyms, 5);
}

const SENIORITY_WORDS = /\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|head of|chief|associate|mid[- ]level|entry[- ]level)\b/gi;

export function stripSeniority(title: string): string {
  return title.replace(SENIORITY_WORDS, '').replace(/\s{2,}/g, ' ').trim() || title.trim();
}

/** Role synonyms with the seniority prefix removed — for AROUND(n) and intitle: variants. */
function baseRolesClause(t: QueryTerms): string {
  return orGroup(t.role_synonyms.map(stripSeniority), 4);
}

const join = (...parts: Array<string | null | undefined>) =>
  parts.filter((p): p is string => Boolean(p && p.trim())).join(' ');

// --- The approved templates -------------------------------------------------

export const XRAY_TEMPLATES: readonly XRayTemplate[] = [
  // LinkedIn -----------------------------------------------------------------
  {
    id: 'linkedin_broad',
    platform: 'LinkedIn',
    label: 'Broad profile search',
    pattern:
      'site:linkedin.com/in/ ({role synonyms, OR\'d}) AND ({must-have skills}) {location} -intitle:job -intitle:hiring -intitle:recruiter',
    expected_result_type: 'Profile',
    intent: (t) => `Broad LinkedIn sweep for ${t.role_synonyms[0] ?? 'the role'} profiles with the must-have skills.`,
    build: (t) =>
      join(
        'site:linkedin.com/in/',
        rolesClause(t),
        topicClause(t),
        requiredClause(t),
        locationClause(t),
        '-intitle:job -intitle:hiring -intitle:recruiter',
        excludeClause(t)
      ),
  },
  {
    id: 'linkedin_title',
    platform: 'LinkedIn',
    label: 'Title-anchored (narrow)',
    pattern: 'site:linkedin.com/in/ intitle:({role synonyms}) AND ({must-have skills}) -intitle:job -intitle:hiring -intitle:recruiter',
    expected_result_type: 'Profile',
    intent: (t) => `LinkedIn profiles whose headline carries the ${t.role_synonyms[0] ?? 'role'} title.`,
    build: (t) =>
      join(
        'site:linkedin.com/in/',
        `intitle:${baseRolesClause(t)}`,
        topicClause(t),
        requiredClause(t),
        '-intitle:job -intitle:hiring -intitle:recruiter',
        excludeClause(t)
      ),
  },
  {
    id: 'linkedin_proximity',
    platform: 'LinkedIn',
    label: 'Proximity-filtered',
    pattern: 'site:linkedin.com/in/ {seniority term} AROUND(5) ({role synonyms}) AND ({must-have skills})',
    expected_result_type: 'Profile',
    intent: (t) => `LinkedIn profiles where "${t.seniority_term}" sits within five words of the role title.`,
    build: (t) =>
      t.seniority_term
        ? join(
            'site:linkedin.com/in/',
            `${quote(t.seniority_term)} AROUND(5) ${baseRolesClause(t)}`,
            topicClause(t),
            requiredClause(t),
            excludeClause(t)
          )
        : null,
  },
  {
    id: 'linkedin_pdf',
    platform: 'LinkedIn',
    label: 'Resume / CV subpath',
    pattern: 'site:linkedin.com/in/ ({role synonyms}) filetype:pdf',
    expected_result_type: 'Resume',
    intent: (t) => `PDF resumes exported from LinkedIn profiles for ${t.role_synonyms[0] ?? 'the role'}.`,
    build: (t) => join('site:linkedin.com/in/', rolesClause(t), requiredClause(t), 'filetype:pdf', excludeClause(t)),
  },

  // GitHub -------------------------------------------------------------------
  {
    id: 'github_bio',
    platform: 'GitHub',
    label: 'Profile bio / README search',
    pattern: 'site:github.com ({languages/frameworks, quoted}) AND ({role-adjacent terms}) -intitle:job',
    expected_result_type: 'Profile',
    intent: (t) => `GitHub bios and READMEs mentioning ${t.must_have_skills.slice(0, 3).join(', ') || 'the stack'}.`,
    build: (t) =>
      !skillsClause(t)
        ? null // no searchable hard skills — a GitHub sweep on soft skills is noise
        : join(
        'site:github.com',
        skillsClause(t),
        orGroup(t.role_adjacent_terms, 4),
        requiredClause(t),
        '-intitle:job',
        excludeClause(t)
      ),
  },
  {
    id: 'github_location',
    platform: 'GitHub',
    label: 'Location-anchored',
    pattern: 'site:github.com ({languages/frameworks}) "{location}"',
    expected_result_type: 'Profile',
    intent: (t) => `GitHub developers who list ${t.location_terms[0] ?? 'the target location'} on their profile.`,
    build: (t) => {
      const loc = locationClause(t, false);
      return loc && skillsClause(t) ? join('site:github.com', skillsClause(t), requiredClause(t), loc, excludeClause(t)) : null;
    },
  },

  // Stack Overflow -----------------------------------------------------------
  {
    id: 'stackoverflow_skills',
    platform: 'StackOverflow',
    label: 'Skill-based user search',
    pattern: 'site:stackoverflow.com/users ({must-have skills})',
    expected_result_type: 'Profile',
    intent: (t) => `Stack Overflow users active in ${t.must_have_skills.slice(0, 3).join(', ') || 'the must-have tags'}.`,
    build: (t) => (skillsClause(t) ? join('site:stackoverflow.com/users', skillsClause(t), requiredClause(t), excludeClause(t)) : null),
  },
  {
    id: 'stackoverflow_passive',
    platform: 'StackOverflow',
    label: 'Passive-candidate filter',
    pattern: 'site:stackoverflow.com/users ({must-have skills}) -"looking for job" -hiring',
    expected_result_type: 'Profile',
    intent: () => 'Stack Overflow users with the skills who are not actively advertising a job hunt.',
    build: (t) =>
      skillsClause(t) ? join('site:stackoverflow.com/users', skillsClause(t), requiredClause(t), '-"looking for job" -hiring', excludeClause(t)) : null,
  },

  // Wellfound ----------------------------------------------------------------
  {
    id: 'wellfound_role',
    platform: 'Wellfound',
    label: 'Role + skill + location',
    pattern: 'site:wellfound.com ({role synonyms}) AND ({must-have skills}) {location}',
    expected_result_type: 'Profile',
    intent: (t) => `Startup-minded ${t.role_synonyms[0] ?? 'candidates'} on Wellfound.`,
    build: (t) => join('site:wellfound.com', rolesClause(t), topicClause(t), requiredClause(t), locationClause(t), excludeClause(t)),
  },

  // Behance ------------------------------------------------------------------
  {
    id: 'behance_discipline',
    platform: 'Behance',
    label: 'Discipline / skill search',
    pattern: 'site:behance.net ({discipline, e.g. "UI Design" OR "Brand Identity"}) AND ({must-have skills})',
    expected_result_type: 'Portfolio',
    intent: (t) => `Behance portfolios in ${t.discipline_terms.slice(0, 2).join(' / ') || 'the discipline'}.`,
    build: (t) => join('site:behance.net', orGroup(t.discipline_terms, 4), topicClause(t), requiredClause(t), excludeClause(t)),
  },

  // Dribbble -----------------------------------------------------------------
  {
    id: 'dribbble_discipline',
    platform: 'Dribbble',
    label: 'Discipline / skill search',
    pattern: 'site:dribbble.com ({discipline}) AND ({must-have skills})',
    expected_result_type: 'Portfolio',
    intent: (t) => `Dribbble designers working in ${t.discipline_terms.slice(0, 2).join(' / ') || 'the discipline'}.`,
    build: (t) => join('site:dribbble.com', orGroup(t.discipline_terms, 4), topicClause(t), requiredClause(t), excludeClause(t)),
  },

  // Xing ---------------------------------------------------------------------
  {
    id: 'xing_profile',
    platform: 'Xing',
    label: 'DACH region role + skill',
    pattern: 'site:xing.com/profile ({role synonyms, local language if relevant}) AND ({must-have skills})',
    expected_result_type: 'Profile',
    intent: (t) => `Xing profiles for ${t.role_synonyms[0] ?? 'the role'} across the DACH region.`,
    build: (t) => join('site:xing.com/profile', rolesClause(t), topicClause(t), requiredClause(t), excludeClause(t)),
  },
  {
    id: 'xing_geo',
    platform: 'Xing',
    label: 'Geo-domain variant',
    pattern: 'site:.de ({role synonyms}) AND ({must-have skills})',
    expected_result_type: 'Profile',
    intent: (t) => `Country-domain (${t.geo_tld || 'none for this location'}) pages mentioning the role and skills.`,
    build: (t) =>
      t.geo_tld ? join(`site:${t.geo_tld}`, rolesClause(t), topicClause(t), requiredClause(t), excludeClause(t)) : null,
  },

  // Resumes / CVs (open web) -------------------------------------------------
  {
    id: 'resume_pdf',
    platform: 'Resumes',
    label: 'Direct filetype search',
    pattern:
      'filetype:pdf ({role synonyms}) AND ({must-have skills}) ("resume" OR "CV" OR "curriculum vitae") {location}',
    expected_result_type: 'Resume',
    intent: (t) => `Open-web PDF resumes for ${t.role_synonyms[0] ?? 'the role'}.`,
    build: (t) =>
      join(
        'filetype:pdf',
        rolesClause(t),
        topicClause(t),
        requiredClause(t),
        '("resume" OR "CV" OR "curriculum vitae")',
        locationClause(t),
        excludeClause(t)
      ),
  },
  {
    id: 'resume_presentations',
    platform: 'Resumes',
    label: 'Presentations / thought-leadership',
    pattern: '(filetype:ppt OR site:slideshare.net) ({topic/skills}) intitle:({role or conference context})',
    expected_result_type: 'Portfolio',
    intent: (t) => `Conference decks and SlideShare uploads by practitioners of ${t.must_have_skills[0] ?? 'the topic'}.`,
    build: (t) => join('(filetype:ppt OR site:slideshare.net)', skillsAsTopics(t) || orGroup(t.domain_terms ?? [], 3), requiredClause(t), `intitle:${baseRolesClause(t)}`, excludeClause(t)),
  },

  // Combined multi-site pass -------------------------------------------------
  {
    id: 'multisite_pass',
    platform: 'MultiSite',
    label: 'Combined multi-site pass',
    pattern:
      '(site:linkedin.com/in/ OR site:github.com OR site:stackoverflow.com/users) AND ({role synonyms}) AND ({must-have skills})',
    expected_result_type: 'Profile',
    intent: () => 'One lower-precision sweep across LinkedIn, GitHub and Stack Overflow at once.',
    build: (t) =>
      join(
        '(site:linkedin.com/in/ OR site:github.com OR site:stackoverflow.com/users)',
        rolesClause(t),
        topicClause(t),
        requiredClause(t),
        excludeClause(t)
      ),
  },
] as const;

export const TEMPLATES_BY_PLATFORM: Record<CandidatePlatform, readonly XRayTemplate[]> = PLATFORM_IDS.reduce(
  (acc, id) => {
    acc[id] = XRAY_TEMPLATES.filter((tpl) => tpl.platform === id);
    return acc;
  },
  {} as Record<CandidatePlatform, readonly XRayTemplate[]>
);

export const TOTAL_TEMPLATE_COUNT = XRAY_TEMPLATES.length;
export const MAX_TEMPLATES_ON_ONE_PLATFORM = Math.max(...PLATFORM_IDS.map((id) => TEMPLATES_BY_PLATFORM[id].length));

export function getTemplate(id: string): XRayTemplate | undefined {
  return XRAY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Builds the full bundle: every applicable template for every selected
 * platform, one XRayQuery each. Each query is later searched individually.
 */
export function buildQueryBundle(terms: QueryTerms, platforms: CandidatePlatform[]): XRayQuery[] {
  const bundle: XRayQuery[] = [];
  for (const platform of PLATFORM_IDS) {
    if (!platforms.includes(platform)) continue;
    for (const tpl of TEMPLATES_BY_PLATFORM[platform]) {
      const query_string = fitToBudget(tpl, terms);
      if (!query_string) continue;
      bundle.push({
        id: `q-${tpl.id}`,
        platform,
        query_type: tpl.id,
        query_string: query_string.replace(/\s{2,}/g, ' ').trim(),
        query_intent: tpl.intent(terms),
        expected_result_type: tpl.expected_result_type,
        is_edited: false,
      });
    }
  }
  return bundle;
}

// --- Heuristic vocabulary (no-AI fallback) ---------------------------------

const SKILL_SYNONYMS: Record<string, string[]> = {
  react: ['ReactJS', 'React.js'],
  'react native': ['ReactNative'],
  'next.js': ['NextJS', 'Next'],
  'node.js': ['NodeJS', 'Node'],
  typescript: ['TS'],
  javascript: ['JS', 'ES6'],
  python: ['Python3'],
  go: ['Golang'],
  kubernetes: ['K8s'],
  postgresql: ['Postgres'],
  aws: ['Amazon Web Services'],
  gcp: ['Google Cloud'],
  'tailwind css': ['Tailwind', 'TailwindCSS'],
  'design systems': ['Design System', 'Component Library'],
  'user research': ['UX Research'],
  prototyping: ['Prototype', 'Prototypes'],
  figma: ['Figma Design'],
  'machine learning': ['ML'],
  'artificial intelligence': ['AI'],
  'large language models': ['LLM', 'LLMs'],
  'c#': ['CSharp', '.NET'],
  'c++': ['CPP'],
  'vue.js': ['Vue', 'VueJS'],
  angular: ['AngularJS'],
  graphql: ['Apollo'],
  docker: ['Containers'],
  terraform: ['IaC'],
};

const SENIORITY_TERM: Record<SeniorityLevel | 'Any', string | null> = {
  Junior: 'Junior',
  Mid: null,
  Senior: 'Senior',
  Staff: 'Staff',
  Lead: 'Lead',
  Executive: 'Director',
  Any: null,
};

function roleVariants(title: string, seniority: MergedConstraints['seniority']): string[] {
  const base = stripSeniority(title);
  const variants: string[] = [title];
  if (seniority !== 'Any' && seniority !== 'Mid' && !new RegExp(`^${seniority}\\b`, 'i').test(title)) {
    variants.push(`${SENIORITY_TERM[seniority] ?? seniority} ${base}`);
  }
  const swaps: Array<[RegExp, string]> = [
    [/\bEngineer\b/i, 'Developer'],
    [/\bDeveloper\b/i, 'Engineer'],
    [/\bProgrammer\b/i, 'Developer'],
    [/\bUX Designer\b/i, 'Product Designer'],
    [/\bProduct Designer\b/i, 'UX Designer'],
    [/\bUI\/UX Designer\b/i, 'Product Designer'],
    [/\bData Scientist\b/i, 'Machine Learning Engineer'],
    [/\bDevOps Engineer\b/i, 'Site Reliability Engineer'],
    [/\bProduct Manager\b/i, 'Product Owner'],
  ];
  for (const [re, replacement] of swaps) {
    if (re.test(base)) {
      variants.push(base.replace(re, replacement));
      break;
    }
  }
  variants.push(base);
  if (seniority === 'Senior' || seniority === 'Staff' || seniority === 'Lead') {
    variants.push(`Lead ${base}`);
  }
  return uniq(variants).slice(0, 6);
}

function disciplineTerms(title: string, roleType: MergedConstraints['role_type']): string[] {
  const base = stripSeniority(title);
  const terms: string[] = [];
  if (/product/i.test(base)) terms.push('Product Design');
  if (/\bux\b|experience/i.test(base)) terms.push('UX Design');
  if (/\bui\b|interface|visual/i.test(base)) terms.push('UI Design');
  if (/brand/i.test(base)) terms.push('Brand Identity');
  if (/graphic/i.test(base)) terms.push('Graphic Design');
  if (/motion/i.test(base)) terms.push('Motion Graphics');
  if (/illustrat/i.test(base)) terms.push('Illustration');
  if (/web/i.test(base)) terms.push('Web Design');
  if (terms.length === 0 && roleType === 'Design') terms.push('UI Design', 'UX Design');
  terms.push(base);
  return uniq(terms).slice(0, 4);
}

function adjacentTerms(title: string, roleType: MergedConstraints['role_type'], domain: string[]): string[] {
  const base = stripSeniority(title).toLowerCase();
  const terms: string[] = [];
  for (const word of ['frontend', 'front-end', 'backend', 'back-end', 'full stack', 'fullstack', 'mobile', 'devops', 'data', 'machine learning', 'platform', 'infrastructure', 'security', 'ios', 'android', 'embedded']) {
    if (base.includes(word)) terms.push(word);
  }
  if (terms.length === 0) terms.push(base);
  terms.push(roleType === 'Engineering' ? 'developer' : roleType.toLowerCase());
  for (const d of domain.slice(0, 1)) terms.push(d.toLowerCase().split('/')[0].trim());
  return uniq(terms).slice(0, 4);
}

// Longest alternatives first: "not interested in" must win over "not".
const NEGATION_WORDS = "not interested in|don't want|do not want|no one|nobody|excluding|exclude|without|avoid|never|ignore|skip|not|no";
const NEGATION_LEAD = new RegExp(`^(?:${NEGATION_WORDS})\\b\\s*`, 'i');
const NEGATION_SENTENCE = new RegExp(`^(?:${NEGATION_WORDS})\\b`, 'i');
// Words that carry no search meaning in an exclusion chunk ("anyone at Infosys" → "Infosys").
// Matched only as whole, unhyphenated words so "frontend-only" survives intact.
const FILLER = /(?<![\w-])(?:anyone|anybody|someone|people|persons?|candidates?|profiles?|folks|those|who are|who is|currently|working|employed|based|at|from|in|with|the|a|an|any|please|also|strictly|is|are|be)(?![\w-])/gi;

function cleanTerm(raw: string, stripFiller = true): string | null {
  let t = raw.replace(/["“”]/g, '').replace(/[.!?;:]+$/g, '').trim();
  if (stripFiller) t = t.replace(FILLER, ' ').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^(?:-|—)\s*/, '');
  if (!t) return null;
  const words = t.split(/\s+/);
  if (words.length > 3 || t.length > 32) return null; // too long to be a clean search term
  return t;
}

/**
 * Pulls hard signals out of the recruiter's free-text additional details
 * without a model, conservatively — only short, clean terms are emitted, since
 * anything found here is AND'd or negated into every query:
 *   - "quoted phrases"                       → required phrase
 *   - must have / must mention / only X or Y → required phrase (alternatives joined with "|")
 *   - no / not / exclude / avoid / without X, Y or Z → exclusions (every item in the list)
 */
export function parseAdditionalDetails(details: string | undefined | null): { required_phrases: string[]; exclude_terms: string[] } {
  const text = (details ?? '').replace(/\r/g, '').trim();
  if (!text) return { required_phrases: [], exclude_terms: [] };

  const required: string[] = [];
  const exclude: string[] = [];

  for (const m of text.matchAll(/["“”]([^"“”]{2,40})["“”]/g)) {
    const phrase = m[1].trim();
    if (phrase.split(/\s+/).length <= 4) required.push(phrase);
  }

  const sentences = text
    .split(/(?<=[.!?;])\s+|\n+|•/)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const negativeSentence = NEGATION_SENTENCE.test(sentence);
    // Split into list items on commas / "or" / "and" / slashes.
    const chunks = sentence.split(/\s*(?:,|\/|\bor\b|\band\b)\s*/i).map((c) => c.trim()).filter(Boolean);

    let inNegativeList = negativeSentence;
    for (const chunk of chunks) {
      if (NEGATION_LEAD.test(chunk)) {
        inNegativeList = true;
        const term = cleanTerm(chunk.replace(NEGATION_LEAD, ''));
        if (term) exclude.push(term);
        continue;
      }
      if (inNegativeList) {
        const term = cleanTerm(chunk);
        if (term) exclude.push(term);
      }
    }

    if (negativeSentence) continue;
    // "prefer …", "ideally …", "e.g. …", "such as …", "bonus …" describe wishes and
    // examples, not requirements — never turned into search terms.
    if (/\b(prefer(s|red|ably)?|ideally|nice to have|bonus|plus|e\.g\.|for example|such as|like|similar to)\b/i.test(sentence)) continue;

    // "must have X", "must mention X", "should mention X", "required: X"
    const must = sentence.match(/\b(?:must|should)\s+(?:have|mention|include|show|be|list)\b\s*(?:a|an|the)?\s*([^,.;"“”]{2,40})/i);
    if (must && !/["“”]/.test(sentence)) {
      const term = cleanTerm(must[1].replace(/\b(?:experience|background|exposure|work)\b.*$/i, ''), false);
      if (term) required.push(term);
    }

    // "only X or Y" → one required group of alternatives
    const only = sentence.match(/\bonly\s+([^,.;]{2,60})/i);
    if (only) {
      const alts = only[1]
        .split(/\s*(?:\bor\b|\/|,)\s*/i)
        .map((a) => cleanTerm(a.replace(/\b(?:background|experience|profiles?|candidates?)\b.*$/i, ''), false))
        .filter((a): a is string => Boolean(a));
      if (alts.length) required.push(alts.join('|'));
    }
  }

  // Drop a lone phrase that is already covered by an alternatives group.
  const groups = required.filter((r) => r.includes('|'));
  const singles = required.filter((r) => !r.includes('|') && !groups.some((g) => g.split('|').some((a) => a.toLowerCase() === r.toLowerCase())));

  return {
    required_phrases: uniq([...groups, ...singles]).slice(0, 3),
    exclude_terms: uniq(exclude).slice(0, 6),
  };
}

const DOMAIN_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/\b(ai|artificial intelligence|machine learning|ml|genai|generative ai|llm)\b/i, ['Artificial Intelligence', 'Machine Learning', 'Generative AI']],
  [/\b(data science|analytics)\b/i, ['Data Science', 'Analytics']],
  [/\bfintech|payments|banking\b/i, ['FinTech', 'Payments']],
  [/\bsaas|b2b\b/i, ['SaaS', 'B2B']],
  [/\be-?commerce|retail|marketplace\b/i, ['E-commerce', 'Retail']],
  [/\bhealth|medical|pharma\b/i, ['Healthcare', 'HealthTech']],
  [/\bedtech|education|learning\b/i, ['EdTech', 'Education']],
  [/\bcloud|devops|infrastructure\b/i, ['Cloud', 'DevOps']],
  [/\bcyber|security\b/i, ['Cybersecurity', 'Information Security']],
];

/** Domain / industry phrases from the JD domain list plus what the title itself implies ("AI Consultant" → AI terms). */
function deriveDomainTerms(title: string, domain: string[]): string[] {
  const out: string[] = [];
  const haystack = `${title} ${domain.join(' ')}`;
  for (const [re, terms] of DOMAIN_EXPANSIONS) if (re.test(haystack)) out.push(...terms);
  for (const d of domain) for (const part of d.split(/\s*[\/,&]\s*/)) if (part.trim().length > 2 && !/^technology$/i.test(part.trim())) out.push(part.trim());
  return uniq(out).slice(0, 4);
}

/** Grounded, deterministic vocabulary built purely from the confirmed constraints. */
export function deriveQueryTerms(constraints: MergedConstraints): QueryTerms {
  const title = (constraints.job_title || 'Software Engineer').trim();
  const seniority = constraints.seniority || 'Any';
  const mustHave = uniq((constraints.must_have_skills || []).filter((sk) => !isSoftSkill(sk)));
  const domain_terms = deriveDomainTerms(title, constraints.domain || []);

  const skill_synonyms: Record<string, string[]> = {};
  for (const skill of mustHave) {
    const syn = SKILL_SYNONYMS[skill.toLowerCase()];
    if (syn) skill_synonyms[skill] = syn;
  }

  // One place decides what a location means: spellings a profile would carry,
  // the country domain for the geo sweep, and whether "remote" was said.
  const loc = parseLocation(constraints.location);
  const location_terms = loc.searchTerms.slice(0, 3);
  const geo_tld = loc.tld;
  const details = parseAdditionalDetails(constraints.additional_details ?? constraints.soft_constraints);

  return {
    role_synonyms: roleVariants(title, seniority),
    must_have_skills: mustHave,
    domain_terms,
    skill_synonyms,
    role_adjacent_terms: adjacentTerms(title, constraints.role_type || 'Engineering', constraints.domain || []),
    discipline_terms: disciplineTerms(title, constraints.role_type || 'Engineering'),
    seniority_term: SENIORITY_TERM[seniority] ?? null,
    location_terms,
    remote: Boolean(constraints.remote_eligible) || loc.remote,
    geo_tld,
    required_phrases: details.required_phrases,
    exclude_terms: details.exclude_terms,
    target_orgs: uniq((constraints.target_organizations ?? []).map((o) => o.trim()).filter(Boolean)).slice(0, 6),
    excluded_orgs: uniq((constraints.excluded_organizations ?? []).map((o) => o.trim()).filter(Boolean)).slice(0, 4),
    org_scope: constraints.organization_scope === 'current' ? 'current' : 'any',
  };
}

/**
 * Is `term` something the recruiter actually wrote? Every word of the term
 * must share a stem with a word in the details (≥4 common leading characters),
 * so "freelance" is grounded by "freelancers", "intern" by "interns" or
 * "internships", "agency" by "agencies" — but nothing is grounded by an empty
 * or unrelated box. Used to stop the model volunteering exclusions.
 */
function isGroundedIn(term: string, details: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').split(' ').filter(Boolean);
  const pool = words(details);
  if (!pool.length) return false;
  return words(term).every((w) =>
    pool.some((d) => {
      const n = Math.min(w.length, d.length);
      return n >= 4 ? w.slice(0, n) === d.slice(0, n) : w === d;
    })
  );
}

/**
 * Merges AI-supplied vocabulary over the heuristic one. Anything missing,
 * empty or malformed falls back to the grounded heuristic value, and skill
 * lists are pinned to the recruiter-confirmed must-haves so the model can't
 * add requirements the JD never had.
 *
 * `details` is the recruiter's additional-details text. Exclusions are the
 * one field where the model must not contribute anything of its own: every
 * -term is negated in every query, and an invented `-intern` or `-freelance`
 * silently removes real candidates from roles that never asked for it. So a
 * model exclusion survives only if it is grounded in what the recruiter wrote;
 * with no details at all, none survive.
 */
export function mergeQueryTerms(base: QueryTerms, ai: Partial<QueryTerms> | null | undefined, details: string | null | undefined = ''): QueryTerms {
  if (!ai || typeof ai !== 'object') return base;
  const strList = (v: unknown, max: number): string[] | null =>
    Array.isArray(v) ? uniq(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)).slice(0, max) : null;
  const detailsText = (details ?? '').trim();
  // Grounded in the recruiter's words, and not a respelling of an exclusion
  // the heuristic parser already has ("freelance" next to "freelancers").
  const aiExclusions = (strList(ai.exclude_terms, 6) ?? []).filter(
    (t) => isGroundedIn(t, detailsText) && !base.exclude_terms.some((b) => isGroundedIn(t, b) || isGroundedIn(b, t))
  );

  const synonyms: Record<string, string[]> = { ...base.skill_synonyms };
  if (ai.skill_synonyms && typeof ai.skill_synonyms === 'object') {
    for (const skill of base.must_have_skills) {
      const match = Object.entries(ai.skill_synonyms).find(([k]) => k.toLowerCase() === skill.toLowerCase());
      const list = match ? strList(match[1], 3) : null;
      if (list && list.length) synonyms[skill] = list;
    }
  }

  const roleSyn = strList(ai.role_synonyms, 6);
  const roles = roleSyn && roleSyn.length >= 2 ? uniq([base.role_synonyms[0], ...roleSyn]).slice(0, 6) : base.role_synonyms;

  return {
    role_synonyms: roles,
    must_have_skills: base.must_have_skills,
    skill_synonyms: synonyms,
    role_adjacent_terms: strList(ai.role_adjacent_terms, 4) ?? base.role_adjacent_terms,
    domain_terms: uniq([...(strList(ai.domain_terms, 4) ?? []), ...base.domain_terms]).slice(0, 4),
    discipline_terms: strList(ai.discipline_terms, 4) ?? base.discipline_terms,
    seniority_term:
      typeof ai.seniority_term === 'string' && ai.seniority_term.trim() ? ai.seniority_term.trim() : base.seniority_term,
    location_terms: strList(ai.location_terms, 4) ?? base.location_terms,
    remote: base.remote,
    geo_tld: typeof ai.geo_tld === 'string' && /^\.[a-z]{2,}(\.[a-z]{2,})?$/i.test(ai.geo_tld.trim()) ? ai.geo_tld.trim().toLowerCase() : base.geo_tld,
    // Recruiter intent from the additional details is additive: what the
    // heuristic parser found stays, the model can only sharpen or extend it.
    required_phrases: uniq([...(strList(ai.required_phrases, 3) ?? []), ...base.required_phrases]).slice(0, 3),
    // Heuristic exclusions (parsed from the details) always stay; model
    // exclusions only if grounded in the same details — see isGroundedIn.
    exclude_terms: uniq([...base.exclude_terms, ...aiExclusions]).slice(0, 6),
    // Organisations are a hard constraint the recruiter typed; the model is
    // told about them but cannot add, drop or rename one.
    target_orgs: base.target_orgs,
    excluded_orgs: base.excluded_orgs,
    org_scope: base.org_scope,
  };
}
