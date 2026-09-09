import type { Prisma } from '@prisma/client';
import { prisma } from './client';
import {
  canonicalizeProfileUrl,
  outreachChannelToPrisma,
  toCandidateProfile,
  toJob,
} from './json';
import {
  CandidateProfile,
  CandidateStatus,
  Job,
  KeywordMap,
  MergedConstraints,
  OutreachChannel,
  SessionSummary,
  StructuredJD,
  XRayQuery,
} from '../types';
import type { QueryRunResult, SearchStats, XRaySearchResult } from '../search/x-raySearchService';
import { canonicalizeQueryString } from '../search/queryValidation';

// ---------------------------------------------------------------------------
// Session repository.
//
// A "session" is one JD-to-leads discovery, stored as a Job row plus its
// SearchRuns, Candidates and OutreachLogs — the sourcing equivalent of a chat
// thread. Everything the dashboard shows for a session is rebuilt from these
// rows, so closing the tab (or reopening the session a week later) loses
// nothing: constraints, the query bundle, every indexed profile, the
// per-query receipt of the last run, and every shortlist / outreach edit.
//
// Access model follows the schema's "authorship, not access control" note:
// every signed-in teammate sees every session; createdBy is attribution.
// ---------------------------------------------------------------------------

/** Prisma Json columns reject `undefined` inside objects; round-tripping strips them. */
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function sessionTitle(constraints: MergedConstraints): string {
  const parts = [constraints.job_title || 'Untitled role'];
  if (constraints.location) parts.push(constraints.location.split(',')[0].trim());
  return parts.join(' · ');
}

// --- Sessions ----------------------------------------------------------------

export interface NewSessionInput {
  raw_jd_text: string;
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
  title?: string;
}

export async function createSession(userId: string | null, input: NewSessionInput): Promise<Job> {
  const row = await prisma.job.create({
    data: {
      title: input.title?.trim() || sessionTitle(input.merged_constraints),
      rawJdText: input.raw_jd_text,
      structuredJd: toJson(input.structured_jd),
      mergedConstraints: toJson(input.merged_constraints),
      queryBundle: toJson(input.query_bundle),
      keywordMap: toJson(input.keyword_map),
      status: 'draft',
      createdById: userId ?? undefined,
    },
  });
  return toJob(row);
}

export async function listSessions(): Promise<SessionSummary[]> {
  const jobs = await prisma.job.findMany({
    where: { status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
    include: {
      createdBy: { select: { name: true, email: true } },
      _count: { select: { candidates: true } },
    },
  });
  if (jobs.length === 0) return [];

  const statusCounts = await prisma.candidate.groupBy({
    by: ['jobId', 'status'],
    where: { jobId: { in: jobs.map((j) => j.id) } },
    _count: { _all: true },
  });
  const countFor = (jobId: string, status: CandidateStatus) =>
    statusCounts.find((c) => c.jobId === jobId && c.status === status)?._count._all ?? 0;

  return jobs.map((job) => {
    // Tolerant read: a session with a hand-edited constraints blob should still
    // appear in history (with blanks) rather than break the whole sidebar.
    const constraints = (job.mergedConstraints ?? {}) as Partial<MergedConstraints>;
    return {
      id: job.id,
      title: job.title,
      status: job.status,
      location: constraints.location ?? '',
      seniority: constraints.seniority ?? 'Any',
      platforms: Array.isArray(constraints.selected_platforms) ? constraints.selected_platforms : [],
      candidate_count: job._count.candidates,
      shortlisted_count: countFor(job.id, 'Shortlisted'),
      contacted_count:
        countFor(job.id, 'Contacted') + countFor(job.id, 'Replied'),
      created_by: job.createdBy?.name ?? job.createdBy?.email ?? null,
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
    };
  });
}

export interface SessionDetail {
  job: Job;
  candidates: CandidateProfile[];
  /** Agent conversation that built this session, when there is one. */
  agent_transcript: unknown[] | null;
  /** The agent's conversation memory (asked fields, confirmation, phase). */
  agent_state: Record<string, unknown> | null;
  last_run: { id: string; started_at: string; finished_at: string | null; stats: SearchStats; query_results: QueryRunResult[] } | null;
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  const row = await prisma.job.findUnique({ where: { id } });
  if (!row) return null;

  const [candidateRows, lastRun] = await Promise.all([
    prisma.candidate.findMany({ where: { jobId: id }, orderBy: [{ matchScore: 'desc' }, { name: 'asc' }] }),
    prisma.searchRun.findFirst({
      where: { jobId: id },
      orderBy: { startedAt: 'desc' },
      include: { queries: { orderBy: { startedAt: 'asc' } } },
    }),
  ]);

  const candidates = candidateRows.map(toCandidateProfile);

  let last_run: SessionDetail['last_run'] = null;
  if (lastRun) {
    const query_results: QueryRunResult[] = lastRun.queries.map((q) => ({
      queryId: q.queryId,
      platform: q.platform,
      queryType: q.queryType,
      queryString: q.queryString,
      status: q.outcome === 'fetched' || q.outcome === 'cache_hit' ? 'completed' : q.outcome === 'skipped' ? 'skipped' : 'failed',
      provider: (q.provider as QueryRunResult['provider']) ?? 'none',
      resultCount: q.resultCount,
      indexedCount: q.keptCount,
      pagesFetched: q.creditCost > 0 ? q.creditCost : q.outcome === 'fetched' ? 1 : 0,
      creditsUsed: q.creditCost,
      // errorMessage doubles as the diagnostic column: a failure reason when the
      // query failed, the engine's account of the result set when it succeeded.
      error: q.outcome === 'fetched' ? undefined : q.errorMessage ?? undefined,
      notice: q.outcome === 'fetched' ? q.errorMessage ?? undefined : undefined,
    }));
    const strong = candidates.filter((c) => c.match_score >= 70).length;
    const potential = candidates.filter((c) => c.match_score >= 40 && c.match_score < 70).length;
    last_run = {
      id: lastRun.id,
      started_at: lastRun.startedAt.toISOString(),
      finished_at: lastRun.finishedAt?.toISOString() ?? null,
      stats: {
        total: lastRun.rawResultCount,
        deduplicated: candidates.length,
        strong,
        potential,
        low: candidates.length - strong - potential,
        queriesRun: query_results.filter((r) => r.status === 'completed').length,
        queriesFailed: query_results.filter((r) => r.status !== 'completed').length,
        creditsUsed: lastRun.creditsCommitted,
      },
      query_results,
    };
  }

  // Stored either as a bare message array (early sessions) or as { messages, state }.
  const at: any = row.agentTranscript;
  const agent_transcript = Array.isArray(at) ? (at as unknown[]) : at && Array.isArray(at.messages) ? (at.messages as unknown[]) : null;
  const agent_state = at && !Array.isArray(at) && at.state && typeof at.state === 'object' ? (at.state as Record<string, unknown>) : null;
  return { job: toJob(row), candidates, last_run, agent_transcript, agent_state };
}

export interface SessionPatch {
  title?: string;
  merged_constraints?: MergedConstraints;
  query_bundle?: XRayQuery[];
  keyword_map?: KeywordMap;
  status?: Job['status'];
}

export async function updateSession(id: string, patch: SessionPatch): Promise<Job | null> {
  const exists = await prisma.job.findUnique({ where: { id }, select: { id: true, title: true, mergedConstraints: true } });
  if (!exists) return null;

  // A title the recruiter (or the demo) set explicitly is kept. Only a title we
  // generated from the previous constraints follows the new constraints.
  let nextTitle: string | undefined = patch.title?.trim() || undefined;
  if (!nextTitle && patch.merged_constraints) {
    const previous = exists.mergedConstraints as Partial<MergedConstraints> | null;
    const wasAuto = !previous || exists.title === sessionTitle(previous as MergedConstraints);
    if (wasAuto) nextTitle = sessionTitle(patch.merged_constraints);
  }

  const row = await prisma.job.update({
    where: { id },
    data: {
      ...(nextTitle ? { title: nextTitle } : {}),
      ...(patch.merged_constraints ? { mergedConstraints: toJson(patch.merged_constraints) } : {}),
      ...(patch.query_bundle ? { queryBundle: toJson(patch.query_bundle) } : {}),
      ...(patch.keyword_map ? { keywordMap: toJson(patch.keyword_map) } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });
  return toJob(row);
}

/** Hard delete: cascades to runs, candidates and outreach logs via the schema. */
export async function deleteSession(id: string): Promise<boolean> {
  const exists = await prisma.job.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.job.delete({ where: { id } });
  return true;
}

// --- Search runs -------------------------------------------------------------

function candidateKey(c: CandidateProfile): string {
  const fromIndexer = c.raw_scraped_data?.canonical_url;
  return typeof fromIndexer === 'string' && fromIndexer ? fromIndexer : canonicalizeProfileUrl(c.profile_url);
}

/**
 * Persists one completed search run against a session: the run header, one
 * receipt row per individually-searched query, and an upsert of every indexed
 * candidate. Re-running a session refreshes scraped fields and scores on
 * profiles it has seen before but never touches the recruiter's own edits
 * (status, notes, tags, follow-up), so a shortlist survives a re-search.
 * Returns the session's full candidate list as stored (with DB ids).
 */
export async function recordSearchRun(
  jobId: string,
  userId: string | null,
  result: XRaySearchResult,
  resultsCap: number
): Promise<{ runId: string; candidates: CandidateProfile[] }> {
  const usedSerpApi = result.queryResults.some((q) => q.provider === 'serpapi');
  const tier = usedSerpApi ? 'precision' : 'free';
  const anyCompleted = result.queryResults.some((q) => q.status === 'completed');
  const allCompleted = result.queryResults.every((q) => q.status === 'completed');
  const now = new Date();

  const run = await prisma.searchRun.create({
    data: {
      jobId,
      tier,
      status: allCompleted ? 'completed' : anyCompleted ? 'partial' : 'failed',
      resultsCap,
      creditsCommitted: result.stats.creditsUsed,
      queriesTotal: result.queryResults.length,
      queriesDone: result.stats.queriesRun,
      rawResultCount: result.stats.total,
      candidateCount: result.candidates.length,
      startedById: userId ?? undefined,
      finishedAt: now,
      queries: {
        create: result.queryResults.map((q) => ({
          queryId: q.queryId,
          platform: q.platform,
          queryType: q.queryType,
          queryString: q.queryString,
          canonicalHash: djb2(canonicalizeQueryString(q.queryString)),
          provider: q.provider === 'none' ? null : q.provider,
          outcome: q.status === 'completed' ? 'fetched' : q.status === 'skipped' ? 'skipped' : 'failed',
          creditCost: q.creditsUsed,
          resultCount: q.resultCount,
          keptCount: q.indexedCount,
          errorMessage: q.error ?? q.notice ?? null,
          startedAt: now,
          finishedAt: now,
        })),
      },
    },
  });

  // Upsert every indexed profile. Batched into one transaction so a half-
  // written run can't leave the session with a partial candidate list.
  await prisma.$transaction(
    result.candidates.map((c) => {
      const scraped = {
        name: c.name,
        headline: c.headline,
        platform: c.platform,
        avatarUrl: c.avatar_url ?? null,
        skillsDetected: toJson(c.skills_detected),
        experienceYearsEstimated: c.experience_years_estimated ?? null,
        summarySnippet: c.summary_snippet,
        matchScore: c.match_score,
        matchBreakdown: toJson(c.match_breakdown),
        matchRationale: c.match_rationale,
        missingSignals: toJson(c.missing_signals),
        dataCompleteness: c.data_completeness,
        rawScrapedData: c.raw_scraped_data ? toJson(c.raw_scraped_data) : undefined,
        sourceQueryId: c.source_query ?? null,
        sourceRunId: run.id,
        sourceTier: tier as 'free' | 'precision',
        scrapeStatus: c.scrape_status,
      };
      return prisma.candidate.upsert({
        where: { jobId_profileUrlCanonical: { jobId, profileUrlCanonical: candidateKey(c) } },
        create: {
          ...scraped,
          jobId,
          location: c.location,
          profileUrl: c.profile_url,
          profileUrlCanonical: candidateKey(c),
          status: 'New',
          discoveredAt: new Date(c.discovered_at),
        },
        // Location is only overwritten when the new run actually found one.
        update: c.location && !/not specified/i.test(c.location) ? { ...scraped, location: c.location } : scraped,
      });
    })
  );

  const total = await prisma.candidate.count({ where: { jobId } });
  await prisma.job.update({ where: { id: jobId }, data: { status: 'complete', candidateCount: total } });

  const rows = await prisma.candidate.findMany({ where: { jobId }, orderBy: [{ matchScore: 'desc' }, { name: 'asc' }] });
  return { runId: run.id, candidates: rows.map(toCandidateProfile) };
}

// --- Candidates --------------------------------------------------------------

export interface CandidatePatch {
  status?: CandidateStatus;
  outreach_channel?: OutreachChannel | null;
  next_follow_up?: string | null;
  notes?: string | null;
  tags?: string[];
}

export async function updateCandidate(id: string, userId: string | null, patch: CandidatePatch): Promise<CandidateProfile | null> {
  const exists = await prisma.candidate.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  const followUp =
    patch.next_follow_up === undefined
      ? undefined
      : patch.next_follow_up
        ? new Date(patch.next_follow_up)
        : null;

  const row = await prisma.candidate.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.outreach_channel !== undefined
        ? { outreachChannel: patch.outreach_channel ? (outreachChannelToPrisma(patch.outreach_channel) as any) : null }
        : {}),
      ...(followUp !== undefined && !(followUp instanceof Date && isNaN(followUp.getTime())) ? { nextFollowUp: followUp } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.tags !== undefined ? { tags: toJson(patch.tags) } : {}),
      lastUpdatedById: userId ?? undefined,
    },
  });
  return toCandidateProfile(row);
}

/**
 * Records a sent message: one OutreachLog row, and the candidate moves to
 * Contacted with the channel and send date stamped on it.
 */
export async function logOutreach(
  candidateId: string,
  userId: string | null,
  channel: OutreachChannel,
  messageBody: string,
  templateId?: string
): Promise<CandidateProfile | null> {
  const exists = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, notes: true } });
  if (!exists) return null;

  const now = new Date();
  const [, row] = await prisma.$transaction([
    prisma.outreachLog.create({
      data: {
        candidateId,
        channel: outreachChannelToPrisma(channel) as any,
        messageBody,
        sentAt: now,
        sentById: userId ?? undefined,
      },
    }),
    prisma.candidate.update({
      where: { id: candidateId },
      data: {
        status: 'Contacted',
        outreachChannel: outreachChannelToPrisma(channel) as any,
        outreachDate: now,
        templateUsedId: templateId ?? undefined,
        lastUpdatedById: userId ?? undefined,
        notes:
          (exists.notes ? exists.notes + '\n\n' : '') +
          `[${now.toLocaleDateString()}] Outreach via ${channel}:\n${messageBody}`,
      },
    }),
  ]);
  return toCandidateProfile(row);
}

export interface CandidateListFilter {
  jobId?: string;
  statuses?: CandidateStatus[];
}

/** Cross-session candidate listing for the pipeline board, tagged with the session title. */
export async function listCandidates(filter: CandidateListFilter = {}): Promise<CandidateProfile[]> {
  const rows = await prisma.candidate.findMany({
    where: {
      ...(filter.jobId ? { jobId: filter.jobId } : {}),
      ...(filter.statuses && filter.statuses.length ? { status: { in: filter.statuses } } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }],
    include: { job: { select: { title: true } } },
  });
  return rows.map((row) => ({ ...toCandidateProfile(row), job_title: row.job.title }));
}
