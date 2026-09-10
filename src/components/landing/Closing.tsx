import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { RadrLogo } from '@/components/brand/RadrLogo';
import { Container, LandingButton, MonoHeading } from './primitives';

// ---------------------------------------------------------------------------
// Closing CTA band and a one-line footer. The band repeats the hero's line in
// the same mono voice so the page ends where it began.
// ---------------------------------------------------------------------------

export function Closing() {
  return (
    <div className="relative overflow-hidden border-t border-hairline" data-closing>
      <div className="lp-clouds" aria-hidden="true" data-clouds>
        <Image src="/hero/clouds.jpg" alt="" fill sizes="100vw" className="object-cover object-bottom" />
      </div>
      <div className="lp-clouds-fade" aria-hidden="true" />

      <section className="relative py-24 md:py-32" aria-labelledby="cta-heading">
        <Container className="flex flex-col items-start gap-8">
          <MonoHeading
            as="p"
            size="cta"
            lines={[
              ['see every ', 'CANDIDATE.'],
              ['own every ', 'DECISION.'],
            ]}
            data-reveal=""
          />
          <p className="text-[18px] leading-[1.5] text-body max-w-[52ch]" data-reveal>
            Sign in with Google, add your SerpAPI key, and run your first search in minutes. Nothing to install.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-[10px]" data-reveal>
            <LandingButton href="/signin" className="sm:min-w-[220px]">
              Find Your Next Hire
            </LandingButton>
            <LandingButton href="#walkthrough" variant="secondary" className="sm:min-w-[180px]">
              See the walkthrough
            </LandingButton>
          </div>
        </Container>
      </section>

      <footer className="relative border-t border-ink/10">
        <Container className="h-16 flex items-center justify-between text-body-sm text-body">
          <Link href="/" className="text-ink inline-flex items-center" aria-label="RADR. home">
            <RadrLogo height={16} />
          </Link>
          <nav className="flex items-center gap-6" aria-label="Footer">
            <a href="#what" className="hover:text-ink transition-colors">
              What is RADR.
            </a>
            <a href="#features" className="hover:text-ink transition-colors">
              Features
            </a>
            <Link href="/signin" className="hover:text-ink transition-colors">
              Sign in
            </Link>
          </nav>
        </Container>
      </footer>
    </div>
  );
}
