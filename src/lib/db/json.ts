import { z } from 'zod';
import type { Candidate as CandidateRow, Job as JobRow } from '@prisma/client';
import {
  CandidateProfile,
  Job,
  MatchBreakdown,
  StructuredJD,
  MergedConstraints,
  XRayQuery,
  KeywordMap,
  OutreachChannel,
} from '../types';

// ---------------------------------------------------------------------------
// Zod schemas for the JSON columns
//
// SQLite has no native array/object validation, so Prisma's `Json` columns are
// untyped at the database level (`Prisma.JsonValue` — effectively `unknown`).
// Every read below goes through one of these schemas instead of a bare cast,
// so a corrupted or hand-edited row surfaces as a clear parse error (for the
// core Job blobs, where corruption is a real bug worth crashing loudly on) or
// degrades to a safe fallback (for incidental arrays like tags, where a
// human's manual DB edit shouldn't take down the whole candidate).
// ---------------------------------------------------------------------------

const roleTypeSchema = z.enum(['Engineering', 'Design', 'Marketing', 'Sales', 'Operations', 'Other']);
const seniorityLevelSchema = z.enum(['Junior', 'Mid', 'Senior', 'Staff', 'Lead', 'Executive']);
const candidatePlatformSchema = z.enum([
  'LinkedIn',
  'GitHub',
  'StackOverflow',
  'Wellfound',
  'Behance',
  'Dribbble',
  'Xing',
  'Resumes',
  'MultiSite',
]);

const structuredJdSchema: z.ZodType<StructuredJD> = z.object({
  job_title: z.string().nullable(),
  role_type: roleTypeSchema.nullable(),
  seniority: seniorityLevelSchema.nullable(),
  years_of_experience: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
  }),
  location: z.object({
    primary: z.string().nullable(),
    country: z.string().nullable().optional(),
    remote_eligible: z.boolean(),
  }),
  skills: z.object({
    must_have: z.array(z.string()),
    nice_to_have: z.array(z.string()),
    inferred_adjacent: z.array(z.string()).optional(),
  }),
  domain: z.array(z.string()),
  education: z.string().nullable(),
  responsibilities_summary: z.string(),
  confidence_scores: z.object({
    seniority: z.number(),
    skills_must_have: z.number(),
  }),
  extraction_warnings: z.array(z.string()),
});

const mergedConstraintsSchema: z.ZodType<MergedConstraints> = z.object({
  job_title: z.string(),
  role_type: roleTypeSchema,
  seniority: z.union([seniorityLevelSchema, z.literal('Any')]),
  years_of_experience: z.object({
    min: z.number(),
    max: z.number(),
  }),
  location: z.string(),
  remote_eligible: z.boolean(),
  must_have_skills: z.array(z.string()),
  nice_to_have_skills: z.array(z.string()),
  domain: z.array(z.string()),
  education: z.string(),
  selected_platforms: z.array(candidatePlatformSchema),
  salary_range: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  additional_details: z.string().optional(),
  soft_constraints: z.string().optional(),
  results_cap: z.number(),
});

const xRayQuerySchema: z.ZodType<XRayQuery> = z.object({
  id: z.string(),
  platform: candidatePlatformSchema,
  query_type: z.string(),
  query_string: z.string(),
  query_intent: z.string(),
  expected_result_type: z.enum(['Profile', 'Portfolio', 'Resume']),
  notes: z.string().optional(),
  is_edited: z.boolean().optional(),
});

const queryBundleSchema = z.array(xRayQuerySchema);

const keywordMapSchema: z.ZodType<KeywordMap> = z.object({
  primary_title_variants: z.array(z.string()),
  skill_synonyms: z.record(z.string(), z.array(z.string())),
  domain_keywords: z.array(z.string()),
  seniority_signals: z.array(z.string()),
  negative_keywords: z.array(z.string()),
});

const matchBreakdownSchema: z.ZodType<MatchBreakdown> = z.object({
  skills_must_have_score: z.number(),
  skills_nice_to_have_score: z.number(),
  seniority_score: z.number(),
  location_score: z.number(),
  domain_score: z.number(),
});

const stringArraySchema = z.array(z.string());

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Parses a Job's core JSON column (structured_jd, merged_constraints,
 * query_bundle, keyword_map). Throws on failure — a corrupt value here means
 * the row itself is unusable, and hiding that behind a silent fallback would
 * only surface confusingly later (e.g. a null job_title deep in a form).
 */
function parseJsonStrict<T>(schema: z.ZodType<T>, value: unknown, fieldName: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Corrupt JSON in "${fieldName}": ${result.error.message}`);
  }
  return result.data;
}

/**
 * Reads a JSON column that's expected to hold a string array (skills_detected,
 * missing_signals, tags). Falls back to `[]` on anything unexpected — these
 * are incidental, editable-by-hand fields where losing a malformed entry is
 * far better than taking the whole candidate down.
 */
export function jsonStringArray(value: unknown): string[] {
  const result = stringArraySchema.safeParse(value);
  return result.success ? result.data : [];
}

// ---------------------------------------------------------------------------
// URL canonicalization (drives Candidate's @@unique([jobId, profileUrlCanonical]))
// ---------------------------------------------------------------------------

/**
 * Normalizes a profile URL for cross-run dedupe: lowercased host+path, no
 * trailing slash, no query string or fragment (tracking params like
 * `?utm_source=` or a LinkedIn `?originalSubdomain=` would otherwise make the
 * same profile look like two different candidates).
 */
export function canonicalizeProfileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    // Not a parseable absolute URL — fall back to a best-effort string
    // normalization rather than throwing (dedupe should degrade, not crash).
    return url.trim().toLowerCase().replace(/\/+$/, '').split(/[?#]/)[0];
  }
}

// ---------------------------------------------------------------------------
// Prisma <-> domain enum conversion
//
// Prisma enum values with @map (OutreachChannel, Tone) round-trip through the
// *schema identifier* on the client (e.g. "LinkedInDM"), not the mapped
// database string ("LinkedIn DM") — @map only changes what's stored in SQL.
// Every other enum in the schema uses identifiers that are already identical
// to the domain string-literal unions, so no conversion table is needed for
// CandidateStatus, ScrapeStatus, JobStatus, or CandidatePlatform.
// ---------------------------------------------------------------------------

const OUTREACH_CHANNEL_FROM_PRISMA: Record<string, OutreachChannel> = {
  LinkedInNote: 'LinkedIn Note',
  LinkedInDM: 'LinkedIn DM',
  Email: 'Email',
  WhatsApp: 'WhatsApp',
  Call: 'Call',
};

const OUTREACH_CHANNEL_TO_PRISMA: Record<OutreachChannel, string> = {
  'LinkedIn Note': 'LinkedInNote',
  'LinkedIn DM': 'LinkedInDM',
  Email: 'Email',
  WhatsApp: 'WhatsApp',
  Call: 'Call',
};

export function outreachChannelFromPrisma(value: string): OutreachChannel {
  return OUTREACH_CHANNEL_FROM_PRISMA[value] ?? 'Email';
}

export function outreachChannelToPrisma(value: OutreachChannel): string {
  return OUTREACH_CHANNEL_TO_PRISMA[value];
}

// ---------------------------------------------------------------------------
// Row -> domain mappers
// ---------------------------------------------------------------------------

export function toCandidateProfile(row: CandidateRow): CandidateProfile {
  return {
    id: row.id,
    job_id: row.jobId,
    name: row.name,
    headline: row.headline,
    location: row.location,
    profile_url: row.profileUrl,
    platform: row.platform,
    avatar_url: row.avatarUrl,
    skills_detected: jsonStringArray(row.skillsDetected),
    experience_years_estimated: row.experienceYearsEstimated,
    summary_snippet: row.summarySnippet,
    match_score: row.matchScore,
    match_breakdown: parseJsonStrict(matchBreakdownSchema, row.matchBreakdown, 'matchBreakdown'),
    match_rationale: row.matchRationale,
    missing_signals: jsonStringArray(row.missingSignals),
    data_completeness: row.dataCompleteness,
    raw_scraped_data: (row.rawScrapedData as Record<string, any> | null) ?? undefined,
    source_query: row.sourceQueryId ?? undefined,
    scrape_status: row.scrapeStatus,
    status: row.status,
    discovered_at: row.discoveredAt.toISOString(),
    stage_changed_at: row.stageChangedAt ? row.stageChangedAt.toISOString() : undefined,
    outreach_channel: row.outreachChannel ? outreachChannelFromPrisma(row.outreachChannel) : undefined,
    outreach_date: row.outreachDate ? row.outreachDate.toISOString() : undefined,
    next_follow_up: row.nextFollowUp ? row.nextFollowUp.toISOString() : undefined,
    notes: row.notes ?? undefined,
    tags: row.tags != null ? jsonStringArray(row.tags) : undefined,
    template_used_id: row.templateUsedId ?? undefined,
  };
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    title: row.title,
    raw_jd_text: row.rawJdText,
    structured_jd: parseJsonStrict(structuredJdSchema, row.structuredJd, 'structuredJd'),
    merged_constraints: parseJsonStrict(mergedConstraintsSchema, row.mergedConstraints, 'mergedConstraints'),
    query_bundle: parseJsonStrict(queryBundleSchema, row.queryBundle, 'queryBundle'),
    keyword_map: parseJsonStrict(keywordMapSchema, row.keywordMap, 'keywordMap'),
    status: row.status,
    candidate_count: row.candidateCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
