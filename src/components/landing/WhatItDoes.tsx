import React from 'react';
import { Container, SectionHeader } from './primitives';

// ---------------------------------------------------------------------------
// "What it does" — the four movements of a run, laid on one hairline that
// draws itself as the band scrolls into view (see Landing.tsx, data-flow-line).
// ---------------------------------------------------------------------------

const STEPS: Array<{ n: string; title: string; body: string }> = [
  {
    n: '01',
    title: 'Read the job description',
    body: 'Upload a PDF or DOCX, paste the text, or describe the role to the agent. Title, seniority, location, hard skills and domain terms are extracted. Soft skills are kept for scoring and never searched.',
  },
  {
    n: '02',
    title: 'Build the queries',
    body: 'Approved X-Ray templates are filled from your constraints and your additional details. Every string is fitted to Google’s 32-word limit and shown to you, in full, before it runs.',
  },
  {
    n: '03',
    title: 'Search and index',
    body: 'Each query is its own Google search with its own receipt: pages, credits, results. Every profile returned is indexed into the session. Relevance sorts the list, it never trims it.',
  },
  {
    n: '04',
    title: 'Track and reach out',
    body: 'Shortlist, take notes, move people through a six-stage pipeline, and draft outreach in your company’s name from your own templates. Every action is logged against the candidate.',
  },
];

export function WhatItDoes() {
  return (
    <section id="how" className="scroll-mt-16 py-20 md:py-28 border-t border-hairline bg-canvas" aria-labelledby="how-heading">
      <Container>
        <SectionHeader
          eyebrow="What it does"
          lines={[['from job description ', 'TO SHORTLIST']]}
          lead="One run takes a role from a document to a working pipeline. Four movements, each one visible and each one yours to edit."
        />

        <div className="relative mt-14 md:mt-16" data-flow>
          {/* The connecting line, drawn on scroll. */}
          {/* Runs from the first dot's centre to the last dot's centre (4 columns, 32px gaps, 11px dots). */}
          <div className="hidden lg:block absolute left-[5px] right-[calc(25%-30px)] top-[5px] h-px bg-hairline" aria-hidden="true">
            <div className="absolute inset-0 bg-ink origin-left" data-flow-line />
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10" data-reveal-group>
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-4" data-reveal-item>
                <div className="relative z-10 flex items-center gap-3 self-start pr-3 bg-canvas">
                  <span className="w-[11px] h-[11px] rounded-full bg-elevated border-2 border-ink" aria-hidden="true" />
                  <span className="font-mono text-body-sm text-mute tabular-nums">{s.n}</span>
                </div>
                <h3 className="text-heading-md text-ink">{s.title}</h3>
                <p className="text-body-md text-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
