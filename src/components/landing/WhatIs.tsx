import React from 'react';
import { PLATFORMS } from '@/lib/search/platforms';
import { TOTAL_TEMPLATE_COUNT } from '@/lib/search/xrayTemplates';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';
import { Container, SectionHeader } from './primitives';

// ---------------------------------------------------------------------------
// "What is RADR.?" — one paragraph of definition, four numbers that describe
// the engine's rules, and the closed list of platforms it searches. The
// numbers are read from the registries so they cannot drift from the product.
// ---------------------------------------------------------------------------

export function WhatIs() {
  const stats: Array<[string, string, string]> = [
    [String(PLATFORMS.length), 'platforms searched', 'A closed, reviewed list. Nothing is added quietly.'],
    [String(TOTAL_TEMPLATE_COUNT), 'approved query templates', 'Fixed X-Ray patterns, filled from your constraints.'],
    ['1', 'search per query', 'Each string gets its own Google call and its own receipt.'],
    ['0', 'profiles hidden by score', 'Relevance orders the list. It never trims it.'],
  ];

  return (
    <section id="what" className="scroll-mt-16 py-20 md:py-28" aria-labelledby="what-heading">
      <Container>
        <SectionHeader
          eyebrow="What is RADR."
          lines={[
            ['a sourcing engine that ', 'SHOWS ITS WORK'],
          ]}
          lead="RADR. turns a job description into a set of approved X-Ray searches, runs each one against Google, and indexes every public profile the engine returns. Nothing is scraped from behind a login, and nothing is hidden by a score. You read every query before it runs, and every result after."
        />

        <dl className="mt-14 md:mt-16 grid grid-cols-2 lg:grid-cols-4 border border-hairline rounded-md bg-elevated overflow-hidden" data-reveal-group>
          {stats.map(([value, label, note], i) => (
            <div
              key={label}
              className={[
                'flex flex-col gap-3 p-6 md:p-7',
                i % 2 === 1 ? 'border-l border-hairline' : '',
                i >= 2 ? 'border-t border-hairline lg:border-t-0' : '',
                i === 2 ? 'lg:border-l' : '',
              ].join(' ')}
              data-reveal-item
            >
              <dt className="eyebrow tracking-[0.06em]">{label}</dt>
              <dd className="flex flex-col gap-2">
                <span className="text-[44px] leading-none font-semibold tracking-[-2px] text-ink tabular-nums">{value}</span>
                <span className="text-body-sm text-body">{note}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 flex flex-col gap-4" data-reveal>
          <span className="eyebrow tracking-[0.06em]">Where it looks</span>
          <ul className="flex flex-wrap gap-2" aria-label="Platforms searched">
            {PLATFORMS.map((p) => (
              <li key={p.id} className="chip h-8 px-3 text-body-sm text-ink gap-2" title={p.description}>
                <PlatformLogo platform={p.id} size={14} />
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
