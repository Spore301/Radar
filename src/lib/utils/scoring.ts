import { MergedConstraints, MatchBreakdown, CandidateProfile, CandidateFacets, CandidateLocationFacets } from '../types';
import { locationCountries, parseLocation } from '../search/location';
import { deriveCandidateFacets } from '../search/facets';
import { isSoftSkill } from '../search/xrayTemplates';

/** Whole-name match, tolerant of punctuation inside names ("IIT-B", "S&P Global"). */
function mentions(text: string, org: string): boolean {
  const needle = org.trim().toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text.toLowerCase());
}

export interface ScoringEvidence {
  /** The SERP result title — on LinkedIn "Name – Title – Company | LinkedIn", i.e. the current employer. */
  title?: string;
  /** The SERP snippet — past roles, education, summary. */
  snippet?: string;
  /** Normalised facets for the result (location city / country with its evidence). Derived from the location string when absent. */
  facets?: CandidateFacets | null;
}

/**
 * Location fit, 0–15, from the candidate's location facets:
 *   15  same city (alias-aware), or a remote role and the candidate is in a
 *       target country (or the role names no country at all)
 *   11  same country — a LinkedIn country subdomain counts as evidence
 *    8  unknown, or the role names no location
 *    4  a known location in another country (or another city when no country
 *       is known on either side)
 * Only ever used to sort: a mismatch never removes a candidate.
 */
export function locationFitScore(candidate: CandidateLocationFacets, constraints: MergedConstraints, candidateLocation = ''): number {
  const want = parseLocation(constraints.location);
  const remoteRole = Boolean(constraints.remote_eligible) || want.remote;
  const wantCountries = locationCountries(want).map((c) => c.name);
  const wantCities = want.cities.map((c) => c.name);
  if (!want.display && !remoteRole) return 8;
  if (remoteRole && wantCountries.length === 0 && wantCities.length === 0) return 15;
  if (candidate.city && wantCities.includes(candidate.city)) return 15;
  if (candidate.country && wantCountries.includes(candidate.country)) return remoteRole ? 15 : 11;
  if (!candidate.country && !candidate.city) {
    // A remote-eligible role and a profile that says only "Remote" is still a fit.
    return remoteRole && /\bremote\b/i.test(candidateLocation) ? 11 : 8;
  }
  if (wantCountries.length === 0) {
    // The role names a town the location table doesn't know: match it by name, otherwise we can't tell.
    return want.unknown.some((u) => candidateLocation.toLowerCase().includes(u.toLowerCase())) ? 15 : 8;
  }
  return 4;
}

export function calculateRelevanceScore(
  candidateSkills: string[],
  candidateSeniority: string,
  candidateLocation: string,
  candidateHeadline: string,
  constraints: MergedConstraints,
  evidence: ScoringEvidence = {}
): {
  overall_score: number;
  match_breakdown: MatchBreakdown;
  match_rationale: string;
  missing_signals: string[];
  organization_match: string | null;
} {
  // 1. Must-have Skills Score (Max 35)
  //
  // Soft skills (communication, facilitation, …) never appear in a SERP
  // snippet, so scoring against them would mark every profile "Low". They are
  // moved to the nice-to-have bucket; when no hard skill remains, the domain
  // terms stand in: a snippet that mentions the field earns most of the points.
  const allMustHave = constraints.must_have_skills || [];
  const mustHave = allMustHave.filter((sk) => !isSoftSkill(sk));
  const softMustHave = allMustHave.filter((sk) => isSoftSkill(sk));
  let mustHaveMatchedCount = 0;
  const missingSignals: string[] = [];

  mustHave.forEach((skill) => {
    const hasSkill = candidateSkills.some(
      (s) => s.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(s.toLowerCase())
    );
    if (hasSkill) {
      mustHaveMatchedCount++;
    } else {
      missingSignals.push(`Missing must-have skill: ${skill}`);
    }
  });

  let skills_must_have_score: number;
  if (mustHave.length > 0) {
    skills_must_have_score = Math.round((mustHaveMatchedCount / mustHave.length) * 35);
  } else {
    const domainWords = (constraints.domain || [])
      .flatMap((d) => d.split(/\s*[\/,&]\s*/))
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 2);
    const text = `${candidateHeadline} ${candidateSkills.join(' ')}`.toLowerCase();
    const domainHit = domainWords.some((d) => text.includes(d)) || /\b(ai|machine learning|artificial intelligence|genai|llm)\b/.test(text) && /\bai\b/i.test(constraints.job_title);
    skills_must_have_score = domainHit ? 28 : 17;
    if (!domainHit && domainWords.length) missingSignals.push(`No domain signal (${domainWords.slice(0, 2).join(', ')}) in the indexed snippet`);
  }

  // 2. Nice-to-have Skills Score (Max 10) — soft-skill must-haves are scored here.
  const niceToHave = [...(constraints.nice_to_have_skills || []), ...softMustHave];
  let niceToHaveMatchedCount = 0;

  niceToHave.forEach((skill) => {
    const hasSkill = candidateSkills.some(
      (s) => s.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(s.toLowerCase())
    );
    if (hasSkill) niceToHaveMatchedCount++;
  });

  const skills_nice_to_have_score =
    niceToHave.length > 0 ? Math.round((niceToHaveMatchedCount / niceToHave.length) * 10) : 7;

  // 3. Title & seniority fit (Max 20)
  //
  // A profile whose headline never mentions the role is the main way an
  // off-target result used to score respectably. Headline match against the
  // job title (or its core noun) is worth 12; the seniority word is worth 8.
  const reqSeniority = constraints.seniority.toLowerCase();
  const candSeniority = candidateSeniority.toLowerCase();
  const candHeadline = candidateHeadline.toLowerCase();

  const baseTitle = (constraints.job_title || '')
    .toLowerCase()
    .replace(/\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|head of|chief|associate|mid[- ]level|entry[- ]level)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const titleWords = baseTitle.split(/[\s/&-]+/).filter((w) => w.length > 2);
  const coreNoun = titleWords[titleWords.length - 1] ?? '';
  const swaps: Record<string, string> = { engineer: 'developer', developer: 'engineer', designer: 'design' };

  let titlePart = 0;
  if (baseTitle && candHeadline.includes(baseTitle)) {
    titlePart = 12;
  } else if (coreNoun && (candHeadline.includes(coreNoun) || (swaps[coreNoun] && candHeadline.includes(swaps[coreNoun])))) {
    const modifierHit = titleWords.slice(0, -1).some((w) => candHeadline.includes(w));
    titlePart = modifierHit ? 10 : 6;
  } else {
    missingSignals.push(`Headline "${candidateHeadline}" does not mention the role (${constraints.job_title})`);
  }

  let seniorityPart = 2;
  if (reqSeniority === 'any') {
    seniorityPart = 6;
  } else if (candSeniority.includes(reqSeniority) || candHeadline.includes(reqSeniority)) {
    seniorityPart = 8;
  } else if (reqSeniority === 'senior' && /\b(lead|staff|principal)\b/.test(candHeadline)) {
    seniorityPart = 7;
  } else if (reqSeniority === 'mid' && /\bsenior\b/.test(candHeadline)) {
    seniorityPart = 6;
  } else if (!candSeniority) {
    seniorityPart = 4; // unknown, not contradicted
  } else {
    missingSignals.push(`Seniority fit: headline reads ${candidateSeniority}, expected ${constraints.seniority}`);
  }
  const seniority_score = titlePart + seniorityPart;

  // 4. Location / Remote Fit (Max 15) — from facets, so a LinkedIn country
  // subdomain counts as country evidence even when the snippet hid the
  // location line. See locationFitScore.
  const locFacets =
    evidence.facets?.location ?? deriveCandidateFacets({ profile_url: '', location: candidateLocation }).location;
  const location_score = locationFitScore(locFacets, constraints, candidateLocation);
  if (location_score === 4) {
    missingSignals.push(`Location: profile says ${candidateLocation}, role is ${constraints.location}`);
  }

  // 5. Domain Overlap (Max 10)
  let domain_score = 8;
  const domains = constraints.domain || [];
  const textSample = `${candidateHeadline} ${candidateSkills.join(' ')}`.toLowerCase();

  const domainMatch = domains.some((d) => textSample.includes(d.toLowerCase()));
  if (domainMatch) {
    domain_score = 10;
  }

  // 6. Organisation (Max 10)
  //
  // A hard constraint enforced by the query itself, so this is about evidence
  // and ranking, never filtering: the name in the page TITLE means current
  // employer (LinkedIn titles are "Name – Title – Company"), in the snippet
  // means it appears somewhere in the history. An excluded organisation that
  // still shows up is a violation the query missed — flagged, scored zero.
  const targets = (constraints.target_organizations ?? []).map((o) => o.trim()).filter(Boolean);
  const excluded = (constraints.excluded_organizations ?? []).map((o) => o.trim()).filter(Boolean);
  const titleText = `${evidence.title ?? ''} ${candidateHeadline}`;
  const snippetText = `${evidence.snippet ?? ''} ${candidateSkills.join(' ')}`;
  let organization_score = 10;
  let organization_match: string | null = null;
  let orgPhrase = '';
  const violated = excluded.find((o) => mentions(`${titleText} ${snippetText}`, o));
  if (violated) {
    organization_score = 0;
    missingSignals.push(`Mentions excluded organisation: ${violated}`);
    orgPhrase = `mentions excluded ${violated}`;
  } else if (targets.length) {
    const inTitle = targets.find((o) => mentions(titleText, o));
    const inSnippet = inTitle ? null : targets.find((o) => mentions(snippetText, o));
    if (inTitle) {
      organization_score = 10;
      organization_match = inTitle;
      orgPhrase = `current employer matches ${inTitle}`;
    } else if (inSnippet) {
      organization_score = constraints.organization_scope === 'current' ? 6 : 9;
      organization_match = inSnippet;
      orgPhrase = `${inSnippet} appears in the profile history`;
      if (constraints.organization_scope === 'current') missingSignals.push(`${inSnippet} appears on the profile but not as the current employer`);
    } else {
      organization_score = 0;
      missingSignals.push(`None of the required organisations (${targets.slice(0, 3).join(', ')}) appear in the indexed snippet`);
      orgPhrase = 'no required organisation found in the indexed snippet';
    }
  }

  const overall_score =
    skills_must_have_score +
    skills_nice_to_have_score +
    seniority_score +
    location_score +
    domain_score +
    organization_score;

  // Build grounded rationale string
  const matchedSkillsList = mustHave.filter((s) =>
    candidateSkills.some((cs) => cs.toLowerCase().includes(s.toLowerCase()))
  );

  const skillPhrase =
    matchedSkillsList.length > 0
      ? `${matchedSkillsList.length}/${mustHave.length} must-have skills found in the indexed snippet (${matchedSkillsList.join(', ')})`
      : mustHave.length > 0
        ? 'none of the must-have skills appear in the indexed snippet'
        : 'no must-have skills were specified';
  const seniorityPhrase =
    titlePart >= 10 ? 'headline names the role' : titlePart > 0 ? 'headline is role-adjacent' : 'headline does not name the role';
  const match_rationale = `${skillPhrase}; ${seniorityPhrase}; ${orgPhrase ? `${orgPhrase}; ` : ''}location ${candidateLocation}.`;

  return {
    overall_score: Math.min(100, Math.max(0, overall_score)),
    match_breakdown: {
      skills_must_have_score,
      skills_nice_to_have_score,
      seniority_score,
      location_score,
      domain_score,
      organization_score,
    },
    match_rationale,
    missing_signals: missingSignals,
    organization_match,
  };
}
