'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { RadrLogo } from '@/components/brand/RadrLogo';
import { LandingButton, MonoHeading } from './primitives';

// ---------------------------------------------------------------------------
// Hero, from the Figma handoff.
//
//   Canvas 1532 x 984. Video region 1532 x 880 (object-fit: cover). A top,
//   left and right white fade sit over the video; a separate bottom fade runs
//   from y 620 to 984 and overlaps the video by 260px, which is what produces
//   the broad white wash below the radar while its centre stays sharp.
//   Nav at y 50 (40 tall, logo 95 x 27.5, 205 x 40 CTA). Content at y 180:
//   Geist Mono 40 headline, Geist 20 copy 30 below, actions 30 below that.
//
// Geometry lives in globals.css (.lp-hero*) as percentages of the hero so it
// scales with the viewport; this file is the markup and the video wiring.
// ---------------------------------------------------------------------------

export function Hero() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // React can drop the `muted` attribute on hydration, and browsers refuse to
  // autoplay a video with sound; set it imperatively and nudge playback.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }, []);

  return (
    <section className="lp-hero" data-hero>
      <div className="lp-hero-media" data-hero-video>
        <video
          ref={videoRef}
          src="/hero/radar.mp4"
          poster="/hero/radar-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      <div className="lp-hero-edges" aria-hidden="true" />
      <div className="lp-hero-bottom" aria-hidden="true" />

      <div className="lp-hero-content lp-container">
        <nav className="h-10 mt-[50px] flex items-center justify-between" data-hero-nav aria-label="Primary">
          <Link href="/" className="text-black inline-flex items-center" aria-label="RADR. home">
            <RadrLogo height={27.5} />
          </Link>
          <LandingButton href="/signin" variant="secondary" className="min-w-0 px-5 sm:min-w-[205px]">
            Join Our Platform
          </LandingButton>
        </nav>

        <div className="mt-16 md:mt-[90px] flex flex-col items-start" data-hero-copy>
          <MonoHeading
            as="h1"
            size="hero"
            lines={[
              ['see every ', 'CANDIDATE'],
              ['own every ', 'DECISION'],
            ]}
            className="text-black"
          />
          <p className="mt-[30px] max-w-[62rem] text-[17px] sm:text-[20px] leading-[1.41] text-black" data-hero-line>
            Track movement through your pipeline. Know exactly who&apos;s in, who&apos;s next, and why they matter.
          </p>
          <div className="mt-[30px] flex flex-col sm:flex-row items-stretch sm:items-center gap-[10px]" data-hero-line>
            <LandingButton href="/signin" className="sm:min-w-[220px]">
              Find Your Next Hire
            </LandingButton>
            <LandingButton href="#what" variant="secondary" className="sm:min-w-[180px]">
              What is <RadrLogo height={11} className="inline-block align-[-1px] mx-[1px]" />?
            </LandingButton>
          </div>
        </div>
      </div>
    </section>
  );
}
