'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, Check, AlertTriangle, Minus } from 'lucide-react';

import { FileUploadZone } from '@/components/ingestion/FileUploadZone';
import { ConstraintsForm } from '@/components/ingestion/ConstraintsForm';
import { QueryPreviewModal } from '@/components/ingestion/QueryPreviewModal';
import { CandidateCard } from '@/components/candidates/CandidateCard';
import { CandidateDetailDrawer } from '@/components/candidates/CandidateDetailDrawer';
import { FilterPanel } from '@/components/candidates/FilterPanel';
import { OutreachGeneratorModal } from '@/components/outreach/OutreachGeneratorModal';
import { ProcessingOverlay, ProcessingState, ProcessingLogItem, ProcessingStep, StepState } from '@/components/processing/ProcessingOverlay';
import { StageStatusBar, FlowStageKey } from '@/components/processing/StageStatusBar';
import { PlatformBadge } from '@/components/platforms/PlatformLogo';
import { PageHeader } from '@/components/ui/PageHeader';

import { StructuredJD, MergedConstraints, XRayQuery, KeywordMap, CandidateProfile, CandidateStatus, OutreachChannel, CandidatePlatform } from '@/lib/types';
import { INITIAL_DEMO_JOB } from '@/lib/seedData';
import { generateQueryBundleForConstraints } from '@/lib/ai/client';
import type { QueryRunResult, SearchStats } from '@/lib/search/x-raySearchService';
import { getTemplate } from '@/lib/search/xrayTemplates';
import { platformLabel, PLATFORMS } from '@/lib/search/platforms';
import { scoreTier, TIER_BG, TIER_LABEL } from '@/lib/utils/tier';
import * as api from '@/lib/api/sessions';
import { notifySessionsChanged } from '@/lib/api/sessions';

const EMPTY_STATS: SearchStats = { total: 0, deduplicated: 0, strong: 0, potential: 0, low: 0, queriesRun: 0, queriesFailed: 0, creditsUsed: 0 };

type Step = FlowStageKey;

export default function SourcingDashboardPage() {
  return (
    <Suspense fallback={null}>
      <SourcingDashboard />
    </Suspense>
  );
}

function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SourcingDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  const [step, setStep] = useState<Step>('ingest');
  const loadedSessionRef = useRef<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionUpdatedAt, setSessionUpdatedAt] = useState<string | null>(null);

  const [rawJdText, setRawJdText] = useState('');
  const [structuredJD, setStructuredJD] = useState<StructuredJD | null>(null);
  const [constraints, setConstraints] = useState<MergedConstraints | null>(null);
  const [queryBundle, setQueryBundle] = useState<XRayQuery[]>([]);
  const [, setKeywordMap] = useState<KeywordMap | null>(null);

  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateProfile | null>(null);
  const [outreachCandidate, setOutreachCandidate] = useState<CandidateProfile | null>(null);

  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchStats, setSearchStats] = useState<SearchStats>(EMPTY_STATS);
  const [queryResults, setQueryResults] = useState<QueryRunResult[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [lastStatus, setLastStatus] = useState<{ message: string; tone: 'info' | 'success' | 'error' }>({
    message: 'Upload or paste a job description to start a session.',
    tone: 'info',
  });
  const abortRef = useRef<AbortController | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('All');
  const [selectedMatchTier, setSelectedMatchTier] = useState('All');
  const [sortBy, setSortBy] = useState('score');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // --- processing helpers ---------------------------------------------------

  const patchProcessing = (patch: Partial<ProcessingState> | ((prev: ProcessingState) => Partial<ProcessingState>)) =>
    setProcessing((prev) => (prev ? { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) } : prev));

  const beginProcessing = (state: Omit<ProcessingState, 'startedAt'>) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setProcessing({ ...state, startedAt: Date.now() });
    return abortRef.current.signal;
  };

  const endProcessing = (message: string, tone: 'info' | 'success' | 'error' = 'success') => {
    setProcessing(null);
    setLastStatus({ message, tone });
  };

  const stopWaiting = () => {
    abortRef.current?.abort();
    setProcessing(null);
    setLastStatus({ message: 'Stopped waiting. Anything already sent to the server still completes and is saved to the session.', tone: 'info' });
  };

  // --- session load / reset -------------------------------------------------

  const resetToNewSession = useCallback(() => {
    loadedSessionRef.current = null;
    setSessionTitle(null);
    setSessionUpdatedAt(null);
    setStep('ingest');
    setRawJdText('');
    setStructuredJD(null);
    setConstraints(null);
    setQueryBundle([]);
    setKeywordMap(null);
    setCandidates([]);
    setSearchStats(EMPTY_STATS);
    setQueryResults([]);
    setSelectedCandidate(null);
    setOutreachCandidate(null);
    setError(null);
    setLastStatus({ message: 'Upload or paste a job description to start a session.', tone: 'info' });
  }, []);

  useEffect(() => {
    if (!sessionId) {
      resetToNewSession();
      return;
    }
    if (loadedSessionRef.current === sessionId) return;

    let cancelled = false;
    setError(null);
    setProcessing({ stage: 'session', title: 'Opening session', status: 'Loading stored constraints, queries and candidates…', progress: null, startedAt: Date.now() });
    (async () => {
      try {
        const detail = await api.getSession(sessionId);
        if (cancelled) return;
        loadedSessionRef.current = sessionId;
        setSessionTitle(detail.job.title);
        setSessionUpdatedAt(detail.job.updated_at);
        setRawJdText(detail.job.raw_jd_text);
        setStructuredJD(detail.job.structured_jd);
        setConstraints(detail.job.merged_constraints);
        setQueryBundle(detail.job.query_bundle);
        setKeywordMap(detail.job.keyword_map);
        setCandidates(detail.candidates);
        setSearchStats(detail.last_run?.stats ?? { ...EMPTY_STATS, deduplicated: detail.candidates.length });
        setQueryResults(detail.last_run?.query_results ?? []);
        setSelectedPlatform('All');
        setSelectedMatchTier('All');
        setStep(detail.candidates.length > 0 || detail.last_run ? 'search' : 'constraints');
        setProcessing(null);
        setLastStatus({
          message: detail.last_run
            ? `Session reopened · ${detail.candidates.length} profiles stored · last run ${new Date(detail.last_run.started_at).toLocaleString()}`
            : 'Session reopened · constraints ready, no search run yet',
          tone: 'info',
        });
      } catch (e: any) {
        if (cancelled) return;
        setProcessing(null);
        setError(e?.message || 'Could not open that session.');
        resetToNewSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, resetToNewSession]);

  const adoptSession = (id: string, title: string) => {
    loadedSessionRef.current = id;
    setSessionTitle(title);
    setSessionUpdatedAt(new Date().toISOString());
    router.replace(`/?session=${encodeURIComponent(id)}`);
    notifySessionsChanged();
  };

  // --- step 1: ingest -------------------------------------------------------

  const PARSE_STEPS: ProcessingStep[] = [
    { key: 'extract', label: 'Extract text from the JD', state: 'pending' },
    { key: 'structure', label: 'Structure title, seniority, skills and location', state: 'pending' },
    { key: 'queries', label: 'Fill the approved X-Ray query templates', state: 'pending' },
    { key: 'keywords', label: 'Build the keyword map', state: 'pending' },
    { key: 'session', label: 'Save as a new session', state: 'pending' },
  ];

  const handleParseJd = async (input: { file?: File; text?: string }) => {
    setIsLoading(true);
    setError(null);
    const signal = beginProcessing({
      stage: 'parse',
      title: input.file ? `Parsing ${input.file.name}` : 'Parsing pasted job description',
      status: 'Uploading…',
      progress: 0,
      steps: PARSE_STEPS,
    });
    try {
      const parsed = await api.parseJd(
        input,
        (event) => {
          if (event.type !== 'stage') return;
          const idx = PARSE_STEPS.findIndex((st) => st.key === event.key);
          patchProcessing({
            status: event.label,
            progress: idx >= 0 ? idx / PARSE_STEPS.length : null,
            steps: PARSE_STEPS.map((st, i) => ({ ...st, state: i < idx ? 'done' : i === idx ? 'active' : 'pending' })),
          });
        },
        signal
      );

      setRawJdText(parsed.raw_jd_text);
      setStructuredJD(parsed.structured_jd);
      setConstraints(parsed.merged_constraints);
      const queries = parsed.query_bundle?.length ? parsed.query_bundle : generateQueryBundleForConstraints(parsed.merged_constraints);
      setQueryBundle(queries);
      setKeywordMap(parsed.keyword_map);
      setCandidates([]);
      setSearchStats(EMPTY_STATS);
      setQueryResults([]);
      setStep('constraints');

      if (parsed.session?.id) {
        adoptSession(parsed.session.id, parsed.session.title);
        endProcessing(`Parsed · ${parsed.word_count} words · ${parsed.merged_constraints.must_have_skills.length} must-have skills · ${queries.length} queries drafted · session saved`);
      } else {
        endProcessing('Parsed, but no session was stored. Search results will not be saved.', 'error');
      }
    } catch (e: any) {
      if (signal.aborted) return;
      endProcessing(e?.message || 'Parsing failed.', 'error');
      throw e;
    } finally {
      setIsLoading(false);
    }
  };

  const loadDemoRole = async () => {
    setIsLoading(true);
    setError(null);
    beginProcessing({ stage: 'parse', title: 'Loading demo role', status: 'Storing the demo JD as a new session…', progress: null });
    try {
      const job = await api.createSession({
        raw_jd_text: INITIAL_DEMO_JOB.raw_jd_text,
        structured_jd: INITIAL_DEMO_JOB.structured_jd,
        merged_constraints: INITIAL_DEMO_JOB.merged_constraints,
        query_bundle: INITIAL_DEMO_JOB.query_bundle,
        keyword_map: INITIAL_DEMO_JOB.keyword_map,
        title: `${INITIAL_DEMO_JOB.title} · Demo`,
      });
      setRawJdText(job.raw_jd_text);
      setStructuredJD(job.structured_jd);
      setConstraints(job.merged_constraints);
      setQueryBundle(job.query_bundle);
      setKeywordMap(job.keyword_map);
      setCandidates([]);
      setSearchStats(EMPTY_STATS);
      setQueryResults([]);
      setStep('constraints');
      adoptSession(job.id, job.title);
      endProcessing(`Demo session created · ${job.query_bundle.length} queries ready to review`);
    } catch (e: any) {
      endProcessing(e?.message || 'Could not create the demo session.', 'error');
      setError(e?.message || 'Could not create the demo session.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- step 2: constraints → queries ---------------------------------------

  const QUERY_STEPS: ProcessingStep[] = [
    { key: 'vocab', label: 'Ask DeepSeek for title synonyms, skill spellings and adjacent terms', state: 'pending' },
    { key: 'templates', label: 'Fill the approved X-Ray templates for the selected platforms', state: 'pending' },
    { key: 'save', label: 'Save constraints and bundle to the session', state: 'pending' },
  ];
  const setQueryStep = (idx: number, status: string) =>
    patchProcessing({ status, progress: idx / QUERY_STEPS.length, steps: QUERY_STEPS.map((st, i) => ({ ...st, state: i < idx ? 'done' : i === idx ? 'active' : 'pending' })) });

  const handleConstraintsConfirmed = async (updated: MergedConstraints) => {
    setConstraints(updated);
    setIsLoading(true);
    setError(null);
    beginProcessing({ stage: 'queries', title: 'Generating X-Ray queries', status: '', progress: 0, steps: QUERY_STEPS });
    setQueryStep(0, `Building sourcing vocabulary for "${updated.job_title}"…`);

    const keys = api.readStoredApiKeys();
    let queries: XRayQuery[];
    try {
      const res = await fetch('/api/generate-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(keys.deepseek ? { 'x-deepseek-api-key': keys.deepseek } : {}) },
        body: JSON.stringify({ constraints: updated, apiKey: keys.deepseek }),
      });
      const data = await res.json();
      queries = data.success && data.queries ? data.queries : generateQueryBundleForConstraints(updated);
    } catch (e) {
      console.error('Failed to fetch DeepSeek queries:', e);
      queries = generateQueryBundleForConstraints(updated);
    }
    setQueryStep(1, `Assembled ${queries.length} queries across ${updated.selected_platforms.length} platforms…`);
    setQueryBundle(queries);

    let saveNote = '';
    if (sessionId) {
      setQueryStep(2, 'Saving constraints and the query bundle to the session…');
      try {
        const job = await api.updateSession(sessionId, { merged_constraints: updated, query_bundle: queries });
        setSessionTitle(job.title);
        setSessionUpdatedAt(job.updated_at);
        notifySessionsChanged();
      } catch (e: any) {
        saveNote = ' (not saved to the session)';
        setError(e?.message || 'Constraints were generated but could not be saved to the session.');
      }
    }

    setIsLoading(false);
    endProcessing(`${queries.length} queries generated for ${updated.selected_platforms.length} platforms${saveNote} · review and run`, saveNote ? 'error' : 'success');
    setIsQueryModalOpen(true);
  };

  // --- step 3: run --------------------------------------------------------------

  const handleRunSearch = async (queriesToRun: XRayQuery[], depth: number) => {
    setQueryBundle(queriesToRun);
    setIsQueryModalOpen(false);
    setError(null);
    if (!sessionId || !constraints) {
      setError('No active session. Parse a JD or load the demo role before running a search.');
      return;
    }

    setIsLoading(true);
    const total = queriesToRun.length;
    const initialItems: ProcessingLogItem[] = queriesToRun.map((q) => ({
      id: q.id,
      platform: q.platform,
      label: getTemplate(q.query_type)?.label ?? 'Custom query',
      state: 'active',
      meta: 'queued',
    }));
    const signal = beginProcessing({
      stage: 'search',
      title: `Running ${total} X-Ray ${total === 1 ? 'query' : 'queries'} individually`,
      status: 'Connecting to the search engine…',
      progress: 0,
      detail: `Depth: up to ${depth} ${depth === 1 ? 'page' : 'pages'} per query`,
      items: initialItems,
    });

    try {
      const data = await api.runSearch(
        { jobId: sessionId, constraints, queries: queriesToRun, apiKeys: api.readStoredApiKeys(), serpOptions: { maxPagesPerQuery: depth } },
        (event) => {
          if (event.type === 'query_start') {
            patchProcessing((prev) => ({
              status: `Searching ${platformLabel(event.platform)} · ${getTemplate(event.queryType)?.label ?? 'Custom query'}…`,
              items: prev.items?.map((it) => (it.id === event.queryId ? { ...it, meta: 'searching…' } : it)),
            }));
          } else if (event.type === 'query_done') {
            const r = event.result as QueryRunResult;
            patchProcessing((prev) => ({
              progress: (event.done / event.total) * 0.9,
              status: `${event.done} of ${event.total} queries done · ${event.indexedSoFar} profiles indexed so far`,
              detail: `${platformLabel(r.platform)} · ${getTemplate(r.queryType)?.label ?? 'Custom'}: ${r.indexedCount} indexed from ${r.resultCount} results${r.pagesFetched ? ` · ${r.pagesFetched} ${r.pagesFetched === 1 ? 'page' : 'pages'}` : ''}`,
              items: prev.items?.map((it) =>
                it.id === r.queryId
                  ? {
                      ...it,
                      state: r.status === 'completed' ? 'done' : r.status === 'skipped' ? 'skipped' : 'failed',
                      meta: r.status === 'completed' ? `${r.indexedCount}/${r.resultCount}${r.creditsUsed ? ` · ${r.creditsUsed}cr` : ''}` : r.error?.slice(0, 40) || r.status,
                    }
                  : it
              ),
            }));
          } else if (event.type === 'stage') {
            patchProcessing({ status: event.label, progress: 0.95 });
          }
        },
        signal
      );

      setCandidates(data.candidates);
      setSearchStats({ ...EMPTY_STATS, ...data.stats });
      setQueryResults(data.queryResults ?? []);
      setSelectedPlatform('All');
      setSelectedMatchTier('All');
      setStep('search');
      setSessionUpdatedAt(new Date().toISOString());
      notifySessionsChanged();
      endProcessing(
        `Run complete · ${data.stats.queriesRun}/${data.stats.queriesRun + data.stats.queriesFailed} queries · ${data.stats.total} indexed · ${data.candidates.length} profiles stored${data.stats.creditsUsed ? ` · ${data.stats.creditsUsed} credits` : ''}`,
        data.stats.queriesFailed > 0 && data.stats.queriesRun === 0 ? 'error' : 'success'
      );
    } catch (e: any) {
      if (signal.aborted) return;
      endProcessing(e?.message || 'The search run failed.', 'error');
      setError(e?.message || 'The search run failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- candidate edits ---------------------------------------------------------

  const applyCandidate = (updated: CandidateProfile) => {
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSelectedCandidate((cur) => (cur && cur.id === updated.id ? updated : cur));
  };

  const handleCandidateStatusChange = async (id: string, newStatus: CandidateStatus) => {
    const before = candidates.find((c) => c.id === id);
    if (!before) return;
    applyCandidate({ ...before, status: newStatus });
    try {
      applyCandidate(await api.updateCandidate(id, { status: newStatus }));
      notifySessionsChanged();
    } catch (e: any) {
      applyCandidate(before);
      setError(e?.message || 'Could not save the status change.');
    }
  };

  const handleUpdateCandidate = async (updated: CandidateProfile) => {
    const before = candidates.find((c) => c.id === updated.id);
    applyCandidate(updated);
    try {
      applyCandidate(
        await api.updateCandidate(updated.id, {
          status: updated.status,
          outreach_channel: updated.outreach_channel ?? null,
          next_follow_up: updated.next_follow_up || null,
          notes: updated.notes ?? null,
          tags: updated.tags ?? [],
        })
      );
      notifySessionsChanged();
    } catch (e: any) {
      if (before) applyCandidate(before);
      setError(e?.message || 'Could not save the changes.');
    }
  };

  const handleSaveOutreachLog = async (candidateId: string, channel: OutreachChannel, message: string) => {
    try {
      applyCandidate(await api.logOutreach(candidateId, channel, message));
      notifySessionsChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not log the outreach.');
    }
  };

  // --- derived ------------------------------------------------------------------

  const platformCounts = useMemo(() => {
    const m: Partial<Record<CandidatePlatform, number>> = {};
    for (const c of candidates) m[c.platform] = (m[c.platform] ?? 0) + 1;
    return m;
  }, [candidates]);

  const tierCounts = useMemo(() => {
    const t = { strong: 0, potential: 0, low: 0 };
    for (const c of candidates) t[scoreTier(c.match_score)]++;
    return t;
  }, [candidates]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const list = candidates.filter((c) => {
      const searchMatch = !q || c.name.toLowerCase().includes(q) || c.headline.toLowerCase().includes(q) || c.skills_detected.some((s) => s.toLowerCase().includes(q));
      const platformMatch = selectedPlatform === 'All' || c.platform === selectedPlatform;
      const tier = scoreTier(c.match_score);
      const tierMatch = selectedMatchTier === 'All' || (selectedMatchTier === 'Strong' && tier === 'strong') || (selectedMatchTier === 'Potential' && tier === 'potential') || (selectedMatchTier === 'Low' && tier === 'low');
      return searchMatch && platformMatch && tierMatch;
    });
    list.sort((a, b) => {
      if (sortBy === 'score') return b.match_score - a.match_score;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime();
    });
    return list;
  }, [candidates, searchTerm, selectedPlatform, selectedMatchTier, sortBy]);

  const hasRun = queryResults.length > 0 || candidates.length > 0;
  const stageStates: Record<FlowStageKey, StepState> = {
    ingest: processing?.stage === 'parse' ? 'active' : structuredJD ? 'done' : 'pending',
    constraints: processing?.stage === 'queries' ? 'active' : hasRun ? 'done' : structuredJD && step === 'constraints' ? 'active' : 'pending',
    search: processing?.stage === 'search' ? 'active' : hasRun ? 'done' : 'pending',
  };

  const constraintsLine = constraints
    ? [constraints.seniority !== 'Any' ? constraints.seniority : null, constraints.location || null, constraints.remote_eligible ? 'Remote OK' : null, constraints.must_have_skills.slice(0, 3).join(', ') || null]
        .filter(Boolean)
        .join(' · ')
    : null;

  const canJump = (key: FlowStageKey) => (key === 'ingest' ? true : key === 'constraints' ? Boolean(structuredJD) : hasRun);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={sessionId ? `Session${sessionUpdatedAt ? ` · saved ${timeAgo(sessionUpdatedAt)}` : ''}` : 'New search'}
        title={sessionTitle ?? 'Start from a job description'}
        description={constraintsLine ?? 'Parse a JD, confirm the constraints, then run each approved X-Ray query individually. Every profile the search engine returns is indexed and stored.'}
        actions={
          !sessionId ? (
            <button type="button" onClick={() => void loadDemoRole()} disabled={isLoading} className="btn-ghost">
              Load demo role
            </button>
          ) : (
            <>
              {structuredJD && step !== 'constraints' && (
                <button type="button" onClick={() => setStep('constraints')} className="btn-ghost">
                  Edit constraints
                </button>
              )}
              {queryBundle.length > 0 && (
                <button type="button" onClick={() => setIsQueryModalOpen(true)} disabled={isLoading} className="btn-primary">
                  {hasRun ? 'Re-run queries' : `Review ${queryBundle.length} queries`}
                </button>
              )}
            </>
          )
        }
      />

      {error && (
        <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep flex items-start justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-medium hover:underline flex-shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <StageStatusBar
        stages={stageStates}
        current={step}
        onSelect={(k) => canJump(k) && setStep(k)}
        busy={processing !== null}
        message={processing ? processing.status || processing.title : lastStatus.message}
        progress={processing ? processing.progress : undefined}
        tone={processing ? 'info' : lastStatus.tone}
      />

      {step === 'ingest' &&
        (sessionId && rawJdText ? (
          <section className="card">
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3">
              <h2 className="text-label-sm text-ink">Stored job description</h2>
              <button type="button" onClick={() => router.push('/')} className="btn-ghost">
                New session from another JD
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-body-sm text-body leading-relaxed p-5 max-h-[60vh] overflow-y-auto">{rawJdText}</pre>
          </section>
        ) : (
          <FileUploadZone onSubmit={handleParseJd} isLoading={isLoading} />
        ))}

      {step === 'constraints' && structuredJD && constraints && (
        <ConstraintsForm key={sessionId ?? 'new'} structuredJD={structuredJD} initialConstraints={constraints} onSubmit={handleConstraintsConfirmed} isLoading={isLoading} />
      )}

      {step === 'search' && (
        <div className="flex flex-col gap-4">
          {/* Stat strip */}
          <div className="card grid grid-cols-2 lg:grid-cols-4 divide-x divide-hairline overflow-hidden">
            <Stat value={searchStats.total} label="Profiles indexed · last run" />
            <Stat value={candidates.length} label="Stored profiles · all shown" />
            <Stat value={tierCounts.strong} label="Strong matches · 70+" />
            <Stat
              value={searchStats.queriesRun}
              suffix={` / ${searchStats.queriesRun + searchStats.queriesFailed}`}
              label={searchStats.creditsUsed ? `Queries run · ${searchStats.creditsUsed} credits` : 'Queries run · no credits spent'}
            />
          </div>

          {candidates.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
              <div className="card p-4 flex flex-col gap-3">
                <span className="eyebrow">Score distribution · {candidates.length} profiles</span>
                <div className="flex h-2.5 rounded-full overflow-hidden border border-hairline bg-hairline-soft" role="img" aria-label={`Strong ${tierCounts.strong}, potential ${tierCounts.potential}, low ${tierCounts.low}`}>
                  {(['strong', 'potential', 'low'] as const).map((t) => (
                    <div key={t} className={`${TIER_BG[t]} h-full`} style={{ width: `${(tierCounts[t] / candidates.length) * 100}%` }} />
                  ))}
                </div>
                <div className="flex gap-4 text-body-xs text-body">
                  {(['strong', 'potential', 'low'] as const).map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-[2px] ${TIER_BG[t]}`} />
                      {TIER_LABEL[t]} <span className="text-mute tabular-nums">{tierCounts[t]}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="card p-4 flex flex-col gap-3">
                <span className="eyebrow">Profiles per platform</span>
                <dl className="grid grid-cols-[100px_1fr_32px] gap-x-3 gap-y-1.5 items-center text-body-xs">
                  {PLATFORMS.filter((p) => platformCounts[p.id])
                    .sort((a, b) => (platformCounts[b.id] ?? 0) - (platformCounts[a.id] ?? 0))
                    .map((p) => (
                      <React.Fragment key={p.id}>
                        <dt className="text-body truncate">{p.label}</dt>
                        <dd className="track">
                          <div className="track-fill" style={{ width: `${((platformCounts[p.id] ?? 0) / candidates.length) * 100}%` }} />
                        </dd>
                        <dd className="text-mute tabular-nums text-right">{platformCounts[p.id]}</dd>
                      </React.Fragment>
                    ))}
                </dl>
              </div>
            </div>
          )}

          {queryResults.length > 0 && (
            <div className="card overflow-hidden">
              <button type="button" onClick={() => setShowReceipt((v) => !v)} className="w-full flex items-center justify-between px-4 h-10 text-left" aria-expanded={showReceipt}>
                <span className="text-body-sm text-ink font-medium">
                  Query run receipt <span className="text-mute font-normal">· {queryResults.length} searched individually</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-mute transition-transform ${showReceipt ? 'rotate-180' : ''}`} />
              </button>
              {showReceipt && (
                <div className="border-t border-hairline overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Platform</th>
                        <th>Template</th>
                        <th>Query</th>
                        <th className="text-right">Indexed / results</th>
                        <th>Provider</th>
                        <th className="text-right">Pages · credits</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {queryResults.map((r) => (
                        <tr key={r.queryId}>
                          <td>
                            <PlatformBadge platform={r.platform} />
                          </td>
                          <td className="text-ink whitespace-nowrap">{getTemplate(r.queryType)?.label ?? 'Custom'}</td>
                          <td className="max-w-[360px]">
                            <code className="font-mono text-body-xs text-mute block truncate" title={r.queryString}>
                              {r.queryString}
                            </code>
                          </td>
                          <td className="text-right tabular-nums whitespace-nowrap">
                            <span className="text-ink font-medium">{r.indexedCount}</span> <span className="text-mute">/ {r.resultCount}</span>
                          </td>
                          <td className="text-mute text-body-xs">
                            {r.provider === 'none' ? '—' : r.provider}
                            {r.notice && (
                              <span className="block text-faint" title={r.notice}>
                                {r.notice.length > 44 ? `${r.notice.slice(0, 44)}…` : r.notice}
                              </span>
                            )}
                          </td>
                          <td className="text-right text-mute tabular-nums text-body-xs whitespace-nowrap">
                            {r.pagesFetched || '—'} · {r.creditsUsed || 0}
                          </td>
                          <td className="text-right">
                            {r.status === 'completed' ? (
                              <Check className="w-3.5 h-3.5 text-ink inline" strokeWidth={2.5} />
                            ) : r.status === 'skipped' ? (
                              <Minus className="w-3.5 h-3.5 text-mute inline" />
                            ) : (
                              <span className="inline-flex items-center gap-1 text-body-xs text-warning-deep max-w-[220px]" title={r.error}>
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{r.error ? r.error.replace(/^SerpAPI:\s*/i, '') : 'failed'}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <FilterPanel
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedPlatform={selectedPlatform}
            setSelectedPlatform={setSelectedPlatform}
            selectedMatchTier={selectedMatchTier}
            setSelectedMatchTier={setSelectedMatchTier}
            sortBy={sortBy}
            setSortBy={setSortBy}
            viewMode={viewMode}
            setViewMode={setViewMode}
            totalCount={candidates.length}
            filteredCount={filtered.length}
            platformCounts={platformCounts}
          />

          {candidates.length === 0 ? (
            <div className="card p-10 flex flex-col items-center text-center gap-2">
              <p className="text-body-md font-medium text-ink">The queries ran, but the search engine indexed no profiles.</p>
              <p className="text-body-sm text-mute max-w-[52ch]">
                This happens when the free headless search is blocked (add a SerpAPI key in Settings) or the queries are too narrow. Check the receipt above, then broaden
                the title synonyms, drop a must-have skill, or add platforms and re-run.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-body-sm text-mute">No candidates match the current filters.</p>
            </div>
          ) : (
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' : 'flex flex-col gap-2'}>
              {filtered.map((c) => (
                <CandidateCard key={c.id} candidate={c} onSelect={setSelectedCandidate} onStatusChange={handleCandidateStatusChange} onOpenOutreach={setOutreachCandidate} viewMode={viewMode} />
              ))}
            </div>
          )}
        </div>
      )}

      <QueryPreviewModal
        isOpen={isQueryModalOpen}
        onClose={() => setIsQueryModalOpen(false)}
        queries={queryBundle}
        constraints={constraints}
        onConfirm={handleRunSearch}
        isLoading={isLoading}
      />

      {selectedCandidate && (
        <CandidateDetailDrawer
          key={selectedCandidate.id}
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onUpdateCandidate={handleUpdateCandidate}
          onOpenAIGenerator={setOutreachCandidate}
        />
      )}

      <ProcessingOverlay state={processing} onCancel={processing && processing.stage !== 'session' ? stopWaiting : undefined} />

      {outreachCandidate && (
        <OutreachGeneratorModal
          key={outreachCandidate.id}
          onClose={() => setOutreachCandidate(null)}
          candidate={outreachCandidate}
          jobTitle={constraints?.job_title || structuredJD?.job_title || 'the role'}
          onSaveOutreachLog={handleSaveOutreachLog}
        />
      )}
    </div>
  );
}

function Stat({ value, suffix, label }: { value: number; suffix?: string; label: string }) {
  return (
    <div className="px-4 py-3.5 flex flex-col gap-0.5">
      <span className="text-[24px] leading-7 font-semibold tracking-[-0.6px] text-ink tabular-nums">
        {value}
        {suffix && <span className="text-body-sm text-mute font-normal tracking-normal">{suffix}</span>}
      </span>
      <span className="text-body-xs text-mute">{label}</span>
    </div>
  );
}
