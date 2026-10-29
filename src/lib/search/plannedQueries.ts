import type { CandidatePlatform, MergedConstraints, XRayQuery } from '../types';
import { getPlatformMeta, normalizePlatform, PLATFORM_IDS } from './platforms';
import { buildQueryBundle, countGoogleWords, GOOGLE_WORD_LIMIT, isGroundedIn, PlannedTier, QueryTerms, withOrgClause } from './xrayTemplates';
import { canonicalizeQueryString, DUPLICATE_SIMILARITY_THRESHOLD, querySimilarity, validateQuery } from './queryValidation';
import { serialize, tokenize } from './queryTokens';

// ---------------------------------------------------------------------------
// Planned-query gate.
//
// The reasoning model writes the X-Ray strings itself (XRAY_QUERY_PLANNER_
// SYSTEM_PROMPT); this module decides which of them may spend a credit. The
// model is trusted for strategy and wording, never for the recruiter's hard
// constraints, so every query is checked here before it is accepted:
//
//   * shape      — the same validator the run applies (balanced quotes and
//                  parens, an allowed site: host for the platform, no
//                  dangling operators), the 32-word budget, and a site:
//                  anchor that actually points at profile pages;
//   * exclusions — a -term survives only if the recruiter asked for it
//                  (grounded in their details, or an excluded organisation)
//                  or it is the standard job-post noise filter;
//   * orgs       — target organisations must appear (inserted if missing),
//                  excluded ones must be negated (appended if missing);
//   * fairness   — no protected characteristic, in or out;
//   * spend      — near-duplicates dropped, per-platform and per-run caps.
//
// A selected platform left with no acceptable query falls back to the
// standard templates, so the bundle never silently loses a platform.
// ---------------------------------------------------------------------------

export interface PlannedQuery {
  platform?: unknown;
  tier?: unknown;
  query?: unknown;
  intent?: unknown;
  rationale?: unknown;
}

export interface PlannerAnalysis {
  role_family?: string;
  scarcity?: string;
  key_signals?: string[];
  location_strategy?: string;
  platform_rationale?: string;
}

export interface PlannerOutput {
  analysis?: PlannerAnalysis;
  queries?: PlannedQuery[];
  vocabulary?: Partial<QueryTerms>;
}

export interface PlanReport {
  accepted: number;
  rejected: Array<{ platform: string; query: string; reason: string }>;
  /** Selected platforms that got template queries because none of the model's were usable. */
  fallbackPlatforms: CandidatePlatform[];
}

/** How many planned queries each platform may have. LinkedIn carries most sourcing; MultiSite overlaps the others. */
export const PLANNED_CAP: Record<CandidatePlatform, number> = {
  LinkedIn: 4,
  GitHub: 2,
  StackOverflow: 2,
  Wellfound: 2,
  Behance: 2,
  Dribbble: 2,
  Xing: 2,
  Resumes: 2,
  MultiSite: 1,
};
export const PLANNED_MAX_TOTAL = 14;

// The job-post / recruiter noise filter is always allowed; it negates page
// types, not people.
const NOISE_EXCLUSIONS = new Set(['-intitle:job', '-intitle:jobs', '-intitle:hiring', '-intitle:recruiter', '-intitle:vacancy', '-inurl:jobs', '-hiring', '-"looking for job"', '-recruiter', '-jobs']);

// Screening on a protected characteristic, in either direction. Deliberately
// broad: a false positive costs one query (the platform falls back to the
// templates); a false negative is discrimination.
const PROTECTED = /\b(male|female|men|women|boys?|girls?|gender|aged?|young(er)?|older|years old|married|unmarried|caste|religion|religious|hindu|muslim|christian|sikh|jain|buddhist|jewish|nationality|disabled|disability|pregnan\w*|maternity|ethnicity|race|racial|fresh blood)\b/i;

const TIERS: PlannedTier[] = ['precision', 'balanced', 'recall'];

function expectedResultType(platform: CandidatePlatform): XRayQuery['expected_result_type'] {
  if (platform === 'Resumes') return 'Resume';
  if (platform === 'Behance' || platform === 'Dribbble') return 'Portfolio';
  return 'Profile';
}

/** Does the query point at the platform's profile pages (not its jobs, posts or company pages)? */
function hasProfileAnchor(query: string, platform: CandidatePlatform): boolean {
  const q = query.toLowerCase();
  switch (platform) {
    case 'LinkedIn':
      return /site:([a-z]{2,3}\.)?linkedin\.com\/in\b/.test(q) && !/filetype:/.test(q);
    case 'StackOverflow':
      return /site:stackoverflow\.com\/users\b/.test(q);
    case 'Xing':
      return /site:xing\.com\/profile\b/.test(q) || /site:\.[a-z]{2}(\.[a-z]{2})?(\s|$|\))/.test(q);
    case 'Resumes':
      return /filetype:(pdf|docx?|pptx?)\b/.test(q) || /site:slideshare\.net\b/.test(q);
    case 'MultiSite':
      return (q.match(/site:/g) ?? []).length >= 2;
    default:
      return getPlatformMeta(platform).hosts.some((h) => q.includes(`site:${h}`) || q.includes(`site:www.${h}`));
  }
}

const mentions = (query: string, name: string) => query.toLowerCase().includes(name.trim().toLowerCase());

/** Strips -terms the recruiter never asked for. Returns the cleaned query and what was removed. */
function stripUngroundedExclusions(query: string, terms: QueryTerms, details: string): { query: string; removed: string[] } {
  const tokens = tokenize(query);
  const removed: string[] = [];
  const kept = tokens.filter((t) => {
    if (t.kind !== 'exclude') return true;
    const raw = t.text.trim();
    if (NOISE_EXCLUSIONS.has(raw.toLowerCase())) return true;
    const inner = raw.replace(/^-+/, '').replace(/^(intitle|inurl|intext):/i, '').replace(/^"|"$/g, '').trim();
    if (!inner) return false;
    const allowed =
      (terms.excluded_orgs ?? []).some((o) => o.toLowerCase() === inner.toLowerCase()) ||
      isGroundedIn(inner, details) ||
      terms.exclude_terms.some((e) => isGroundedIn(inner, e) || isGroundedIn(e, inner));
    if (!allowed) removed.push(raw);
    return allowed;
  });
  return { query: removed.length ? serialize(kept) : query, removed };
}

/** Adds the recruiter's organisation constraints the model left out. */
function enforceOrganisations(query: string, terms: QueryTerms, platform: CandidatePlatform): string {
  let out = query;
  if ((terms.target_orgs ?? []).length && !terms.target_orgs.some((o) => mentions(out, o))) {
    out = withOrgClause(out, terms, platform);
  }
  for (const org of terms.excluded_orgs ?? []) {
    const negated = new RegExp(`-"?${org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`, 'i').test(out);
    if (!negated) out = `${out} ${/\s/.test(org) ? `-"${org}"` : `-${org}`}`;
  }
  return out;
}

/**
 * Turns the planner's output into the run bundle: accepted model queries,
 * ordered by platform then tier, plus template queries for any selected
 * platform the model left without a usable query.
 */
export function acceptPlannedQueries(
  planned: PlannedQuery[],
  ctx: { constraints: MergedConstraints; terms: QueryTerms; platforms: CandidatePlatform[]; details: string }
): { queries: XRayQuery[]; report: PlanReport } {
  const report: PlanReport = { accepted: 0, rejected: [], fallbackPlatforms: [] };
  const accepted: Array<XRayQuery & { tierIndex: number }> = [];
  const perPlatform = new Map<CandidatePlatform, number>();
  const reject = (platform: string, query: string, reason: string) => report.rejected.push({ platform, query, reason });

  for (const p of Array.isArray(planned) ? planned : []) {
    const platform = normalizePlatform(p?.platform);
    const raw = typeof p?.query === 'string' ? canonicalizeQueryString(p.query) : '';
    const label = String(p?.platform ?? '?');
    if (!platform || !ctx.platforms.includes(platform)) {
      reject(label, raw, 'platform not selected');
      continue;
    }
    if (!raw) {
      reject(label, raw, 'empty query');
      continue;
    }
    if (PROTECTED.test(raw)) {
      reject(label, raw, 'mentions a protected characteristic');
      continue;
    }
    if (!hasProfileAnchor(raw, platform)) {
      reject(label, raw, `no site:/filetype: anchor on ${platform} profile pages`);
      continue;
    }

    const { query: cleaned, removed } = stripUngroundedExclusions(raw, ctx.terms, ctx.details);
    if (removed.length) console.info(`Planner query on ${platform}: dropped exclusions the recruiter never asked for: ${removed.join(' ')}`);
    const query = canonicalizeQueryString(enforceOrganisations(cleaned, ctx.terms, platform));

    if (countGoogleWords(query) > GOOGLE_WORD_LIMIT) {
      reject(label, query, `${countGoogleWords(query)} words — over Google's ${GOOGLE_WORD_LIMIT}-word limit`);
      continue;
    }
    const check = validateQuery({ id: 'planned', platform, query_type: 'ai', query_string: query, query_intent: '', expected_result_type: 'Profile' }, ctx.constraints);
    if (!check.ok) {
      reject(label, query, check.issues.filter((i) => i.severity === 'error').map((i) => i.code).join(', '));
      continue;
    }
    if (accepted.some((a) => querySimilarity(a.query_string, query) >= DUPLICATE_SIMILARITY_THRESHOLD)) {
      reject(label, query, 'near-duplicate of another planned query');
      continue;
    }
    const count = perPlatform.get(platform) ?? 0;
    if (count >= PLANNED_CAP[platform] || accepted.length >= PLANNED_MAX_TOTAL) {
      reject(label, query, 'over the per-platform or per-run query cap');
      continue;
    }
    perPlatform.set(platform, count + 1);

    const tier: PlannedTier = TIERS.includes(p.tier as PlannedTier) ? (p.tier as PlannedTier) : 'balanced';
    accepted.push({
      id: `q-ai-${platform.toLowerCase()}-${count + 1}`,
      platform,
      query_type: `ai_${tier}`,
      query_string: query,
      query_intent: typeof p.intent === 'string' && p.intent.trim() ? p.intent.trim().slice(0, 200) : `${platform} search planned by the AI`,
      notes: typeof p.rationale === 'string' && p.rationale.trim() ? p.rationale.trim().slice(0, 300) : undefined,
      expected_result_type: expectedResultType(platform),
      is_edited: false,
      tierIndex: TIERS.indexOf(tier),
    });
  }
  report.accepted = accepted.length;

  const queries: XRayQuery[] = [];
  for (const platform of PLATFORM_IDS) {
    if (!ctx.platforms.includes(platform)) continue;
    const mine = accepted.filter((a) => a.platform === platform).sort((a, b) => a.tierIndex - b.tierIndex);
    if (mine.length) {
      queries.push(...mine.map(({ tierIndex: _t, ...q }) => q));
    } else {
      const fallback = buildQueryBundle(ctx.terms, [platform]);
      if (fallback.length) report.fallbackPlatforms.push(platform);
      queries.push(...fallback);
    }
  }
  return { queries, report };
}
