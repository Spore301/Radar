'use client';

import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

import { Hero } from './Hero';
import { WhatIs } from './WhatIs';
import { WhatItDoes } from './WhatItDoes';
import { Features } from './Features';
import { Walkthrough } from './Walkthrough';
import { Closing } from './Closing';

// ---------------------------------------------------------------------------
// The public landing page, and all of its motion in one place.
//
// Motion rules, so it stays smooth:
//   - Only transform and opacity are animated. Scrubbed tweens use `scrub`
//     with a small lag so the wheel never fights the animation.
//   - Reveals run once; parallax runs on the hero video and, on wide screens,
//     the feature-card columns. Nothing animates layout.
//   - `prefers-reduced-motion` gets no animation at all: the page renders
//     visible and static, and the walkthrough index still follows scroll.
//   - Everything is created inside gsap.matchMedia so React's dev double-mount
//     and the unmount both tear it down cleanly.
// ---------------------------------------------------------------------------

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
    ScrollTrigger.config({ ignoreMobileResize: true });

    const mm = gsap.matchMedia();
    const q = gsap.utils.selector(root);

    // Walkthrough index: which step is at the middle of the viewport. Runs in
    // every context, including reduced motion.
    mm.add('all', () => {
      q<HTMLElement>('[data-step]').forEach((el, i) => {
        ScrollTrigger.create({
          trigger: el,
          start: 'top 55%',
          end: 'bottom 55%',
          onToggle: (self) => {
            if (self.isActive) setActiveStep(i);
          },
        });
      });
    });

    // Everything that should run exactly once per visit. Keyed only on the
    // motion preference, so a viewport resize never replays the hero intro.
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      root.classList.add('has-motion');

      // Hero intro: video settles, nav drops in, copy rises line by line.
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from(q('[data-hero-video]'), { opacity: 0, scale: 1.04, duration: 1.6, ease: 'power2.out' }, 0)
        .from(q('[data-hero-nav]'), { y: -10, opacity: 0, duration: 0.7 }, 0.1)
        .from(q('[data-hero-line]'), { y: 28, opacity: 0, duration: 0.9, stagger: 0.09 }, 0.25);

      // Hero parallax: the video drifts down at a fraction of scroll speed
      // while the copy lifts away and fades.
      const hero = q('[data-hero]')[0];
      // Explicit start values: a `to` tween would record whatever state the
      // element happens to be in when it is built.
      gsap.fromTo(
        q('[data-hero-video]'),
        { yPercent: 0 },
        { yPercent: 16, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.8 } },
      );
      gsap.fromTo(
        q('[data-hero-copy]'),
        { y: 0, opacity: 1 },
        { y: -72, opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: '75% top', scrub: 0.8 } },
      );

      // Reveals: single blocks, and groups whose items stagger.
      q<HTMLElement>('[data-reveal]').forEach((el) => {
        gsap.fromTo(
          el,
          { y: 28, opacity: 0 },
          { y: 0, opacity: 1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } },
        );
      });
      q<HTMLElement>('[data-reveal-group]').forEach((group) => {
        const items = group.querySelectorAll<HTMLElement>('[data-reveal-item]');
        gsap.fromTo(
          items,
          { y: 28, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: group, start: 'top 85%', once: true } },
        );
      });

      // "What it does": the connecting hairline draws left to right.
      gsap.fromTo(
        q('[data-flow-line]'),
        { scaleX: 0 },
        { scaleX: 1, ease: 'none', scrollTrigger: { trigger: q('[data-flow]')[0], start: 'top 80%', end: 'top 30%', scrub: 0.6 } },
      );

      // Closing band: the clouds drift up slightly as the foot of the page
      // arrives, in step with the hero video's parallax.
      const clouds = q('[data-clouds]')[0];
      if (clouds) {
        gsap.fromTo(
          clouds,
          { yPercent: -8 },
          { yPercent: 0, ease: 'none', scrollTrigger: { trigger: q('[data-closing]')[0], start: 'top bottom', end: 'bottom bottom', scrub: 0.8 } },
        );
      }

      return () => root.classList.remove('has-motion');
    });

    // Feature columns drift at different speeds on wide screens only. This is
    // the one block that depends on width, so it is the only one a resize
    // across 1024px tears down and rebuilds.
    mm.add('(prefers-reduced-motion: no-preference) and (min-width: 1024px)', () => {
      q<HTMLElement>('[data-parallax]').forEach((el) => {
        const drift = parseFloat(el.dataset.parallax ?? '0');
        if (!drift) return;
        gsap.fromTo(el, { y: drift }, { y: -drift, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.8 } });
      });
    });

    // In-page links ("What is RADR.?", footer, walkthrough index) glide to
    // their target instead of jumping. Distance sets the duration; the wheel
    // interrupts it (autoKill); reduced motion gets a plain jump.
    const onAnchorClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!anchor) return;
      const id = decodeURIComponent(anchor.getAttribute('href')!.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      const offsetY = 64; // matches the sections' scroll-mt-16
      const y = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offsetY);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.scrollTo(0, y);
      } else {
        const distance = Math.abs(y - window.scrollY);
        gsap.to(window, { scrollTo: { y, autoKill: true }, duration: Math.min(1.4, 0.55 + distance / 2800), ease: 'power2.inOut', overwrite: 'auto' });
      }
      history.pushState(null, '', `#${id}`);
    };
    root.addEventListener('click', onAnchorClick);

    // Fonts and the video poster can change heights after first paint.
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', refresh);
    return () => {
      window.removeEventListener('load', refresh);
      root.removeEventListener('click', onAnchorClick);
      mm.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className="landing min-h-screen flex flex-col">
      <Hero />
      <main className="flex-1">
        <WhatIs />
        <WhatItDoes />
        <Features />
        <Walkthrough activeStep={activeStep} />
      </main>
      <Closing />
    </div>
  );
}
