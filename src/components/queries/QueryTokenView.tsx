'use client';

import React from 'react';
import { QueryToken, TokenKind, tokenize, splitOperator, KIND_LABEL } from '@/lib/search/queryTokens';

// ---------------------------------------------------------------------------
// Read-only rendering of a query as syntax pills. Every kind has a fixed look
// so a recruiter can scan a query's shape without parsing Boolean by eye:
//   operator  ink pill, white text          site:linkedin.com/in/
//   boolean   soft-grey pill, small caps    OR · AND
//   proximity soft-grey pill                AROUND(5)
//   phrase    white pill, hairline, ink     "Senior Product Designer"
//   word      white pill, hairline, body    Figma
//   exclusion white pill, red text          −intitle:job
//   groups    bare parentheses in grey
// ---------------------------------------------------------------------------

export const TOKEN_STYLES: Record<TokenKind, string> = {
  operator: 'bg-ink text-white border-ink',
  bool: 'bg-hairline-soft text-body border-hairline-soft uppercase tracking-wide text-[10px]',
  proximity: 'bg-hairline-soft text-body border-hairline-soft',
  phrase: 'bg-elevated text-ink border-hairline',
  word: 'bg-elevated text-body border-hairline',
  exclude: 'bg-elevated text-error-deep border-hairline',
  open: '',
  close: '',
};

export function TokenPill({ token, className = '', children }: { token: QueryToken; className?: string; children?: React.ReactNode }) {
  if (token.kind === 'open' || token.kind === 'close') {
    return <span className={`font-mono text-body-md text-mute leading-[22px] px-0.5 select-none ${className}`}>{token.text}</span>;
  }
  let label: React.ReactNode = token.text;
  if (token.kind === 'operator') {
    const { prefix, value } = splitOperator(token.text);
    label = (
      <>
        <span className="opacity-70">{prefix}</span>
        {value}
      </>
    );
  } else if (token.kind === 'exclude') {
    label = (
      <>
        <span className="font-semibold">−</span>
        {token.text.slice(1)}
      </>
    );
  }
  return (
    <span
      title={KIND_LABEL[token.kind]}
      className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border font-mono text-body-xs whitespace-nowrap max-w-full ${TOKEN_STYLES[token.kind]} ${className}`}
    >
      <span className="truncate">{label}</span>
      {children}
    </span>
  );
}

export function QueryTokenView({ query, className = '' }: { query: string; className?: string }) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return <span className="text-body-xs text-faint">Empty query</span>;
  return (
    <div className={`flex flex-wrap items-center gap-x-1 gap-y-1.5 ${className}`} aria-label={query}>
      {tokens.map((t) => (
        <TokenPill key={t.id} token={t} />
      ))}
    </div>
  );
}
