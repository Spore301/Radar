import { CandidateProfile } from '../types';
import { PLACEHOLDER_NAME, UNKNOWN_LOCATION } from '../search/serpIndexer';

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
 * Deduplicates candidates based on:
 * 1. Exact match on canonical profile URL (never loses a distinct profile)
 * 2. Fuzzy match on name (Levenshtein <= 2) AND location similarity — only
 *    when BOTH profiles carry a real, identifying name and a known location,
 *    so two "Unnamed profile" hits or two location-less hits are never merged.
 */
export function deduplicateCandidates(candidates: CandidateProfile[]): CandidateProfile[] {
  const deduplicated: CandidateProfile[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of candidates) {
    const cleanUrl = candidateKey(candidate);
    if (seenUrls.has(cleanUrl)) {
      continue;
    }

    // Check against already accepted deduplicated candidates
    let isDuplicate = false;
    const fuzzyEligible =
      isIdentifyingName(candidate.name) && candidate.location !== UNKNOWN_LOCATION;
    for (const existing of fuzzyEligible ? deduplicated : []) {
      if (!isIdentifyingName(existing.name) || existing.location === UNKNOWN_LOCATION) continue;
      const nameDistance = levenshteinDistance(candidate.name, existing.name);

      // If name is very similar (e.g., "Arjun Sharma" vs "Arjun Sharma ")
      if (nameDistance <= 2) {
        // Compare locations
        const loc1 = candidate.location.toLowerCase();
        const loc2 = existing.location.toLowerCase();
        
        const shareLocation =
          loc1.includes(loc2) ||
          loc2.includes(loc1) ||
          (loc1.includes('bangalore') && loc2.includes('bangalore')) ||
          (loc1.includes('remote') && loc2.includes('remote'));

        if (shareLocation) {
          isDuplicate = true;
          // Merge skills and pick higher match score if duplicate found
          existing.skills_detected = Array.from(
            new Set([...existing.skills_detected, ...candidate.skills_detected])
          );
          if (candidate.match_score > existing.match_score) {
            existing.match_score = candidate.match_score;
            existing.match_breakdown = candidate.match_breakdown;
          }
          break;
        }
      }
    }

    seenUrls.add(cleanUrl);
    if (!isDuplicate) {
      deduplicated.push(candidate);
    }
  }

  return deduplicated;
}
