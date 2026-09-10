import React from 'react';
import clsx from 'clsx';
import { Check, Upload, Loader2, ArrowRight } from 'lucide-react';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';
import { BOARD_STAGES } from '@/lib/pipeline/stages';
import { Container, SectionHeader } from './primitives';

// ---------------------------------------------------------------------------
// Walkthrough — the first search in seven steps. A sticky index on the left
// follows the reader (Landing.tsx flips `activeStep` from ScrollTriggers);
// each step on the right pairs a short instruction with an ink-on-white
// schematic of the screen involved, built from the app's own classes so it
// looks like the product, not a picture of it.
// ---------------------------------------------------------------------------

export const WALKTHROUGH_STEPS: Array<{ id: string; short: string; title: string; body: string }> = [
  {
    id: 'sign-in',
    short: 'Sign in and set up',
    title: 'Sign in with Google and set up in three fields',
    body: 'Your name, your company or organisation, and a SerpAPI key. The key is checked against your SerpAPI account before it is stored, encrypted, on the server. Outreach will later speak for the company you enter here.',
  },
  {
    id: 'start',
    short: 'Start a session',
    title: 'Start a session from a document or a conversation',
    body: 'Upload a PDF or DOCX, paste the text, or open the agent and describe the role. Every session is saved with its constraints, queries, receipts and candidates, and appears in the history panel beside the sidebar.',
  },
  {
    id: 'constraints',
    short: 'Confirm the constraints',
    title: 'Confirm what was extracted, then add your own details',
    body: 'Title, seniority, location, must-have skills and domain are read from the description; nothing is invented. The additional details box is yours: quoted or required phrases go into every query, exclusions come out of every query.',
  },
  {
    id: 'queries',
    short: 'Read the queries',
    title: 'Read every query before it runs',
    body: 'The bundle is grouped by platform and shown as syntax tokens: site and filetype operators, phrases, OR groups, exclusions. Open any row to edit it, or build your own. Set how many pages each query should fetch.',
  },
  {
    id: 'run',
    short: 'Run the search',
    title: 'Run it and follow the receipt',
    body: 'Each query is searched individually with live progress: pages fetched, credits used, profiles indexed. Runs continue in the background, so you can leave the page and come back to the results.',
  },
  {
    id: 'results',
    short: 'Work the results',
    title: 'Work the results',
    body: 'Filter by platform or tier, sort by relevance, open a profile in the drawer, take notes and shortlist. Nothing is hidden by score: what you see is everything Google returned, minus duplicates and non-profile pages.',
  },
  {
    id: 'pipeline',
    short: 'Move people forward',
    title: 'Move people through the pipeline and reach out',
    body: 'Six stages from New to Replied, on a board or in a table. Outreach is drafted in your company’s name from your own templates, with a connection note for the first touch, and every message is logged against the candidate.',
  },
];

// --- schematic pieces ---------------------------------------------------------

function Schematic({ label, right, children, className = '' }: { label: string; right?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('lp-schematic', className)} aria-hidden="true">
      <div className="lp-schematic-bar">
        <span className="eyebrow">{label}</span>
        {right && <span className="font-mono text-body-xs text-mute">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, trailing }: { label: string; value: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">{label}</span>
      <div className="input h-9 flex items-center justify-between gap-2 text-ink">
        <span className="truncate">{value}</span>
        {trailing}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label">{label}</span>
      <span className="text-body-sm text-ink">{value}</span>
    </div>
  );
}

function Token({ kind = 'plain', children }: { kind?: 'plain' | 'op' | 'bool' | 'not'; children: React.ReactNode }) {
  return <span className={clsx('lp-token', kind === 'op' && 'lp-token-op', kind === 'bool' && 'lp-token-bool', kind === 'not' && 'lp-token-not')}>{children}</span>;
}

function Bubble({ side, children }: { side: 'user' | 'agent'; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        'max-w-[88%] rounded-md px-3 py-2 text-body-sm leading-snug border',
        side === 'user' ? 'self-end bg-ink text-white border-ink' : 'self-start bg-elevated text-ink border-hairline',
      )}
    >
      {children}
    </div>
  );
}

// --- the seven schematics ------------------------------------------------------

function SetupSchematic() {
  return (
    <Schematic label="Onboarding" right="Step 3 of 3">
      <div className="p-5 flex flex-col gap-4 max-w-[380px]">
        <Field label="Your name" value="Priya Nair" />
        <Field label="Company or organisation" value="Northwind Labs" />
        <Field
          label="SerpAPI key"
          value="••••••••••••••••••••••••"
          trailing={
            <span className="chip gap-1 text-ink">
              <Check className="w-3 h-3" strokeWidth={2.5} /> Verified
            </span>
          }
        />
        <div className="flex justify-end">
          <span className="btn-primary btn-sm">Finish</span>
        </div>
      </div>
    </Schematic>
  );
}

function StartSchematic() {
  return (
    <Schematic label="New session" right="Ingest JD">
      <div className="p-5 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
        <div className="border border-dashed border-faint/60 rounded-md p-6 flex flex-col items-center justify-center gap-2 text-center bg-canvas min-h-[168px]">
          <Upload className="w-4 h-4 text-ink" strokeWidth={1.75} />
          <span className="text-body-sm text-ink">Drop a PDF or DOCX</span>
          <span className="text-body-xs text-mute">or paste the description below</span>
        </div>
        <div className="self-center eyebrow text-center">or</div>
        <div className="well p-3 flex flex-col gap-2 min-h-[168px]">
          <span className="eyebrow">Agent</span>
          <Bubble side="user">We need a senior backend engineer in Bengaluru. Go and Kubernetes, fintech background.</Bubble>
          <Bubble side="agent">Remote allowed, or on-site only?</Bubble>
          <span className="text-body-xs text-mute mt-auto">Ready: title, location, hard skills found. 1 question before the bundle.</span>
        </div>
      </div>
    </Schematic>
  );
}

function ConstraintsSchematic() {
  return (
    <Schematic label="Constraints" right="Constraints & queries">
      <div className="p-5 grid grid-cols-2 gap-5">
        <Row label="Title" value="Senior Backend Engineer" />
        <Row label="Seniority" value="Senior" />
        <Row label="Location" value="Bengaluru, remote allowed" />
        <Row label="Domain" value="Fintech, payments" />
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="field-label">Must-have skills</span>
          <div className="flex flex-wrap gap-1.5">
            {['Go', 'Kubernetes', 'PostgreSQL', 'gRPC'].map((s) => (
              <span key={s} className="chip">
                {s}
              </span>
            ))}
            <span className="chip text-mute">Communication (scored, not searched)</span>
          </div>
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="field-label text-ink">Additional details</span>
          <div className="textarea h-auto text-ink">Only fintech or payments companies. Exclude agencies and consultancies.</div>
          <p className="text-body-xs text-mute">
            Becomes <span className="font-mono">(fintech OR payments)</span> in every query, and <span className="font-mono">-agency -consultancy</span> on every query.
          </p>
        </div>
      </div>
    </Schematic>
  );
}

function QueriesSchematic() {
  const rows: Array<{ platform: 'LinkedIn' | 'GitHub' | 'StackOverflow'; tokens: React.ReactNode }> = [
    {
      platform: 'LinkedIn',
      tokens: (
        <>
          <Token kind="op">site:linkedin.com/in</Token>
          <Token>&quot;Senior Backend Engineer&quot;</Token>
          <Token kind="bool">(</Token>
          <Token>Go</Token>
          <Token kind="bool">OR</Token>
          <Token>Golang</Token>
          <Token kind="bool">)</Token>
          <Token>Kubernetes</Token>
          <Token>Bengaluru</Token>
          <Token>&quot;fintech&quot;</Token>
          <Token kind="not">-agency</Token>
          <Token kind="not">-jobs</Token>
        </>
      ),
    },
    {
      platform: 'GitHub',
      tokens: (
        <>
          <Token kind="op">site:github.com</Token>
          <Token>&quot;Bengaluru&quot;</Token>
          <Token>Go</Token>
          <Token>Kubernetes</Token>
          <Token kind="not">-jobs</Token>
        </>
      ),
    },
    {
      platform: 'StackOverflow',
      tokens: (
        <>
          <Token kind="op">site:stackoverflow.com/users</Token>
          <Token>Go</Token>
          <Token>Kubernetes</Token>
          <Token>&quot;Bengaluru&quot;</Token>
        </>
      ),
    },
  ];
  return (
    <Schematic label="Query bundle" right="16 queries, 9 platforms">
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.platform} className="px-4 py-3 flex items-start gap-3">
            <span className="mt-0.5 shrink-0">
              <PlatformLogo platform={r.platform} size={14} />
            </span>
            <div className="flex flex-wrap gap-1.5 min-w-0">{r.tokens}</div>
            <span className="ml-auto shrink-0 font-mono text-body-xs text-mute">5 pages</span>
          </li>
        ))}
      </ul>
      <div className="lp-schematic-bar border-b-0 border-t">
        <span className="font-mono text-body-xs text-mute">Depth 5 pages per query, 1 credit per page</span>
        <span className="font-mono text-body-xs text-ink">80 credits</span>
      </div>
    </Schematic>
  );
}

function RunSchematic() {
  const rows: Array<{ platform: 'LinkedIn' | 'GitHub' | 'StackOverflow' | 'Wellfound'; queries: number; pages: string; indexed: string; state: 'done' | 'active' | 'queued' }> = [
    { platform: 'LinkedIn', queries: 4, pages: '20 / 20', indexed: '41 indexed', state: 'done' },
    { platform: 'GitHub', queries: 2, pages: '10 / 10', indexed: '18 indexed', state: 'done' },
    { platform: 'StackOverflow', queries: 2, pages: '6 / 10', indexed: '9 indexed', state: 'active' },
    { platform: 'Wellfound', queries: 1, pages: '0 / 5', indexed: 'queued', state: 'queued' },
  ];
  return (
    <Schematic label="Search & index" right="Running in the background">
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.platform} className="px-4 h-11 flex items-center gap-3 text-body-sm">
            <PlatformLogo platform={r.platform} size={14} />
            <span className="text-ink w-28 truncate">{r.platform === 'StackOverflow' ? 'Stack Overflow' : r.platform}</span>
            <span className="hidden sm:inline text-mute font-mono text-body-xs w-20 whitespace-nowrap">
              {r.queries} {r.queries === 1 ? 'query' : 'queries'}
            </span>
            <span className="text-mute font-mono text-body-xs w-24 tabular-nums whitespace-nowrap">{r.pages} pages</span>
            <span className={clsx('ml-auto font-mono text-body-xs tabular-nums whitespace-nowrap', r.state === 'queued' ? 'text-faint' : 'text-ink')}>{r.indexed}</span>
            <span className="w-4 h-4 inline-flex items-center justify-center text-ink">
              {r.state === 'done' && <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
              {r.state === 'active' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            </span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-hairline flex flex-col gap-2">
        <div className="track">
          <div className="track-fill" style={{ width: '62%' }} />
        </div>
        <div className="flex justify-between font-mono text-body-xs text-mute tabular-nums">
          <span>11 of 16 queries</span>
          <span>68 profiles indexed, 52 credits used</span>
        </div>
      </div>
    </Schematic>
  );
}

function ResultsSchematic() {
  const cards: Array<{ platform: 'LinkedIn' | 'GitHub' | 'StackOverflow'; name: string; headline: string; score: number; tier: 'Strong' | 'Potential'; saved?: boolean }> = [
    { platform: 'LinkedIn', name: 'Aanya V.', headline: 'Senior Backend Engineer · Go, Kubernetes · Bengaluru', score: 86, tier: 'Strong', saved: true },
    { platform: 'GitHub', name: 'Rohan M.', headline: 'Platform engineer, payments infrastructure · Go, gRPC', score: 74, tier: 'Strong' },
    { platform: 'StackOverflow', name: 'Meera K.', headline: 'Backend developer · PostgreSQL, Go · Bengaluru', score: 58, tier: 'Potential' },
  ];
  return (
    <Schematic label="Candidates" right="Sorted by relevance">
      <div className="px-4 py-3 border-b border-hairline flex flex-wrap items-center gap-2">
        <span className="seg">
          {['All', 'LinkedIn', 'GitHub', 'Stack Overflow'].map((s, i) => (
            <span key={s} className={clsx('seg-item h-7 text-body-xs', i === 0 && 'is-on')}>
              {s}
            </span>
          ))}
        </span>
        <span className="chip-ink">Strong</span>
        <span className="chip">Potential</span>
        <span className="chip">Low</span>
      </div>
      <ul className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 lp-schematic-grid">
        {cards.map((c) => (
          <li key={c.name} className="card p-3 flex flex-col gap-2.5 shadow-whisper">
            <div className="flex items-center justify-between">
              <PlatformLogo platform={c.platform} size={14} />
              <span className={clsx('chip', c.saved && 'chip-ink')}>{c.saved ? 'Shortlisted' : 'Shortlist'}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm font-semibold text-ink">{c.name}</span>
              <span className="text-body-xs text-body leading-snug">{c.headline}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="track">
                <div className={clsx('track-fill', c.tier === 'Strong' ? 'bg-link' : 'bg-ink')} style={{ width: `${c.score}%` }} />
              </div>
              <span className="font-mono text-body-xs text-mute tabular-nums">{c.score}</span>
            </div>
          </li>
        ))}
      </ul>
    </Schematic>
  );
}

function PipelineSchematic() {
  const counts: Record<string, number> = { New: 3, Reviewed: 2, Saved: 1, Shortlisted: 2, Contacted: 1, Replied: 1 };
  return (
    <Schematic label="Pipeline" right="Board">
      <div className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {BOARD_STAGES.map((s) => (
          <div key={s.id} className="well p-2 flex flex-col gap-2 min-h-[132px]">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-ink truncate">{s.label}</span>
              <span className="font-mono text-body-xs text-mute tabular-nums">{counts[s.id] ?? 0}</span>
            </div>
            {Array.from({ length: counts[s.id] ?? 0 }).map((_, i) => (
              <div key={i} className="h-7 rounded-sm border border-hairline bg-elevated" />
            ))}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-hairline flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Outreach draft, LinkedIn connection note</span>
          <span className="font-mono text-body-xs text-mute inline-flex items-center gap-1">
            Shortlisted <ArrowRight className="w-3 h-3" /> Contacted
          </span>
        </div>
        <p className="text-body-sm text-ink leading-relaxed">
          Hi <span className="font-mono text-body-xs text-body">{'{{candidate_name}}'}</span>, I lead hiring at{' '}
          <span className="font-mono text-body-xs text-body">{'{{company_name}}'}</span>. Your work on Go and Kubernetes lines up with a{' '}
          <span className="font-mono text-body-xs text-body">{'{{role_title}}'}</span> role we are opening in Bengaluru.
        </p>
      </div>
    </Schematic>
  );
}

const SCHEMATICS: React.ComponentType[] = [SetupSchematic, StartSchematic, ConstraintsSchematic, QueriesSchematic, RunSchematic, ResultsSchematic, PipelineSchematic];

// --- section ------------------------------------------------------------------

export function Walkthrough({ activeStep }: { activeStep: number }) {
  return (
    <section id="walkthrough" className="scroll-mt-16 py-20 md:py-28 border-t border-hairline bg-canvas" aria-labelledby="walkthrough-heading">
      <Container>
        <SectionHeader
          eyebrow="How to use it"
          lines={[['your first search ', 'IN SEVEN STEPS']]}
          lead="From sign-in to a candidate in conversation. Nothing to install; a Google account and a SerpAPI key are all you need."
        />

        <div className="mt-14 md:mt-16 grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-10 lg:gap-20 items-start">
          <ol className="hidden lg:flex flex-col sticky top-16 self-start" aria-label="Steps" data-reveal>
            {WALKTHROUGH_STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#step-${s.id}`} className={clsx('lp-step-link', i === activeStep && 'is-active')} aria-current={i === activeStep ? 'step' : undefined}>
                  <span className="font-mono text-body-xs tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-body-md">{s.short}</span>
                </a>
              </li>
            ))}
          </ol>

          <ol className="flex flex-col">
            {WALKTHROUGH_STEPS.map((s, i) => {
              const Fig = SCHEMATICS[i];
              return (
                <li key={s.id} id={`step-${s.id}`} className="scroll-mt-16 py-10 md:py-14 first:pt-0 border-t border-hairline first:border-t-0 grid gap-6" data-step>
                  <div className="flex flex-col gap-3 max-w-[640px]" data-reveal>
                    <span className="eyebrow tracking-[0.06em]">Step {String(i + 1).padStart(2, '0')}</span>
                    <h3 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.6px] text-ink">{s.title}</h3>
                    <p className="text-body-lg text-body">{s.body}</p>
                  </div>
                  <div data-reveal>
                    <Fig />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </Container>
    </section>
  );
}
