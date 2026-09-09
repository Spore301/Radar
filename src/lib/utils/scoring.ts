import { MergedConstraints, MatchBreakdown, CandidateProfile } from '../types';
import { parseLocation } from '../search/location';
import { isSoftSkill } from '../search/xrayTemplates';

// Alternate spellings a profile and a JD commonly disagree on. Both sides are
// normalised before comparison so "Bengaluru, Karnataka" matches "Bangalore".
const LOCATION_SPELLINGS: Array<[RegExp, string]> = [
  [/bengaluru/g, 'bangalore'],
  [/gurugram/g, 'gurgaon'],
  [/bombay/g, 'mumbai'],
  [/new delhi|ncr/g, 'delhi'],
  [/\bnyc\b/g, 'new york'],
  [/\bsf\b|bay area/g, 'san francisco'],
  [/münchen/g, 'munich'],
  [/wien/g, 'vienna'],
  [/zürich/g, 'zurich'],
];

function normalizeLocation(value: string): string {
  let out = (value || '').toLowerCase();
  for (const [re, replacement] of LOCATION_SPELLINGS) out = out.replace(re, replacement);
  return out;
}

export function calculateRelevanceScore(
  candidateSkills: string[],
  candidateSeniority: string,
  candidateLocation: string,
  candidateHeadline: string,
  constraints: MergedConstraints
): {
  overall_score: number;
  match_breakdown: MatchBreakdown;
  match_rationale: string;
  missing_signals: string[];
} {
  // 1. Must-have Skills Score (Max 40)
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
    skills_must_have_score = Math.round((mustHaveMatchedCount / mustHave.length) * 40);
  } else {
    const domainWords = (constraints.domain || [])
      .flatMap((d) => d.split(/\s*[\/,&]\s*/))
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 2);
    const text = `${candidateHeadline} ${candidateSkills.join(' ')}`.toLowerCase();
    const domainHit = domainWords.some((d) => text.includes(d)) || /\b(ai|machine learning|artificial intelligence|genai|llm)\b/.test(text) && /\bai\b/i.test(constraints.job_title);
    skills_must_have_score = domainHit ? 32 : 20;
    if (!domainHit && domainWords.length) missingSignals.push(`No domain signal (${domainWords.slice(0, 2).join(', ')}) in the indexed snippet`);
  }

  // 2. Nice-to-have Skills Score (Max 15) — soft-skill must-haves are scored here.
  const niceToHave = [...(constraints.nice_to_have_skills || []), ...softMustHave];
  let niceToHaveMatchedCount = 0;

  niceToHave.forEach((skill) => {
    const hasSkill = candidateSkills.some(
      (s) => s.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(s.toLowerCase())
    );
    if (hasSkill) niceToHaveMatchedCount++;
  });

  const skills_nice_to_have_score =
    niceToHave.length > 0 ? Math.round((niceToHaveMatchedCount / niceToHave.length) * 15) : 10;

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

  // 4. Location / Remote Fit (Max 15)
  //
  // Alias-aware: "Bangalore" and "Bengaluru, Karnataka, India" are the same
  // place; same country but a different city is partial credit; an unknown
  // candidate location is neutral-low rather than a penalty.
  let location_score = 8;
  const want = parseLocation(constraints.location);
  const have = parseLocation(candidateLocation);
  const unknown = /not specified/i.test(candidateLocation) || (!have.cities.length && !have.country && !have.remote);
  if (constraints.remote_eligible && (have.remote || want.remote)) {
    location_score = 15;
  } else if (want.cities.length && have.cities.length && want.cities.some((w) => have.cities.some((h) => h.name === w.name))) {
    location_score = 15;
  } else if (want.country && have.country && want.country.name === have.country.name) {
    location_score = 11;
  } else if (unknown || !want.display) {
    location_score = 8;
  } else {
    location_score = 4;
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

  const overall_score =
    skills_must_have_score +
    skills_nice_to_have_score +
    seniority_score +
    location_score +
    domain_score;

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
  const match_rationale = `${skillPhrase}; ${seniorityPhrase}; location ${candidateLocation}.`;

  return {
    overall_score: Math.min(100, Math.max(0, overall_score)),
    match_breakdown: {
      skills_must_have_score,
      skills_nice_to_have_score,
      seniority_score,
      location_score,
      domain_score,
    },
    match_rationale,
    missing_signals: missingSignals,
  };
}
