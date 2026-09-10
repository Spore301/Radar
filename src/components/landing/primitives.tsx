import React from 'react';
import Link from 'next/link';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Small shared pieces for the landing page: the 1172px container, the mono
// section headline, the eyebrow, and the two black-bordered mono buttons the
// Figma hero defines. Everything else on the page is composed from these.
// ---------------------------------------------------------------------------

export function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('lp-container', className)}>{children}</div>;
}

export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx('eyebrow tracking-[0.06em]', className)}>{children}</span>;
}

/**
 * A two-line mono headline in the hero's voice: lowercase at weight 400 with
 * the emphasised word set UPPERCASE at 600. `lines` is [lead, EMPHASIS][].
 */
export function MonoHeading({
  lines,
  as: Tag = 'h2',
  size = 'section',
  className = '',
  ...rest
}: {
  lines: ReadonlyArray<readonly [string, string]>;
  as?: 'h1' | 'h2' | 'p';
  size?: 'hero' | 'section' | 'cta';
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Tag className={clsx('lp-h', `lp-h-${size}`, className)} {...rest}>
      {lines.map(([lead, emphasis], i) => (
        <span key={i} className="block" data-hero-line={size === 'hero' ? '' : undefined}>
          {lead}
          <strong>{emphasis}</strong>
        </span>
      ))}
    </Tag>
  );
}

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
};

export function LandingButton({ href, children, variant = 'primary', className = '' }: ButtonProps) {
  const cls = clsx('lp-btn', variant === 'primary' ? 'lp-btn-primary' : 'lp-btn-secondary', className);
  // In-page anchors stay plain <a> so the browser's own smooth scroll applies.
  if (href.startsWith('#')) {
    return (
      <a href={href} className={cls}>
        <span>{children}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      <span>{children}</span>
    </Link>
  );
}

export function SectionHeader({
  eyebrow,
  lines,
  lead,
}: {
  eyebrow: string;
  lines: ReadonlyArray<readonly [string, string]>;
  lead?: string;
}) {
  return (
    <div className="flex flex-col gap-5 max-w-[720px]" data-reveal>
      <Eyebrow>{eyebrow}</Eyebrow>
      <MonoHeading lines={lines} className="[text-wrap:balance]" />
      {lead && <p className="text-[18px] leading-[1.5] text-body">{lead}</p>}
    </div>
  );
}
