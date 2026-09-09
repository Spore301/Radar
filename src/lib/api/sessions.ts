import type {
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
import type { QueryRunResult, SearchStats } from '../search/x-raySearchService';
import type { SerpOptions } from '../search/serpConfig';
import { postNdjson, type ProgressEvent } from './stream';

export type { ProgressEvent };

// ---------------------------------------------------------------------------
// Browser-side client for the session / candidate API. Every call resolves to
// the server's stored state so the UI can replace its optimistic copy with the
// row as the database has it (ids included).
// ---------------------------------------------------------------------------

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body: fall through to the status-based error below.
  }
  if (!res.ok || (data && data.success === false)) {
    throw new Error(data?.error || `${init?.method ?? 'GET'} ${url} failed with ${res.status}`);
  }
  return data as T;
}

export interface SessionDetailResponse {
  job: Job;
  candidates: CandidateProfile[];
  agent_transcript?: unknown[] | null;
  last_run: {
    id: string;
    started_at: string;
    finished_at: string | null;
    stats: SearchStats;
    query_results: QueryRunResult[];
  } | null;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions');
  return data.sessions;
}

export async function createSession(input: {
  raw_jd_text: string;
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
  title?: string;
}): Promise<Job> {
  const data = await request<{ session: Job }>('/api/sessions', { method: 'POST', body: JSON.stringify(input) });
  return data.session;
}

export async function getSession(id: string): Promise<SessionDetailResponse> {
  return request<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function updateSession(
  id: string,
  patch: { title?: string; merged_constraints?: MergedConstraints; query_bundle?: XRayQuery[]; status?: Job['status'] }
): Promise<Job> {
  const data = await request<{ session: Job }>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.session;
}

export async function deleteSession(id: string): Promise<void> {
  await request<{ success: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface RunSearchResponse {
  runId: string;
  candidates: CandidateProfile[];
  stats: SearchStats;
  queryResults: QueryRunResult[];
}

/**
 * Runs the bundle. The route streams progress (one event per query start /
 * finish, then a storing stage) before the final payload; pass `onEvent` to
 * drive a progress bar. `signal` lets the caller stop waiting — the server
 * still finishes and stores the run.
 */
export async function runSearch(
  input: {
    jobId: string;
    constraints: MergedConstraints;
    queries: XRayQuery[];
    apiKeys?: { deepseek?: string | null };
    serpOptions?: SerpOptions;
  },
  onEvent?: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<RunSearchResponse> {
  return postNdjson<RunSearchResponse>(
    '/api/search-candidates',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKeys?.deepseek ? { 'x-deepseek-api-key': input.apiKeys.deepseek } : {}),
      },
      body: JSON.stringify(input),
      signal,
    },
    onEvent
  );
}

export interface ParseJdResponse {
  raw_jd_text: string;
  word_count: number;
  structured_jd: StructuredJD;
  merged_constraints: MergedConstraints;
  query_bundle: XRayQuery[];
  keyword_map: KeywordMap;
  session?: Job;
}

/** Parses a JD (file or pasted text) and stores it as a session; streams stage events. */
export async function parseJd(
  input: { file?: File; text?: string },
  onEvent?: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<ParseJdResponse> {
  const keys = readStoredApiKeys();
  const headers: Record<string, string> = keys.deepseek ? { 'x-deepseek-api-key': keys.deepseek } : {};
  if (input.file) {
    const formData = new FormData();
    formData.append('file', input.file);
    return postNdjson<ParseJdResponse>('/api/parse-jd', { method: 'POST', body: formData, headers, signal }, onEvent);
  }
  return postNdjson<ParseJdResponse>(
    '/api/parse-jd',
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw_jd_text: input.text ?? '' }), signal },
    onEvent
  );
}

export async function listCandidates(filter: { jobId?: string; statuses?: CandidateStatus[] } = {}): Promise<CandidateProfile[]> {
  const params = new URLSearchParams();
  if (filter.jobId) params.set('jobId', filter.jobId);
  if (filter.statuses?.length) params.set('status', filter.statuses.join(','));
  const qs = params.toString();
  const data = await request<{ candidates: CandidateProfile[] }>(`/api/candidates${qs ? `?${qs}` : ''}`);
  return data.candidates;
}

export interface CandidatePatch {
  status?: CandidateStatus;
  outreach_channel?: OutreachChannel | null;
  next_follow_up?: string | null;
  notes?: string | null;
  tags?: string[];
}

export async function updateCandidate(id: string, patch: CandidatePatch): Promise<CandidateProfile> {
  const data = await request<{ candidate: CandidateProfile }>(`/api/candidates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return data.candidate;
}

export async function logOutreach(id: string, channel: OutreachChannel, message: string, templateId?: string): Promise<CandidateProfile> {
  const data = await request<{ candidate: CandidateProfile }>(`/api/candidates/${encodeURIComponent(id)}/outreach`, {
    method: 'POST',
    body: JSON.stringify({ channel, message, template_id: templateId }),
  });
  return data.candidate;
}

/** Window event fired whenever a session is created, updated or deleted; the sidebar and history panel refetch on it. */
export const SESSIONS_CHANGED_EVENT = 'candidateradar:sessions-changed';

export function notifySessionsChanged(detail: { deletedId?: string } = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED_EVENT, { detail }));
}

/**
 * The only key the browser may hold: an optional personal DeepSeek key. The
 * SerpAPI key lives server-side (encrypted) since onboarding.
 */
export function readStoredApiKeys(): { deepseek: string | null } {
  if (typeof window === 'undefined') return { deepseek: null };
  try {
    return { deepseek: localStorage.getItem('DEEPSEEK_API_KEY') || null };
  } catch {
    return { deepseek: null };
  }
}
