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
  apiKey: string
): Promise<T | null> {
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
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('DeepSeek API Error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return tryParseJSON<T>(content);
  } catch (err) {
    console.error('DeepSeek API exception:', err);
    return null;
  }
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
  const apiKey = customApiKey || process.env.DEEPSEEK_API_KEY;

  if (apiKey) {
    console.log('Invoking DeepSeek AI Engine for JD Parsing...');
    onStage?.('structure', 'Structuring the JD with DeepSeek (title, seniority, skills, location)…');
    const deepSeekResult = await callDeepSeekAPI<StructuredJD>(
      `<JD_TEXT>\n${jdText}\n</JD_TEXT>`,
      JD_STRUCTURING_SYSTEM_PROMPT,
      apiKey
    );

    if (deepSeekResult && deepSeekResult.job_title) {
      const merged_constraints: MergedConstraints = {
        job_title: deepSeekResult.job_title || 'Software Engineer',
        role_type: deepSeekResult.role_type || 'Engineering',
        seniority: deepSeekResult.seniority || 'Senior',
        years_of_experience: {
          min: deepSeekResult.years_of_experience?.min || 3,
          max: deepSeekResult.years_of_experience?.max || 7,
        },
        location: deepSeekResult.location?.primary || 'Bangalore, India',
        remote_eligible: deepSeekResult.location?.remote_eligible ?? true,
        must_have_skills: deepSeekResult.skills?.must_have || [],
        nice_to_have_skills: deepSeekResult.skills?.nice_to_have || [],
        domain: deepSeekResult.domain || ['Technology'],
        education: deepSeekResult.education || 'Bachelor Degree',
        selected_platforms: defaultPlatformsForRole(deepSeekResult.role_type || 'Engineering'),
        results_cap: 50,
      };

      onStage?.('queries', 'Asking DeepSeek for sourcing vocabulary and filling the approved X-Ray templates…');
      const query_bundle = await generateQueriesWithDeepSeek(merged_constraints, apiKey);

      onStage?.('keywords', 'Building the keyword map (title variants, synonyms, negatives)…');
      const keywordResult = await callDeepSeekAPI<KeywordMap>(
        `<STRUCTURED_JD>\n${JSON.stringify(deepSeekResult)}\n</STRUCTURED_JD>`,
        KEYWORD_MAP_SYSTEM_PROMPT,
        apiKey
      );

      return {
        structured_jd: deepSeekResult,
        merged_constraints,
        query_bundle,
        keyword_map: keywordResult || heuristicParseJD(jdText).keyword_map,
      };
    }
  }

  // Fallback to grounded heuristic parser if no DeepSeek API key or parsing error
  onStage?.('structure', apiKey ? 'DeepSeek returned nothing usable — falling back to the heuristic parser…' : 'No DeepSeek key — parsing with the heuristic extractor…');
  const heuristic = heuristicParseJD(jdText);
  onStage?.('queries', 'Filling the approved X-Ray templates from the extracted constraints…');
  onStage?.('keywords', 'Building the keyword map…');
  return heuristic;
}

/**
 * Intelligent Fallback Heuristic JD Parser
 */
export function heuristicParseJD(jdText: string): {
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
} {
  const text = jdText.toLowerCase();

  let title = 'Software Engineer';
  const titleMatches = [
    /senior product designer/i,
    /product designer/i,
    /ux designer/i,
    /ui\/ux designer/i,
    /frontend engineer/i,
    /senior frontend engineer/i,
    /full stack developer/i,
    /fullstack engineer/i,
    /backend engineer/i,
    /senior backend engineer/i,
    /devops engineer/i,
    /site reliability engineer/i,
    /growth marketer/i,
    /data scientist/i,
    /ai engineer/i,
    /machine learning engineer/i,
    /product manager/i,
    /senior product manager/i,
  ];

  for (const match of titleMatches) {
    const found = jdText.match(match);
    if (found) {
      title = found[0];
      title = title.replace(/\b\w/g, (c) => c.toUpperCase());
      break;
    }
  }

  if (title === 'Software Engineer') {
    const firstLineMatch = jdText.match(/(?:title|role|position):\s*([^\n\r]+)/i);
    if (firstLineMatch && firstLineMatch[1].trim()) {
      title = firstLineMatch[1].trim();
    }
  }

  let role_type: RoleType = 'Engineering';
  if (/design|figma|ux|ui|sketch|framer|dribbble|behance/i.test(text)) {
    role_type = 'Design';
  } else if (/marketing|seo|growth|campaign|social media|content/i.test(text)) {
    role_type = 'Marketing';
  } else if (/sales|account executive|bdr|sdr|revenue/i.test(text)) {
    role_type = 'Sales';
  } else if (/operations|hr|recruiter|people ops|logistics/i.test(text)) {
    role_type = 'Operations';
  }

  let seniority: SeniorityLevel = 'Mid';
  let seniorityConfidence = 0.85;
  let extractionWarnings: string[] = [];

  if (/\bsenior\b|\bsr\.\b|lead designer|lead engineer/i.test(text)) {
    seniority = 'Senior';
  } else if (/\bstaff\b|\bprincipal\b/i.test(text)) {
    seniority = 'Staff';
  } else if (/\blead\b|\bhead of\b|\bdirector\b/i.test(text)) {
    seniority = 'Lead';
  } else if (/\bjunior\b|\bjr\.\b|\bassociate\b|\bentry level\b/i.test(text)) {
    seniority = 'Junior';
  } else if (/\bexecutive\b|\bvp\b|\bc-level\b/i.test(text)) {
    seniority = 'Executive';
  } else {
    seniorityConfidence = 0.65;
    extractionWarnings.push('Explicit seniority signal not found in JD title. Defaulting to Mid-level for search queries.');
  }

  let minExp = 3;
  let maxExp = 7;
  const expMatch = text.match(/(\d+)\s*(?:-|to|\+)\s*(\d+)?\s*(?:years|yrs)/i);
  if (expMatch) {
    minExp = parseInt(expMatch[1], 10);
    if (expMatch[2]) {
      maxExp = parseInt(expMatch[2], 10);
    } else {
      maxExp = minExp + 4;
    }
  }

  let primaryLocation = 'Bangalore, India';
  let remoteEligible = /remote|work from home|wfh|hybrid|distributed/i.test(text);

  const locMatches = [
    /bangalore|bengaluru/i,
    /mumbai/i,
    /delhi|gurgaon|noida/i,
    /hyderabad/i,
    /pune/i,
    /san francisco|sf|bay area/i,
    /new york|nyc/i,
    /london/i,
    /singapore/i,
  ];

  for (const locRegex of locMatches) {
    if (locRegex.test(text)) {
      const matchStr = text.match(locRegex)?.[0] || '';
      primaryLocation = matchStr.charAt(0).toUpperCase() + matchStr.slice(1);
      if (/bangalore|bengaluru/i.test(primaryLocation)) primaryLocation = 'Bangalore, India';
      if (/delhi|gurgaon|noida/i.test(primaryLocation)) primaryLocation = 'NCR / Delhi, India';
      break;
    }
  }

  const knownSkills = [
    'Figma',
    'React',
    'TypeScript',
    'JavaScript',
    'Node.js',
    'Python',
    'Go',
    'Java',
    'PostgreSQL',
    'MongoDB',
    'GraphQL',
    'AWS',
    'Docker',
    'Kubernetes',
    'Design Systems',
    'User Research',
    'Prototyping',
    'Wireframing',
    'Next.js',
    'Tailwind CSS',
    'Redux',
    'System Architecture',
    'Microservices',
    'Framer',
    'Lottie',
    'Sketch',
    'Adobe XD',
  ];

  const mustHave: string[] = [];
  const niceToHave: string[] = [];

  knownSkills.forEach((skill) => {
    const regex = new RegExp(`\\b${skill.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(jdText)) {
      if (mustHave.length < 5) {
        mustHave.push(skill);
      } else {
        niceToHave.push(skill);
      }
    }
  });

  if (mustHave.length === 0) {
    if (role_type === 'Design') {
      mustHave.push('Figma', 'Design Systems', 'User Research');
      niceToHave.push('Framer', 'Prototyping');
    } else {
      mustHave.push('React', 'TypeScript', 'Node.js');
      niceToHave.push('PostgreSQL', 'Docker');
    }
  }

  const domain: string[] = [];
  if (/saas|b2b|enterprise/i.test(text)) domain.push('SaaS / B2B');
  if (/fintech|banking|payments|crypto/i.test(text)) domain.push('FinTech');
  if (/e-commerce|retail|marketplace/i.test(text)) domain.push('E-Commerce');
  if (/ai|machine learning|genai|llm/i.test(text)) domain.push('AI / Machine Learning');
  if (domain.length === 0) domain.push('Technology & SaaS');

  const selectedPlatforms: CandidatePlatform[] = defaultPlatformsForRole(role_type);

  const structured_jd: StructuredJD = {
    job_title: title,
    role_type: role_type,
    seniority: seniority,
    years_of_experience: { min: minExp, max: maxExp },
    location: { primary: primaryLocation, remote_eligible: remoteEligible },
    skills: { must_have: mustHave, nice_to_have: niceToHave },
    domain: domain,
    education: /b\.tech|bachelor|bs in cs|degree/i.test(text) ? 'B.Tech / B.E. in CS or equivalent' : 'Not specified',
    responsibilities_summary: `Key responsibility for ${title} includes driving product feature execution, collaborating across teams, adhering to best engineering/design standards, and taking ownership of key project outcomes.`,
    confidence_scores: {
      seniority: seniorityConfidence,
      skills_must_have: 0.92,
    },
    extraction_warnings: extractionWarnings,
  };

  const merged_constraints: MergedConstraints = {
    job_title: title,
    role_type: role_type,
    seniority: seniority,
    years_of_experience: { min: minExp, max: maxExp },
    location: primaryLocation,
    remote_eligible: remoteEligible,
    must_have_skills: mustHave,
    nice_to_have_skills: niceToHave,
    domain: domain,
    education: structured_jd.education || 'Any Degree',
    selected_platforms: selectedPlatforms,
    additional_details: '',
    results_cap: 50,
  };

  const query_bundle = generateQueryBundleForConstraints(merged_constraints);

  const keyword_map: KeywordMap = {
    primary_title_variants: [
      title,
      `${seniority} ${title}`,
      title.includes('Designer') ? 'UI/UX Designer' : 'Full Stack Developer',
      title.includes('Designer') ? 'Product Designer' : 'Software Engineer',
    ],
    skill_synonyms: {
      React: ['ReactJS', 'React.js'],
      Figma: ['Sketch', 'Adobe XD'],
      TypeScript: ['TS', 'JavaScript ES6+'],
      'Node.js': ['Node', 'Express.js'],
    },
    domain_keywords: domain,
    seniority_signals: [seniority.toLowerCase(), 'lead', `${minExp}+ years`],
    negative_keywords: ['intern', 'fresher', 'trainee', 'hiring manager', 'recruiter'],
  };

  return {
    structured_jd,
    merged_constraints,
    query_bundle,
    keyword_map,
  };
}
