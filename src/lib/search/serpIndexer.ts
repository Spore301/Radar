import { CandidatePlatform, CandidateProfile, MergedConstraints, XRayQuery } from '../types';
import { calculateRelevanceScore } from '../utils/scoring';
import { detectPlatformFromUrl } from './platforms';
import { ANY_CITY_RE, detectCityInText, cityDisplay } from './location';
import type { RawSearchResult } from './serp';

// ---------------------------------------------------------------------------
// SERP indexer — turns one organic search result into one CandidateProfile,
// using nothing but what the search engine already indexed (title, snippet,
// URL, thumbnail). It never fetches the profile page and never drops a result
// for being weak: relevance is computed and attached, but the decision to
// show or hide belongs to the recruiter's filters in the dashboard.
//
// The only results rejected here are ones that are not a person's profile at
// all (job posts, company pages, login walls, search pages).
// ---------------------------------------------------------------------------

export const UNKNOWN_LOCATION = 'Location not specified';
export const PLACEHOLDER_NAME = 'Unnamed profile';

const NON_PROFILE_PATH_FRAGMENTS = [
  '/jobs/',
  '/jobs?',
  '/job/',
  '/careers',
  '/job-listings',
  '/search',
  '/topics/',
  '/login',
  '/signup',
  '/auth',
  '/terms',
  '/privacy',
  '/pulse/',
  '/posts/',
  '/feed/',
  '/company/',
  '/companies/',
  '/school/',
  '/events/',
  '/learning/',
  '/help/',
  '/legal/',
  '/404',
];

const GITHUB_RESERVED = new Set([
  'features', 'pricing', 'about', 'orgs', 'trending', 'topics', 'marketplace', 'explore', 'sponsors',
  'settings', 'login', 'join', 'search', 'collections', 'events', 'readme', 'site', 'security',
  'enterprise', 'team', 'customer-stories', 'blog', 'contact', 'apps', 'organizations', 'notifications',
  'issues', 'pulls', 'codespaces', 'new', 'discussions',
]);

/**
 * Is this URL a person's profile (or resume) rather than a listing / company /
 * utility page? Platform-aware, but deliberately permissive: a `site:` query
 * already scopes the host, so we only reject shapes we know are not people.
 */
export function isCandidateProfileUrl(url: string, platform: CandidatePlatform): boolean {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;

  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    path = u.pathname.toLowerCase();
  } catch {
    return false;
  }

  const lower = `${host}${path}`;
  if (NON_PROFILE_PATH_FRAGMENTS.some((frag) => lower.includes(frag))) return false;

  switch (platform) {
    case 'LinkedIn':
      // Needs an actual slug: a bare /in/ is the sign-in wall, not a person.
      return /(^|\.)linkedin\.com$/.test(host) && /^\/in\/[^/]+/.test(path);
    case 'GitHub': {
      if (host.endsWith('github.io')) return true;
      if (!/(^|\.)github\.com$/.test(host)) return false;
      const first = path.split('/').filter(Boolean)[0];
      return Boolean(first) && !GITHUB_RESERVED.has(first);
    }
    case 'StackOverflow':
      return /(^|\.)stackoverflow\.com$/.test(host) && /^\/users\/\d+/.test(path);
    case 'Wellfound':
      return /(^|\.)(wellfound\.com|angel\.co)$/.test(host) && !path.startsWith('/jobs') && !path.startsWith('/role/');
    case 'Behance':
      return /(^|\.)behance\.net$/.test(host) && !path.startsWith('/galleries') && !path.startsWith('/joblist');
    case 'Dribbble':
      return /(^|\.)dribbble\.com$/.test(host) && !path.startsWith('/shots/') && !path.startsWith('/tags/');
    case 'Xing':
      // The geo-domain variant (site:.de) legitimately returns non-Xing hosts.
      if (/(^|\.)xing\.com$/.test(host)) return path.startsWith('/profile/');
      return true;
    case 'Resumes':
    case 'MultiSite':
    default:
      return true;
  }
}

/**
 * Collapses variants of the same profile to one key: lower-cased, no query,
 * hash or trailing slash, and a GitHub repo URL collapses to its owner so
 * three repos from one developer index as one person.
 */
export function canonicalProfileUrl(url: string, platform: CandidatePlatform): string {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');

    if (platform === 'LinkedIn') {
      // in.linkedin.com/in/x, uk.linkedin.com/in/x and linkedin.com/in/x are one profile.
      host = 'linkedin.com';
    }
    if (platform === 'GitHub' && host === 'github.com') {
      const owner = path.split('/').filter(Boolean)[0];
      path = owner ? `/${owner}` : path;
    }
    if (platform === 'StackOverflow') {
      // /users/123/display-name → /users/123 (the slug can change, the id can't)
      const m = path.match(/^\/users\/(\d+)/);
      if (m) path = `/users/${m[1]}`;
    }
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

const TITLE_SUFFIX =
  /\s*[-–—|•·:]\s*(LinkedIn|GitHub|Stack Overflow|Dribbble|Behance|XING|Xing|Wellfound|AngelList|SlideShare)\b.*$/i;

/**
 * Splits a SERP title into (name, headline) for the platform's title format.
 * Returns PLACEHOLDER_NAME when the title clearly isn't a person's name so the
 * deduper knows not to merge on it.
 */
export function parseNameAndHeadline(title: string, platform: CandidatePlatform): { name: string; headline: string } {
  const cleaned = (title || '').replace(TITLE_SUFFIX, '').trim();

  if (platform === 'GitHub') {
    // "owner/repo: description" → name owner, headline description
    const repo = cleaned.match(/^([\w.-]+)\/([\w.-]+)\s*[:\-–]?\s*(.*)$/);
    if (repo) {
      return { name: repo[1], headline: repo[3] || `Maintains ${repo[2]} on GitHub` };
    }
    // "display-name (Full Name)" → Full Name
    const paren = cleaned.match(/^([\w.-]+)\s*\(([^)]+)\)\s*(.*)$/);
    if (paren) {
      return { name: paren[2].trim(), headline: paren[3].trim() || `GitHub: ${paren[1]}` };
    }
  }

  if (platform === 'Resumes') {
    const stripped = cleaned.replace(/\.(pdf|pptx?)$/i, '').replace(/[_]+/g, ' ').trim();
    const nameLike = stripped.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,3})\b/);
    // "Rohit Menon Resume" → "Rohit Menon"
    const personName = nameLike ? nameLike[1].replace(/\s+(Resume|CV|Curriculum Vitae|Profile|Portfolio)$/i, '').trim() : null;
    return {
      name: personName || PLACEHOLDER_NAME,
      headline: stripped.slice(0, 120) || 'Resume / CV document',
    };
  }

  const parts = cleaned.split(/\s*[-–—|•·]\s*/).map((p) => p.trim()).filter(Boolean);
  let name = parts[0] ?? '';
  let headline = parts.slice(1).join(' · ');

  // Stack Overflow titles are "User Display Name - Stack Overflow".
  if (platform === 'StackOverflow') {
    name = name.replace(/^User\s+/i, '');
    headline = headline || 'Stack Overflow contributor';
  }

  // "Name on Behance", "Name's profile" style titles
  name = name.replace(/\s+on\s+(Behance|Dribbble)$/i, '').replace(/['’]s\s+(profile|portfolio)$/i, '');

  const junk = /\b(log in|sign in|sign up|search|home|jobs?|hiring|careers?|top \d+|best|profiles?|users?)\b/i;
  if (!name || name.length > 60 || junk.test(name) || /^\d+$/.test(name)) {
    headline = headline || name;
    name = PLACEHOLDER_NAME;
  }

  return { name, headline: headline || '' };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function skillPattern(skill: string): RegExp {
  const escaped = escapeRegExp(skill.trim());
  // Skills like "C++" or ".NET" don't sit on word boundaries; only assert them
  // when the term starts/ends with a word character.
  const lead = /^\w/.test(skill) ? '\\b' : '';
  const tail = /\w$/.test(skill) ? '\\b' : '';
  return new RegExp(`${lead}${escaped}${tail}`, 'i');
}

export function detectSkills(text: string, constraints: MergedConstraints): string[] {
  const targets = [...(constraints.must_have_skills || []), ...(constraints.nice_to_have_skills || [])];
  const found: string[] = [];
  for (const skill of targets) {
    if (!skill.trim()) continue;
    if (skillPattern(skill).test(text) && !found.some((f) => f.toLowerCase() === skill.toLowerCase())) {
      found.push(skill);
    }
  }
  return found;
}

/**
 * LinkedIn snippets start with the profile location ("Bengaluru, Karnataka,
 * India · Senior Product Designer · Acme"); other platforms rarely expose one.
 * Falls back to the shared city table. Never borrows the JD's location — an
 * unknown location must stay unknown so scoring and dedupe don't treat every
 * profile as living where the job is.
 */
export function detectLocation(snippet: string, fullText: string): string {
  const lead = snippet.split(/\s[·•|]\s/)[0]?.trim() ?? '';
  if (lead && lead.length <= 60 && /,/.test(lead) && !/\d/.test(lead) && !/[:]/.test(lead) && /^[A-Z]/.test(lead) && !/\b(years?|experience|skills?|tags?)\b/i.test(lead)) {
    return lead;
  }
  const city = detectCityInText(fullText);
  if (city) return cityDisplay(city);
  if (/\bremote\b/i.test(fullText)) return 'Remote';
  const country = fullText.match(/\b(india|germany|united kingdom|united states|canada|australia|singapore|netherlands|france)\b/i);
  return country ? country[1].replace(/\b\w/g, (m) => m.toUpperCase()) : UNKNOWN_LOCATION;
}

// Kept for callers that only need a boolean "mentions a city".
export const LOCATION_HINTS = ANY_CITY_RE;

const SENIORITY_IN_HEADLINE = /\b(principal|staff|senior|sr\.?|lead|head of|director|vp|chief|junior|jr\.?|intern|associate)\b/i;

export function detectSeniority(text: string): string {
  const m = text.match(SENIORITY_IN_HEADLINE);
  if (!m) return '';
  const word = m[1].toLowerCase().replace('.', '');
  if (word === 'sr') return 'Senior';
  if (word === 'jr') return 'Junior';
  if (word === 'head of' || word === 'vp' || word === 'director' || word === 'chief') return 'Executive';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function detectExperienceYears(text: string): number | null {
  const m = text.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 && n < 50 ? n : null;
}

// --- Title gates -----------------------------------------------------------
//
// The URL tells us the host; the title tells us whether the page is a person.
// Job posts, company pages, articles and templates all live on hosts that also
// host profiles, so every result passes these, and low-precision sources (the
// country-domain sweep, open-web PDFs) must additionally look like a person.

const JOB_POST_TITLE =
  /\b(hiring|job|jobs|vacanc(y|ies)|career|careers|opening|openings|apply|recruit(ing|ment)|walk-?in|we are looking|is looking for|urgent|freshers?|salary|naukri|indeed|glassdoor|internship)\b/i;
const ORG_TITLE =
  /\b(group|inc\.?|ltd\.?|llc|llp|pvt|private limited|limited|corp(oration)?|company|consulting|technologies|solutions|systems|labs|studio|agency|university|college|institute|school|foundation|ministry|government|bank|official)\b/i;
const ARTICLE_TITLE =
  /^(what|why|how|when|where|top|best|the|a|an|guide|introduction|understanding|\d+)\b|\b(guide|tips|trends|news|blog|article|report|whitepaper|webinar|podcast|episode|template|sample|example|format|checklist|course|tutorial|pricing|login|sign ?in|download)\b/i;
const NAME_LIKE = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,3}(?=$|\s*[-–—|,(·])/;

/** A page whose title reads like a listing, an organisation or an article — not a person. */
/** "Rohit_Menon_Resume.pdf" → "Rohit Menon Resume": file names are titles too. */
function normalizeTitle(title: string): string {
  return (title || '').replace(/\.(pdf|docx?|pptx?|txt)$/i, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function isNonPersonTitle(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return true;
  if (JOB_POST_TITLE.test(t)) return true;
  // Article openers ("What changed…", "Top 10…") can sit after a dash: test every segment.
  return t.split(/\s*[-–—|:]\s*/).some((seg) => ARTICLE_TITLE.test(seg.trim()));
}

/** Title begins with a plausible person name and doesn't read as an organisation. */
export function looksLikePersonTitle(title: string): boolean {
  const t = normalizeTitle(title);
  const m = t.match(NAME_LIKE);
  if (!m) return false;
  const first = m[0].split(/\s+/)[0];
  // "AI Developments", "IBM Research": an all-caps acronym never opens a person's name.
  if (/^[A-Z]{2,}$/.test(first.replace(/[.'’-]/g, ''))) return false;
  return !ORG_TITLE.test(m[0]) && !JOB_POST_TITLE.test(t);
}

/** Sources where the host alone proves nothing, so the title must carry the burden. */
function isLowPrecisionSource(url: string, platform: CandidatePlatform): boolean {
  if (platform === 'Resumes') return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (platform === 'Xing' && !/(^|\.)xing\.com$/.test(host)) return true; // site:.de / site:.in sweep
    if (platform === 'GitHub' && host.endsWith('github.io')) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Indexes one SERP result as a candidate. Returns null only when the URL is
 * not a profile-shaped page for its platform, or the title says the page is a
 * job post, an organisation, an article or a template rather than a person.
 */
export function indexSerpResult(
  result: RawSearchResult,
  query: XRayQuery,
  constraints: MergedConstraints,
  jobId: string
): CandidateProfile | null {
  const platform = detectPlatformFromUrl(result.url) ?? query.platform;
  if (!isCandidateProfileUrl(result.url, platform)) return null;
  if (isNonPersonTitle(result.title)) return null;
  if (isLowPrecisionSource(result.url, platform) && !looksLikePersonTitle(result.title)) return null;

  const { name, headline } = parseNameAndHeadline(result.title, platform);
  if (name !== PLACEHOLDER_NAME && ORG_TITLE.test(name)) return null;
  const fullText = `${result.title} ${result.snippet}`;
  const skills = detectSkills(fullText, constraints);
  const location = detectLocation(result.snippet, fullText);
  const seniority = detectSeniority(headline || result.title);
  const years = detectExperienceYears(result.snippet);

  const { overall_score, match_breakdown, match_rationale, missing_signals } = calculateRelevanceScore(
    skills,
    seniority,
    location,
    headline,
    constraints
  );

  // Rough sense of how much the SERP actually told us about this person.
  let completeness = 0.3;
  if (name !== PLACEHOLDER_NAME) completeness += 0.2;
  if (headline) completeness += 0.15;
  if (location !== UNKNOWN_LOCATION) completeness += 0.15;
  if (skills.length > 0) completeness += 0.1;
  if (result.thumbnail) completeness += 0.05;
  if (years !== null) completeness += 0.05;

  const canonical = canonicalProfileUrl(result.url, platform);

  return {
    id: `cand-${jobId}-${hashKey(canonical)}`,
    job_id: jobId,
    name,
    headline: headline || `${platform} profile`,
    location,
    profile_url: result.url,
    platform,
    avatar_url: result.thumbnail ?? null,
    skills_detected: skills,
    experience_years_estimated: years,
    summary_snippet: (result.snippet || headline || result.title).slice(0, 300),
    match_score: overall_score,
    match_breakdown,
    match_rationale,
    missing_signals,
    data_completeness: Math.min(1, Math.round(completeness * 100) / 100),
    raw_scraped_data: {
      serp_title: result.title,
      serp_position: result.position ?? null,
      canonical_url: canonical,
      query_type: query.query_type,
    },
    source_query: query.id,
    scrape_status: 'snippet_only',
    status: 'New',
    discovered_at: new Date().toISOString(),
  };
}

/** Small, stable, dependency-free hash so the same profile gets the same id across runs. */
function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
