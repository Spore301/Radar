import { CandidatePlatform } from '../types';

// ---------------------------------------------------------------------------
// Platform registry — the single source of truth for which X-Ray platforms
// exist. Isomorphic (no server-only imports) so the UI, the query builder,
// the validator and the SERP indexer all agree on the same closed list.
// ---------------------------------------------------------------------------

export type PlatformCategory = 'Professional' | 'Engineering' | 'Design' | 'Open web';

export interface PlatformMeta {
  id: CandidatePlatform;
  label: string;
  category: PlatformCategory;
  description: string;
  /** Hostnames a `site:` operator may target for this platform. */
  hosts: string[];
  /** True when queries may also use a bare TLD (`site:.de`) — Xing's geo-domain variant. */
  allowGeoTld?: boolean;
  /** True when results may come from any host (open-web resume / presentation pass). */
  anyHost?: boolean;
  /** Official brand colour (hex) used for the logo when rendered in colour. */
  brandColor: string;
}

export const PLATFORMS: readonly PlatformMeta[] = [
  {
    id: 'LinkedIn',
    label: 'LinkedIn',
    category: 'Professional',
    description: 'Public /in/ profiles: broad, title-anchored, proximity and PDF variants.',
    hosts: ['linkedin.com'],
    brandColor: '#0A66C2',
  },
  {
    id: 'GitHub',
    label: 'GitHub',
    category: 'Engineering',
    description: 'Developer bios and READMEs, optionally anchored to a location.',
    hosts: ['github.com'],
    brandColor: '#181717',
  },
  {
    id: 'StackOverflow',
    label: 'Stack Overflow',
    category: 'Engineering',
    description: 'User pages by tag / skill, with a passive-candidate variant.',
    hosts: ['stackoverflow.com'],
    brandColor: '#F58025',
  },
  {
    id: 'Wellfound',
    label: 'Wellfound',
    category: 'Professional',
    description: 'Startup talent profiles (formerly AngelList Talent).',
    hosts: ['wellfound.com', 'angel.co'],
    brandColor: '#000000',
  },
  {
    id: 'Behance',
    label: 'Behance',
    category: 'Design',
    description: 'Designer portfolios by discipline and tool.',
    hosts: ['behance.net'],
    brandColor: '#1769FF',
  },
  {
    id: 'Dribbble',
    label: 'Dribbble',
    category: 'Design',
    description: 'Designer profiles by discipline and tool.',
    hosts: ['dribbble.com'],
    brandColor: '#EA4C89',
  },
  {
    id: 'Xing',
    label: 'Xing',
    category: 'Professional',
    description: 'DACH-region profiles, plus a country-domain variant.',
    hosts: ['xing.com'],
    allowGeoTld: true,
    brandColor: '#006567',
  },
  {
    id: 'Resumes',
    label: 'Resumes / CVs',
    category: 'Open web',
    description: 'Open-web PDF resumes and conference / SlideShare decks.',
    hosts: ['slideshare.net'],
    anyHost: true,
    brandColor: '#4262FF',
  },
  {
    id: 'MultiSite',
    label: 'Multi-site pass',
    category: 'Open web',
    description: 'One combined sweep over LinkedIn, GitHub and Stack Overflow.',
    hosts: ['linkedin.com', 'github.com', 'stackoverflow.com'],
    brandColor: '#1C1C1E',
  },
] as const;

export const PLATFORM_IDS: readonly CandidatePlatform[] = PLATFORMS.map((p) => p.id);

const PLATFORM_BY_ID = new Map<CandidatePlatform, PlatformMeta>(PLATFORMS.map((p) => [p.id, p]));

export function getPlatformMeta(id: CandidatePlatform): PlatformMeta {
  return PLATFORM_BY_ID.get(id) ?? PLATFORMS[0];
}

export function platformLabel(id: CandidatePlatform | string): string {
  return PLATFORM_BY_ID.get(id as CandidatePlatform)?.label ?? String(id);
}

export function isKnownPlatform(value: unknown): value is CandidatePlatform {
  return typeof value === 'string' && PLATFORM_BY_ID.has(value as CandidatePlatform);
}

// Loose spellings an LLM (or an older saved job) might emit → canonical id.
// Retired platforms (Naukri, Indeed, Bitbucket, Web) intentionally resolve to
// null so they are dropped rather than silently remapped.
const ALIASES: Record<string, CandidatePlatform> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  stackoverflow: 'StackOverflow',
  'stack overflow': 'StackOverflow',
  'stack-overflow': 'StackOverflow',
  wellfound: 'Wellfound',
  angellist: 'Wellfound',
  'angel list': 'Wellfound',
  'wellfound (angellist)': 'Wellfound',
  behance: 'Behance',
  dribbble: 'Dribbble',
  xing: 'Xing',
  resumes: 'Resumes',
  resume: 'Resumes',
  'resumes / cvs': 'Resumes',
  'resumes/cvs': 'Resumes',
  cvs: 'Resumes',
  'open web': 'Resumes',
  multisite: 'MultiSite',
  'multi-site': 'MultiSite',
  'multi site': 'MultiSite',
  'multi-site pass': 'MultiSite',
  combined: 'MultiSite',
};

export function normalizePlatform(value: unknown): CandidatePlatform | null {
  if (typeof value !== 'string') return null;
  if (isKnownPlatform(value)) return value;
  return ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * Works out which platform a result URL actually belongs to. Needed because the
 * multi-site pass, the Xing geo-domain variant and the open-web resume pass
 * all return URLs from several hosts, and a candidate card should carry the
 * logo of the site the profile really lives on.
 */
export function detectPlatformFromUrl(url: string): CandidatePlatform | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  const endsWith = (h: string) => host === h || host.endsWith('.' + h);

  if (endsWith('linkedin.com')) return 'LinkedIn';
  if (endsWith('github.com') || endsWith('github.io')) return 'GitHub';
  if (endsWith('stackoverflow.com') && path.startsWith('/users')) return 'StackOverflow';
  if (endsWith('wellfound.com') || endsWith('angel.co')) return 'Wellfound';
  if (endsWith('behance.net')) return 'Behance';
  if (endsWith('dribbble.com')) return 'Dribbble';
  if (endsWith('xing.com')) return 'Xing';
  if (endsWith('slideshare.net') || path.endsWith('.pdf') || path.endsWith('.ppt') || path.endsWith('.pptx')) {
    return 'Resumes';
  }
  return null;
}
