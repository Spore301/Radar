export type RoleType = 'Engineering' | 'Design' | 'Marketing' | 'Sales' | 'Operations' | 'Other';

export type SeniorityLevel = 'Junior' | 'Mid' | 'Senior' | 'Staff' | 'Lead' | 'Executive';

// The closed set of X-Ray sourcing platforms. Each platform owns a fixed list
// of query templates (see src/lib/search/xrayTemplates.ts) — nothing outside
// this list is ever generated, validated, or searched. 'Resumes' is the
// open-web resume/CV/presentation pass; 'MultiSite' is the combined
// LinkedIn + GitHub + Stack Overflow sweep.
export type CandidatePlatform =
  | 'LinkedIn'
  | 'GitHub'
  | 'StackOverflow'
  | 'Wellfound'
  | 'Behance'
  | 'Dribbble'
  | 'Xing'
  | 'Resumes'
  | 'MultiSite';

export type CandidateStatus =
  | 'New'
  | 'Reviewed'
  | 'Saved'
  | 'Contacted'
  | 'Replied'
  | 'Shortlisted'
  | 'Archived';

/**
 * 'LinkedIn Note' is the 300-character note sent with a connection request —
 * the first touch for most passive candidates, tracked separately from a
 * message so the board can tell "request sent" from "messaged".
 */
export type OutreachChannel = 'LinkedIn Note' | 'LinkedIn DM' | 'Email' | 'WhatsApp' | 'Call';

export interface StructuredJD {
  job_title: string | null;
  role_type: RoleType | null;
  seniority: SeniorityLevel | null;
  years_of_experience: {
    min: number | null;
    max: number | null;
  };
  location: {
    primary: string | null;
    /** Country when the JD states or implies one; lets the parser normalise "Kolkata" → "Kolkata, India". */
    country?: string | null;
    remote_eligible: boolean;
  };
  skills: {
    must_have: string[];
    nice_to_have: string[];
    inferred_adjacent?: string[];
  };
  domain: string[];
  education: string | null;
  /** Companies / institutions the JD names as required or strongly preferred backgrounds ("ex-McKinsey", "IIT/IIM"). Never the hiring company itself. */
  target_organizations?: string[];
  /** Companies / institutions the JD says to avoid. Rare. */
  excluded_organizations?: string[];
  responsibilities_summary: string;
  confidence_scores: {
    seniority: number;
    skills_must_have: number;
  };
  extraction_warnings: string[];
}

export interface MergedConstraints {
  job_title: string;
  role_type: RoleType;
  seniority: SeniorityLevel | 'Any';
  years_of_experience: {
    min: number;
    max: number;
  };
  location: string;
  remote_eligible: boolean;
  must_have_skills: string[];
  nice_to_have_skills: string[];
  domain: string[];
  education: string;
  selected_platforms: CandidatePlatform[];
  salary_range?: {
    min?: number;
    max?: number;
    currency?: string;
  };
  /**
   * Free-text guidance from the recruiter, read FIRST when queries are built:
   * exact title wording, phrases every profile must mention, industries,
   * companies or profile types to exclude. Drives required_phrases and
   * exclude_terms in the query vocabulary.
   */
  additional_details?: string;
  /** @deprecated superseded by additional_details; still read for sessions saved before it existed. */
  soft_constraints?: string;
  /**
   * Hard constraint on where a candidate works or has worked / studied: a
   * profile must show at least ONE of these (OR'd into every query). Up to six
   * are searched per query. Companies and institutions alike — the X-Ray
   * matches the name on the page either way.
   */
  target_organizations?: string[];
  /** Profiles mentioning any of these are excluded from every query (-"name"). */
  excluded_organizations?: string[];
  /**
   * 'current' — the organisation must be the CURRENT employer. Enforceable on
   * LinkedIn, whose page title is "Name – Title – Company", via intitle:; on
   * other platforms any mention counts. 'any' — current or past, anywhere on
   * the page. Default 'any'.
   */
  organization_scope?: 'current' | 'any';
  results_cap: number;
}

export interface XRayQuery {
  id: string;
  platform: CandidatePlatform;
  /** Template id from XRAY_TEMPLATES (e.g. 'linkedin_broad'); 'custom' for hand-written queries. */
  query_type: string;
  query_string: string;
  query_intent: string;
  expected_result_type: 'Profile' | 'Portfolio' | 'Resume';
  notes?: string;
  is_edited?: boolean;
}

export interface KeywordMap {
  primary_title_variants: string[];
  skill_synonyms: Record<string, string[]>;
  domain_keywords: string[];
  seniority_signals: string[];
  negative_keywords: string[];
}

export interface MatchBreakdown {
  skills_must_have_score: number; // 0-35 (0-40 on rows scored before organisation tracking)
  skills_nice_to_have_score: number; // 0-10 (0-15 before)
  seniority_score: number; // 0-20
  location_score: number; // 0-15
  domain_score: number; // 0-10
  /** 0-10. Full marks when no organisation was required; absent on rows scored before it existed. */
  organization_score?: number;
}

export interface CandidateProfile {
  id: string;
  job_id: string;
  name: string;
  headline: string;
  location: string;
  profile_url: string;
  platform: CandidatePlatform;
  avatar_url?: string | null;
  skills_detected: string[];
  experience_years_estimated?: number | null;
  summary_snippet: string;
  match_score: number; // 0-100
  match_breakdown: MatchBreakdown;
  match_rationale: string;
  missing_signals: string[];
  /** The target organisation found on the profile (title or snippet), when one was required. */
  organization_match?: string | null;
  data_completeness: number; // 0-1
  raw_scraped_data?: Record<string, any>;
  source_query?: string;
  // 'unverified' is reserved for the three-state liveness check (see the search
  // pipeline plan) — a URL that returned an ambiguous status (403/429/999,
  // timeout, DNS/TLS failure) rather than a confirmed dead or live one.
  scrape_status: 'success' | 'snippet_only' | 'unverified' | 'blocked' | 'failed';
  status: CandidateStatus;
  discovered_at: string;
  /** When the stage last changed — drives the "3d in Contacted" chip. */
  stage_changed_at?: string;
  outreach_channel?: OutreachChannel;
  outreach_date?: string;
  next_follow_up?: string;
  notes?: string;
  tags?: string[];
  template_used_id?: string;
  /** Populated by cross-session listings (pipeline) so a card can say which search found this person. */
  job_title?: string;
}

/** One row in the session history sidebar — a JD-to-leads run stored as a Job. */
export interface SessionSummary {
  id: string;
  title: string;
  status: Job['status'];
  location: string;
  seniority: string;
  platforms: CandidatePlatform[];
  candidate_count: number;
  shortlisted_count: number;
  contacted_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachLog {
  id: string;
  candidate_id: string;
  channel: OutreachChannel;
  sent_at: string;
  message_body: string;
  notes?: string;
  follow_up_date?: string;
  tags?: string[];
  /** Display name of the recruiter who logged it, when known. */
  sent_by?: string;
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: OutreachChannel;
  body: string;
  role_type?: RoleType | 'General';
  tone?: 'Warm' | 'Professional' | 'Direct' | 'Short & Punchy';
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  raw_jd_text: string;
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
  status: 'draft' | 'parsing' | 'searching' | 'complete' | 'archived';
  candidate_count: number;
  created_at: string;
  updated_at: string;
}

export interface ParseResultResponse {
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
  word_count: number;
}
