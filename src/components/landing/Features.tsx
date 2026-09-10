import React from 'react';
import { Braces, Database, Quote, MessagesSquare, History, KeyRound, type LucideIcon } from 'lucide-react';
import { Container, SectionHeader } from './primitives';

// ---------------------------------------------------------------------------
// Features — six hairline cards in a 3 x 2 grid. Each column drifts at its own
// speed while scrolling (data-parallax on the wrapper, in px); the card inside
// carries the reveal so the two transforms never fight.
// ---------------------------------------------------------------------------

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Braces,
    title: 'Approved templates, readable strings',
    body: 'Queries come from a fixed list of reviewed X-Ray templates. Read every string before it runs, edit it in the query editor, or build your own from syntax chips.',
  },
  {
    icon: Database,
    title: 'Every result, indexed',
    body: 'No liveness checks, no page scraping, no score cut-off. Only non-profile URLs and exact duplicates are dropped. What Google returned is what you see.',
  },
  {
    icon: Quote,
    title: 'Your words carry the most weight',
    body: 'Additional details on the constraints form become required phrases and exclusions in every query. “Only fintech, no agencies” means exactly that.',
  },
  {
    icon: MessagesSquare,
    title: 'Agent mode',
    body: 'Describe the role in conversation instead. The agent shows its reasoning, asks at most two blocking questions, and builds the same approved bundle.',
  },
  {
    icon: History,
    title: 'Sessions that remember',
    body: 'Every run is a session: constraints, queries, receipts, candidates, notes and outreach. Re-runs refresh scores but never overwrite your edits.',
  },
  {
    icon: KeyRound,
    title: 'Your key, your depth',
    body: 'Bring your own SerpAPI key; it is stored encrypted, server-side. Choose how many pages each query fetches, one credit per page, all shown on the receipt.',
  },
];

// Vertical drift per column, in px, from top-of-viewport to bottom.
const DRIFT = [0, 22, 10];

export function Features() {
  return (
    <section id="features" className="scroll-mt-16 py-20 md:py-28 border-t border-hairline" aria-labelledby="features-heading">
      <Container>
        <SectionHeader
          eyebrow="Features"
          lines={[['built for recruiters who ', 'READ THE QUERY']]}
          lead="The engine is deliberately legible. Every rule below exists so that you can explain, to anyone, why a profile is on the list."
        />

        <ul className="mt-14 md:mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-reveal-group>
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <li key={f.title} className="will-change-transform" data-parallax={DRIFT[i % 3]}>
                <div className="card h-full p-6 flex flex-col gap-4 shadow-whisper" data-reveal-item>
                  <span className="w-8 h-8 rounded-sm border border-hairline bg-canvas text-ink inline-flex items-center justify-center" aria-hidden="true">
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                  <h3 className="text-heading-md text-ink">{f.title}</h3>
                  <p className="text-body-md text-body">{f.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
