'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { tokenize, isBalanced, type TokenKind } from '@/lib/search/queryTokens';
import { QueryTokenView, TokenPill, TokenLegend } from './QueryTokenView';
import { countGoogleWords, GOOGLE_WORD_LIMIT } from '@/lib/search/xrayTemplates';
import { PLATFORMS } from '@/lib/search/platforms';

// ---------------------------------------------------------------------------
// Query editor: a text box you can type keywords into and drag syntax chips
// onto. The chips are the query's syntax elements only — operators, Boolean
// logic, grouping, phrase and exclusion markers — each in its own colour, and
// the live pill view above the box shows the query the same way.
//
// Dropping works through the browser's native text drop: a chip carries
// `text/plain`, so the browser inserts it at the exact drop position inside
// the textarea (with the caret following) and fires onChange. Clicking a chip
// inserts it at the caret instead. No drag library, no custom caret math.
// ---------------------------------------------------------------------------

interface PaletteChip {
  text: string;
  kind: TokenKind;
  /** Where to leave the caret after insertion, relative to the inserted text's end (negative = inside). */
  caretOffset?: number;
  /** Shown in the chip when the raw text alone isn't self-explanatory. */
  display?: string;
}

const chip = (text: string, kind: TokenKind, extra: Partial<PaletteChip> = {}): PaletteChip => ({ text, kind, ...extra });

const OPERATORS: PaletteChip[] = [
  chip('site:', 'operator'),
  ...PLATFORMS.filter((p) => !p.anyHost).map((p) =>
    chip(p.id === 'LinkedIn' ? 'site:linkedin.com/in/' : p.id === 'StackOverflow' ? 'site:stackoverflow.com/users' : p.id === 'Xing' ? 'site:xing.com/profile' : `site:${p.hosts[0]}`, 'operator')
  ),
  chip('filetype:pdf', 'operator'),
  chip('intitle:', 'operator'),
  chip('inurl:', 'operator'),
];
const LOGIC: PaletteChip[] = [chip('OR', 'bool'), chip('AND', 'bool'), chip('AROUND(5)', 'proximity'), chip('( )', 'open', { text: '()', caretOffset: -1, display: '( )' })];
const TERMS: PaletteChip[] = [
  chip('""', 'phrase', { caretOffset: -1, display: '"exact phrase"' }),
  chip('-', 'exclude', { display: '−exclude' }),
  chip('-intitle:job', 'exclude'),
  chip('-intitle:hiring', 'exclude'),
  chip('-intitle:recruiter', 'exclude'),
];

const PALETTE: Array<{ title: string; chips: PaletteChip[] }> = [
  { title: 'Operators', chips: OPERATORS.filter((c, i, a) => a.findIndex((x) => x.text === c.text) === i) },
  { title: 'Logic', chips: LOGIC },
  { title: 'Terms', chips: TERMS },
];

interface QueryBuilderProps {
  value: string;
  onChange: (next: string) => void;
  /** Autofocus the text box when the editor opens. */
  autoFocus?: boolean;
}

export function QueryBuilder({ value, onChange, autoFocus = true }: QueryBuilderProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content so a long query is never clipped.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const words = countGoogleWords(value);
  const balance = useMemo(() => isBalanced(tokenize(value)), [value]);

  /** Insert text at the caret with sensible spacing, then place the caret. */
  const insertAtCaret = (c: PaletteChip) => {
    const el = ref.current;
    const text = c.text;
    if (!el) {
      onChange(`${value} ${text}`.trim());
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const needsLead = before.length > 0 && !/\s$/.test(before) && !/\($/.test(before);
    const needsTrail = after.length > 0 && !/^\s/.test(after) && !/^\)/.test(after);
    const lead = needsLead ? ' ' : '';
    const trail = needsTrail ? ' ' : '';
    const next = `${before}${lead}${text}${trail}${after}`;
    onChange(next);
    const caret = before.length + lead.length + text.length + (c.caretOffset ?? 0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const onDragStart = (e: React.DragEvent, c: PaletteChip) => {
    // Native text drop: the browser inserts this at the drop point inside the textarea.
    e.dataTransfer.setData('text/plain', ` ${c.text} `);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Live pill view of what is in the box */}
      <div className="rounded-sm border border-hairline bg-elevated px-2.5 py-2 min-h-[38px]">
        <QueryTokenView query={value} />
      </div>

      {/* The text box: type keywords, drop chips */}
      <div className="relative">
        <textarea
          ref={ref}
          aria-label="Query editor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onDrop={() => {
            // Let the browser perform the native insertion; tidy doubled spaces afterwards.
            requestAnimationFrame(() => {
              const el = ref.current;
              if (!el) return;
              const cleaned = el.value.replace(/[ \t]{2,}/g, ' ');
              if (cleaned !== el.value) onChange(cleaned);
            });
          }}
          rows={2}
          spellCheck={false}
          placeholder="Type keywords, or drag chips from below…"
          className="textarea font-mono text-body-sm leading-6 py-2.5 pr-28 overflow-hidden"
        />
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          {!balance.ok && (
            <span className="chip text-warning-deep border-warning" title={balance.message}>
              check groups
            </span>
          )}
          <span className={`chip tabular-nums ${words > GOOGLE_WORD_LIMIT ? 'text-warning-deep border-warning' : ''}`} title={words > GOOGLE_WORD_LIMIT ? `Google ignores words after the ${GOOGLE_WORD_LIMIT}th.` : "Within Google's 32-word limit"}>
            {words} / {GOOGLE_WORD_LIMIT}
          </span>
        </div>
      </div>

      {/* Palette: syntax elements only */}
      <div className="rounded-sm border border-hairline bg-canvas p-2.5 flex flex-col gap-2">
        {PALETTE.map((group) => (
          <div key={group.title} className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow w-full sm:w-20 flex-shrink-0 text-[10px]">{group.title}</span>
            {group.chips.map((c) => (
              <button
                key={c.text}
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, c)}
                onClick={() => insertAtCaret(c)}
                title="Drag into the query, or click to insert at the caret"
                data-palette-chip
                className="cursor-grab active:cursor-grabbing rounded-sm focus-visible:outline-2"
              >
                <TokenPill token={{ kind: c.kind, text: c.display ?? c.text }} title={c.display ?? c.text} />
              </button>
            ))}
          </div>
        ))}
        <TokenLegend />
      </div>
    </div>
  );
}
