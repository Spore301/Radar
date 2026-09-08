import { CandidatePlatform, MergedConstraints, XRayQuery } from '../types';
import { getPlatformMeta } from './platforms';
import { MAX_TEMPLATES_ON_ONE_PLATFORM, TOTAL_TEMPLATE_COUNT, countGoogleWords, GOOGLE_WORD_LIMIT } from './xrayTemplates';

// ---------------------------------------------------------------------------
// Query validation gate — every check here is a pure function that runs
// BEFORE a query is allowed to reserve a SerpAPI credit. A query that fails
// any 'error'-severity check never reaches the network: it's excluded from
// the cost estimate and the eventual search run entirely. 'warning'-severity
// issues are surfaced but don't block spend.
//
// This module is deliberately provider-agnostic and DB-free — it knows
// nothing about credits, cache, or budgets (those land in later phases). Its
// only job is: is this a well-formed, in-scope X-Ray query?
// ---------------------------------------------------------------------------

export const MAX_QUERY_LENGTH = 2048;
export const MIN_QUERY_LENGTH = 10;
export const MAX_SIGNIFICANT_TERMS = GOOGLE_WORD_LIMIT;
// One query per approved template: a full run over every platform is every
// template exactly once, and no platform gets more queries than it has
// templates (LinkedIn, with four, sets the ceiling).
export const MAX_QUERIES_PER_RUN = TOTAL_TEMPLATE_COUNT;
export const MAX_QUERIES_PER_PLATFORM = MAX_TEMPLATES_ON_ONE_PLATFORM;
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.92;

export type IssueCode =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'TOO_MANY_TERMS'
  | 'UNBALANCED_QUOTES'
  | 'UNBALANCED_PARENS'
  | 'EMPTY_GROUP'
  | 'NO_ANCHOR'
  | 'MALFORMED_SITE'
  | 'SITE_NOT_ALLOWED'
  | 'DANGLING_OPERATOR'
  | 'DOUBLE_OPERATOR'
  | 'BARE_NEGATION'
  | 'DEPRECATED_OPERATOR'
  | 'DUPLICATE_OF'
  | 'BUNDLE_LIMIT'
  | 'PLATFORM_LIMIT';

export interface ValidationIssue {
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export interface QueryValidationResult {
  queryId: string;
  /** True iff there are no 'error'-severity issues. Warnings don't block. */
  ok: boolean;
  /** Whitespace/quote-normalized form of query_string (see canonicalizeQueryString). */
  canonical: string;
  issues: ValidationIssue[];
  /** Set when a bundle-level dedupe check finds an earlier, near-identical query. */
  duplicateOfId?: string;
}

// ---------------------------------------------------------------------------
// Canonicalization + tokenization
//
// Shared with the SERP cache key (src/lib/serp/cache.ts, added in a later
// phase) so "is this query well-formed" and "is this query a cache hit" agree
// on what counts as the same query. Deliberately does NOT lowercase or
// reorder terms: Google's OR/AND/site: are case-sensitive in ways that change
// meaning, and reordering an OR clause can change ranking. Under-normalizing
// costs an extra credit on a near-duplicate; over-normalizing silently
// returns the wrong result set for a different query — the former is cheap,
// the latter is a correctness bug.
// ---------------------------------------------------------------------------

const SMART_QUOTES = /[‘’‛]/g; // ' ' ‛ -> '
const SMART_DOUBLE_QUOTES = /[“”‟]/g; // " " ‟ -> "
const SMART_DASHES = /[‐-―]/g; // various dashes -> -

export function canonicalizeQueryString(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(SMART_QUOTES, "'")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(SMART_DASHES, '-')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/**
 * Splits a canonicalized query into tokens for term-counting and similarity:
 * a quoted phrase ("machine learning engineer") is one token, everything else
 * splits on whitespace. Used by both the >32-terms check and bundle dedupe,
 * so both agree on what a "term" is.
 */
export function tokenizeQuery(canonical: string): string[] {
  const tokens: string[] = [];
  const re = /"[^"]*"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(canonical))) {
    tokens.push(match[0]);
  }
  return tokens;
}

/** Token-set Jaccard similarity, 0..1. See queryValidation module doc for why
 * this replaces Levenshtein for near-duplicate detection: edit distance is
 * the wrong signal for Boolean strings ("Senior"→"Staff" is 5 edits but a
 * genuinely different query; reordering an OR clause is ~40 edits but the
 * same query). */
export function querySimilarity(a: string, b: string): number {
  const setA = new Set(tokenizeQuery(a));
  const setB = new Set(tokenizeQuery(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ---------------------------------------------------------------------------
// Platform -> allowed site: hosts, read from the platform registry so the
// validator and the template engine can never disagree about a platform.
//
// 'Resumes' is the open-web pass (filetype:pdf / SlideShare), so its site:
// value isn't pinned to a host list; Xing additionally permits a bare
// country TLD (site:.de) for its geo-domain variant.
// ---------------------------------------------------------------------------

function allowedHostsFor(platform: CandidatePlatform): Set<string> {
  return new Set(getPlatformMeta(platform).hosts);
}

const GEO_TLD_RE = /^\.[a-z]{2,}(\.[a-z]{2,})?$/i;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const ANCHOR_RE = /\b(site|filetype|inurl):\S+/i;
const SITE_RE = /\bsite:([^\s()]+)/gi;
const DEPRECATED_RE = /\b(link|define|inanchor):\S+|(^|\s)\+\w|(^|\s)~\w|\b\d{4}\.\.\d{4}\b/i;
const DOUBLE_OPERATOR_RE = /\b(AND|OR)\s+(AND|OR)\b/;
const DANGLING_START_RE = /^(AND|OR)\b/;
const DANGLING_END_RE = /\b(AND|OR|-)$/;
const BARE_NEGATION_RE = /(^|\s)-(\s|$)/;
const EMPTY_GROUP_RE = /\(\s*\)/;
const EMPTY_QUOTES_RE = /""/;

/**
 * Validates one query in isolation (no bundle-level checks — see
 * validateBundle for dedupe/limit checks that need the whole set).
 */
// `constraints` is kept in the signature (the estimate route passes it) for
// checks that will need it later — cache keys and budget — but host allow-
// listing is now per query platform, not per selected-platform union.
export function validateQuery(query: XRayQuery, _constraints: MergedConstraints): QueryValidationResult {
  const issues: ValidationIssue[] = [];
  const raw = query.query_string ?? '';
  const canonical = canonicalizeQueryString(raw);

  const err = (code: IssueCode, message: string) => issues.push({ code, severity: 'error', message });
  const warn = (code: IssueCode, message: string) => issues.push({ code, severity: 'warning', message });

  if (canonical.length === 0) {
    err('EMPTY', 'Query is empty.');
    // Nothing else is checkable on an empty string.
    return { queryId: query.id, ok: false, canonical, issues };
  }

  if (canonical.length < MIN_QUERY_LENGTH) {
    err('TOO_SHORT', `Query is only ${canonical.length} characters (minimum ${MIN_QUERY_LENGTH}) — too short to be a meaningful X-Ray query.`);
  }
  if (canonical.length > MAX_QUERY_LENGTH) {
    err('TOO_LONG', `Query is ${canonical.length} characters, over Google's practical ${MAX_QUERY_LENGTH}-character limit.`);
  }

  const quoteCount = (canonical.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    err('UNBALANCED_QUOTES', 'Unbalanced quotes — an odd number of " characters.');
  }
  if (EMPTY_QUOTES_RE.test(canonical)) {
    err('EMPTY_GROUP', 'Contains an empty quoted string ("").');
  }

  let depth = 0;
  let parensBalanced = true;
  for (const ch of canonical) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) {
        parensBalanced = false;
        break;
      }
    }
  }
  if (!parensBalanced || depth !== 0) {
    err('UNBALANCED_PARENS', 'Unbalanced parentheses.');
  }
  if (EMPTY_GROUP_RE.test(canonical)) {
    err('EMPTY_GROUP', 'Contains an empty group "()".');
  }

  if (!ANCHOR_RE.test(canonical)) {
    err(
      'NO_ANCHOR',
      'No site:, filetype:, or inurl: anchor — an unanchored query returns open-web noise and isn’t worth a credit.'
    );
  }

  const platformMeta = getPlatformMeta(query.platform);
  const allowedHosts = allowedHostsFor(query.platform);
  let siteMatch: RegExpExecArray | null;
  SITE_RE.lastIndex = 0;
  while ((siteMatch = SITE_RE.exec(canonical))) {
    const value = siteMatch[1];
    const host = value.split('/')[0];
    if (GEO_TLD_RE.test(host)) {
      if (!platformMeta.allowGeoTld) {
        err('SITE_NOT_ALLOWED', `"site:${host}" is a bare country domain — only the Xing geo-domain variant may use one.`);
      }
      continue;
    }
    if (!HOSTNAME_RE.test(host)) {
      err('MALFORMED_SITE', `"site:${value}" doesn't look like a valid hostname.`);
      continue;
    }
    if (platformMeta.anyHost) continue;
    const bareHost = host.replace(/^www\./, '');
    const allowed = Array.from(allowedHosts).some((h) => bareHost === h || bareHost.endsWith('.' + h));
    if (!allowed) {
      err(
        'SITE_NOT_ALLOWED',
        `"site:${host}" isn't a ${platformMeta.label} domain (${Array.from(allowedHosts).join(', ')}).`
      );
    }
  }

  if (DOUBLE_OPERATOR_RE.test(canonical)) {
    err('DOUBLE_OPERATOR', 'Contains a doubled operator (e.g. "AND OR", "OR OR").');
  }
  if (DANGLING_START_RE.test(canonical) || DANGLING_END_RE.test(canonical)) {
    err('DANGLING_OPERATOR', 'Query starts or ends with a bare AND/OR/- with nothing to operate on.');
  }
  if (BARE_NEGATION_RE.test(canonical)) {
    err('BARE_NEGATION', 'Contains a "-" with no term attached to it.');
  }

  // Google counts every word, including each word inside a quoted phrase, and
  // ignores everything past the 32nd — the same count the query modal shows.
  const words = countGoogleWords(canonical);
  if (words > GOOGLE_WORD_LIMIT) {
    warn(
      'TOO_MANY_TERMS',
      `${words} words — Google silently truncates past ${GOOGLE_WORD_LIMIT} words, so anything beyond that is paid for and ignored.`
    );
  }

  if (DEPRECATED_RE.test(canonical)) {
    warn('DEPRECATED_OPERATOR', 'Uses an operator (link:, define:, +term, ~term, inanchor:, or a YYYY..YYYY range) that search engines now ignore or treat unreliably.');
  }

  return {
    queryId: query.id,
    ok: !issues.some((i) => i.severity === 'error'),
    canonical,
    issues,
  };
}

/**
 * Validates a full query bundle: per-query checks plus bundle-level ones
 * (near-duplicate detection, run/platform limits) that need to see the whole
 * set at once.
 */
export function validateBundle(queries: XRayQuery[], constraints: MergedConstraints): QueryValidationResult[] {
  const results = queries.map((q) => validateQuery(q, constraints));

  // Near-duplicate detection: the LATER query in array order is flagged, so
  // the first occurrence of a given query always survives.
  for (let i = 0; i < queries.length; i++) {
    for (let j = 0; j < i; j++) {
      if (querySimilarity(results[i].canonical, results[j].canonical) >= DUPLICATE_SIMILARITY_THRESHOLD) {
        results[i].issues.push({
          code: 'DUPLICATE_OF',
          severity: 'error',
          message: `Near-duplicate of query "${queries[j].id}" — ${Math.round(
            querySimilarity(results[i].canonical, results[j].canonical) * 100
          )}% token overlap.`,
        });
        results[i].duplicateOfId = queries[j].id;
        results[i].ok = false;
        break;
      }
    }
  }

  // Whole-run cap.
  if (queries.length > MAX_QUERIES_PER_RUN) {
    for (let i = MAX_QUERIES_PER_RUN; i < queries.length; i++) {
      results[i].issues.push({
        code: 'BUNDLE_LIMIT',
        severity: 'error',
        message: `Run has ${queries.length} queries — only the first ${MAX_QUERIES_PER_RUN} are allowed per run.`,
      });
      results[i].ok = false;
    }
  }

  // Per-platform cap.
  const seenPerPlatform = new Map<CandidatePlatform, number>();
  for (let i = 0; i < queries.length; i++) {
    const platform = queries[i].platform;
    const count = (seenPerPlatform.get(platform) ?? 0) + 1;
    seenPerPlatform.set(platform, count);
    if (count > MAX_QUERIES_PER_PLATFORM) {
      results[i].issues.push({
        code: 'PLATFORM_LIMIT',
        severity: 'error',
        message: `${count}th query targeting ${platform} — only ${MAX_QUERIES_PER_PLATFORM} per platform are allowed per run.`,
      });
      results[i].ok = false;
    }
  }

  return results;
}
