import { CandidateProfile } from '../types';
import { PLACEHOLDER_NAME, UNKNOWN_LOCATION } from '../search/serpIndexer';
import { findCityInText, findCountryInText, KNOWN_REGIONS } from '../search/location';
import { deriveCandidateFacets, isCandidateFacets, locationSpecificity } from '../search/facets';
import type { CandidateLocationFacets } from '../types';

/**
 * Calculates Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const str1 = a.toLowerCase().trim();
  const str2 = b.toLowerCase().trim();

  for (let i = 0; i <= str1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str1.length; i++) {
    for (let j = 1; j <= str2.length; j++) {
      if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str1.length][str2.length];
}

/**
 * True when a name is specific enough to identify a person: not the indexer's
 * placeholder, and at least two words. Merging on anything weaker would
 * collapse unrelated profiles into one card and hide them from the dashboard.
 */
function isIdentifyingName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== PLACEHOLDER_NAME && trimmed.length >= 5 && /\s/.test(trimmed);
}

function candidateKey(candidate: CandidateProfile): string {
  const canonical = candidate.raw_scraped_data?.canonical_url;
  if (typeof canonical === 'string' && canonical) return canonical;
  return candidate.profile_url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * The place a location string pins down to city level, as a comparable key —
 * or null when it is unknown, "Remote" or only a country. Two people with the
 * same common name "in India" are not the same person, so a country-only or
 * remote location can never support a fuzzy merge (a wrong merge hides a real
 * candidate from the dashboard).
 */
function cityLevelKey(location: string): string | null {
  const loc = (location || '').trim();
  if (!loc || loc === UNKNOWN_LOCATION || /^remote$/i.test(loc)) return null;
  const city = findCityInText(loc);
  if (city) return `city:${city.name}`;
  const parts = loc.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  // A single segment the city table doesn't know is a country or a region ("Portugal", "India");
  // "Remote, India" and "Tamil Nadu, India" are no more specific than the country.
  if (parts.length < 2 || /^remote\b/.test(parts[0]) || KNOWN_REGIONS.has(parts[0]) || findCountryInText(parts[0])) return null;
  return `town:${parts[0]}`;
}

/** The location test used by the fuzzy pass: both locations name the same city (any alias). */
function shareLocation(a: string, b: string): boolean {
  const ka = cityLevelKey(a);
  return ka !== null && ka === cityLevelKey(b);
}

/**
 * The fuzzy half of the dedupe rule on its own: is `candidate` the same person
 * as one of `pool` (identifying name within Levenshtein 2, and a shared known
 * location)? Used by the background worker, which persists each query as it
 * lands and so has to match against what is already stored for the session.
 */
export function findFuzzyDuplicate<T extends { name: string; location: string }>(candidate: { name: string; location: string }, pool: T[]): T | null {
  if (!isIdentifyingName(candidate.name) || candidate.location === UNKNOWN_LOCATION) return null;
  for (const existing of pool) {
    if (!isIdentifyingName(existing.name) || existing.location === UNKNOWN_LOCATION) continue;
    if (levenshteinDistance(candidate.name, existing.name) <= 2 && shareLocation(candidate.location, existing.location)) return existing;
  }
  return null;
}

/**
 * Deduplicates candidates based on:
 * 1. Exact match on canonical profile URL (never loses a distinct profile)
 * 2. Fuzzy match on name (Levenshtein <= 2) AND location similarity — only
 *    when BOTH profiles carry a real, identifying name and a known location,
 *    so two "Unnamed profile" hits or two location-less hits are never merged.
 */
export function deduplicateCandidates(candidates: CandidateProfile[]): CandidateProfile[] {
  const deduplicated: CandidateProfile[] = [];
  const seenUrls = new Set<string>();

  const byUrl = new Map<string, CandidateProfile>();
  for (const candidate of candidates) {
    const cleanUrl = candidateKey(candidate);
    if (seenUrls.has(cleanUrl)) {
      // Same profile from another query: keep the first card, but take the
      // more specific location if this result stated one (a later query's
      // snippet may show the location line the first one hid).
      const kept = byUrl.get(cleanUrl);
      if (kept) adoptBetterLocation(kept, candidate);
      continue;
    }

    // Check against already accepted deduplicated candidates
    const existing = findFuzzyDuplicate(candidate, deduplicated);
    const isDuplicate = existing !== null;
    if (existing) {
      // Merge skills and pick higher match score if duplicate found
      existing.skills_detected = Array.from(new Set([...existing.skills_detected, ...candidate.skills_detected]));
      if (candidate.match_score > existing.match_score) {
        existing.match_score = candidate.match_score;
        existing.match_breakdown = candidate.match_breakdown;
      }
    }

    seenUrls.add(cleanUrl);
    if (!isDuplicate) deduplicated.push(candidate);
    // A later hit on this URL improves whichever card now stands for it — the
    // candidate itself, or the card it was fuzzy-merged into.
    byUrl.set(cleanUrl, existing ?? candidate);
  }

  return deduplicated;
}

/** Copies `other`'s location and location facets onto `kept` when they are more specific. */
export function adoptBetterLocation(kept: CandidateProfile, other: CandidateProfile): void {
  const keptLoc = kept.facets?.location ?? null;
  const otherLoc = other.facets?.location ?? null;
  if (locationSpecificity(otherLoc) <= locationSpecificity(keptLoc)) return;
  kept.location = other.location;
  if (kept.facets && otherLoc) kept.facets = { ...kept.facets, location: otherLoc };
  else if (other.facets) kept.facets = other.facets;
  if (kept.raw_scraped_data && kept.facets) kept.raw_scraped_data = { ...kept.raw_scraped_data, facets: kept.facets };
  // Both hits were scored against the same requisition, so the adopted
  // location brings its own location score: the card's place and its score agree.
  const before = kept.match_breakdown?.location_score;
  const after = other.match_breakdown?.location_score;
  if (typeof before === 'number' && typeof after === 'number' && before !== after) {
    kept.match_score = Math.max(0, Math.min(100, kept.match_score - before + after));
    kept.match_breakdown = { ...kept.match_breakdown, location_score: after };
  }
}

/** What a stored candidate row holds about its location (the columns persistence reads back). */
export interface StoredLocationRow {
  profileUrl: string;
  location: string;
  rawScrapedData: unknown;
}

/** The stored row's location facets: as stored, or derived from its location string and URL. */
export function storedLocationFacets(row: StoredLocationRow): CandidateLocationFacets {
  const raw = (row.rawScrapedData ?? null) as Record<string, any> | null;
  if (isCandidateFacets(raw?.facets)) return raw.facets.location;
  return deriveCandidateFacets({ profile_url: row.profileUrl, location: row.location }).location;
}

/**
 * The location part of refreshing a stored candidate from a new search result.
 * Re-runs refresh facets, but never downgrade a location: a later query whose
 * snippet hid the location line ("India", from the subdomain) must not
 * overwrite "Bengaluru, Karnataka, India" found earlier. Equal specificity
 * takes the newer value. Returns the location to write (undefined = keep the
 * stored one) and the raw-data JSON to write (facets merged accordingly).
 */
export function planLocationRefresh(
  incoming: Pick<CandidateProfile, 'location' | 'facets' | 'raw_scraped_data'>,
  stored: StoredLocationRow | undefined
): { location?: string; raw?: Record<string, any>; kept?: { facets: CandidateLocationFacets; location: string } } {
  const raw = incoming.raw_scraped_data ?? undefined;
  const known = Boolean(incoming.location) && !/not specified/i.test(incoming.location);
  const replace = { ...(known ? { location: incoming.location } : {}), ...(raw ? { raw } : {}) };
  if (!stored) return replace;
  const oldLoc = storedLocationFacets(stored);
  if (locationSpecificity(oldLoc) <= locationSpecificity(incoming.facets?.location ?? null)) return replace;
  const facets = incoming.facets ? { ...incoming.facets, location: oldLoc } : undefined;
  // `kept` tells the caller the stored location stands, so the location part of
  // the incoming score (worked out from the less specific location) must be redone.
  const kept = { facets: oldLoc, location: stored.location };
  return raw ? { raw: { ...raw, ...(facets ? { facets } : {}) }, kept } : { kept };
}
