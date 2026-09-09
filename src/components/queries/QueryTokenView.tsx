'use client';

import React from 'react';
import { QueryToken, TokenKind, tokenize, splitOperator, KIND_LABEL } from '@/lib/search/queryTokens';

// ---------------------------------------------------------------------------
// Query syntax pills. Every syntax element has its own colour so a query can
// be read by shape at a glance, and so the palette chip a recruiter drags in
// looks identical to the pill it becomes:
//   site:        blue        filetype:   violet      intitle:    teal
//   inurl:/intext: cyan      OR          amber       AND         orange
//   AROUND(n)    magenta     "phrase"    green       −exclusion  red
//   bare word    ink on grey             ( )         grey brackets
// ---------------------------------------------------------------------------

export type TokenFamily = 'site' | 'filetype' | 'intitle' | 'inurl' | 'or' | 'and' | 'proximity' | 'phrase' | 'word' | 'exclude' | 'paren';

export interface TokenPalette {
  fg: string;
  bg: string;
  border: string;
  label: string;
}

export const TOKEN_COLOURS: Record<TokenFamily, TokenPalette> = {
  site: { fg: '#0b4fbf', bg: '#e6f0ff', border: '#9dbdf7', label: 'site:' },
  filetype: { fg: '#6620ad', bg: '#f1e8ff', border: '#c8a8f2', label: 'filetype:' },
  intitle: { fg: '#0b7a6e', bg: '#e3f7f4', border: '#8fd6cc', label: 'intitle:' },
  inurl: { fg: '#0b6a8c', bg: '#e3f3fa', border: '#8fcbe0', label: 'inurl: / intext:' },
  or: { fg: '#9a5b00', bg: '#fff3dd', border: '#f2c26b', label: 'OR' },
  and: { fg: '#b3400f', bg: '#ffeadf', border: '#f2a683', label: 'AND' },
  proximity: { fg: '#a5165e', bg: '#fde7f1', border: '#f0a3c6', label: 'AROUND(n)' },
  phrase: { fg: '#146c2e', bg: '#e6f6ea', border: '#98d6aa', label: '"exact phrase"' },
  word: { fg: '#3d3d3d', bg: '#f2f2f2', border: '#dcdcdc', label: 'word' },
  exclude: { fg: '#b3161b', bg: '#fdeceb', border: '#f0a3a5', label: '−exclude' },
  paren: { fg: '#8f8f8f', bg: 'transparent', border: 'transparent', label: '( )' },
};

export function familyOf(token: Pick<QueryToken, 'kind' | 'text'>): TokenFamily {
  switch (token.kind) {
    case 'operator': {
      const p = splitOperator(token.text).prefix.toLowerCase();
      if (p.startsWith('site')) return 'site';
      if (p.startsWith('filetype')) return 'filetype';
      if (p.startsWith('intitle') || p.startsWith('allintitle')) return 'intitle';
      return 'inurl';
    }
    case 'bool':
      return token.text === 'OR' ? 'or' : 'and';
    case 'proximity':
      return 'proximity';
    case 'phrase':
      return 'phrase';
    case 'exclude':
      return 'exclude';
    case 'open':
    case 'close':
      return 'paren';
    default:
      return 'word';
  }
}

export function pillStyle(family: TokenFamily): React.CSSProperties {
  const c = TOKEN_COLOURS[family];
  return { color: c.fg, backgroundColor: c.bg, borderColor: c.border };
}

/** Strip the `kind` guard so palette chips can pass a partial token. */
type PillToken = Pick<QueryToken, 'kind' | 'text'> & { id?: string };

export function TokenPill({ token, className = '', children, title }: { token: PillToken; className?: string; children?: React.ReactNode; title?: string }) {
  const family = familyOf(token);
  if (family === 'paren') {
    return <span className={`font-mono text-body-md leading-[22px] px-0.5 select-none ${className}`} style={{ color: TOKEN_COLOURS.paren.fg }}>{token.text}</span>;
  }
  let label: React.ReactNode = token.text;
  if (token.kind === 'operator') {
    const { prefix, value } = splitOperator(token.text);
    label = (
      <>
        <span className="font-semibold">{prefix}</span>
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
      title={title ?? KIND_LABEL[token.kind as TokenKind]}
      data-family={family}
      style={pillStyle(family)}
      className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border font-mono text-body-xs whitespace-nowrap max-w-full ${className}`}
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

/** Small colour key — shown once under the editor so the palette is self-explaining. */
export function TokenLegend() {
  const shown: TokenFamily[] = ['site', 'filetype', 'intitle', 'inurl', 'or', 'and', 'proximity', 'phrase', 'exclude', 'word'];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-body-xs text-mute">
      {shown.map((f) => (
        <span key={f} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] border" style={{ backgroundColor: TOKEN_COLOURS[f].bg, borderColor: TOKEN_COLOURS[f].border }} />
          <span className="font-mono">{TOKEN_COLOURS[f].label}</span>
        </span>
      ))}
    </div>
  );
}
