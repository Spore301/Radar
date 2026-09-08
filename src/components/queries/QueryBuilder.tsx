'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, GripVertical, Type, LayoutGrid } from 'lucide-react';
import {
  QueryToken,
  TokenKind,
  tokenize,
  serialize,
  newTokenId,
  classify,
  splitOperator,
  asPhrase,
  asExclusion,
  isBalanced,
} from '@/lib/search/queryTokens';
import { TokenPill } from './QueryTokenView';
import { countGoogleWords, GOOGLE_WORD_LIMIT } from '@/lib/search/xrayTemplates';
import { PLATFORMS } from '@/lib/search/platforms';
import { PlatformLogo } from '@/components/platforms/PlatformLogo';

// ---------------------------------------------------------------------------
// Drag-and-drop query builder.
//
// The canvas is an ordered list of tokens. Chips in the palette are dragged
// (or clicked) onto the canvas; canvas chips can be dragged to reorder,
// clicked to edit their text inline, or removed. A raw text mode edits the
// same string; both views go through tokenize()/serialize() so nothing is lost
// when switching. Native HTML5 drag and drop — no library.
// ---------------------------------------------------------------------------

export interface BuilderContext {
  /** Job-title variants ("Senior Product Designer", …). */
  roles?: string[];
  /** Searchable must-have skills. */
  skills?: string[];
  /** Location spellings. */
  locations?: string[];
  /** Recruiter-required phrases. */
  required?: string[];
  /** Recruiter exclusions (without the leading "-"). */
  excludes?: string[];
}

interface PaletteChip {
  key: string;
  text: string;
  kind: TokenKind;
  /** When true the chip opens in edit mode straight after insertion. */
  editOnInsert?: boolean;
  label?: React.ReactNode;
}

const DRAG_TYPE_NEW = 'application/x-candidateradar-token';
const DRAG_TYPE_MOVE = 'application/x-candidateradar-move';

function chip(text: string, kind?: TokenKind, extra: Partial<PaletteChip> = {}): PaletteChip {
  return { key: `${kind ?? classify(text)}:${text}:${extra.label ? 'l' : ''}`, text, kind: kind ?? classify(text), ...extra };
}

function buildPalette(ctx: BuilderContext): Array<{ title: string; chips: PaletteChip[] }> {
  const siteChips: PaletteChip[] = PLATFORMS.filter((p) => p.hosts.length && !p.anyHost)
    .flatMap((p) => {
      const site = p.id === 'LinkedIn' ? 'site:linkedin.com/in/' : p.id === 'StackOverflow' ? 'site:stackoverflow.com/users' : p.id === 'Xing' ? 'site:xing.com/profile' : `site:${p.hosts[0]}`;
      return [
        chip(site, 'operator', {
          label: (
            <>
              <PlatformLogo platform={p.id} size={10} tone="mono" /> {site}
            </>
          ),
        }),
      ];
    })
    .filter((c, i, arr) => arr.findIndex((x) => x.text === c.text) === i);

  return [
    {
      title: 'Operators',
      chips: [...siteChips, chip('filetype:pdf', 'operator'), chip('intitle:', 'operator', { editOnInsert: true }), chip('inurl:', 'operator', { editOnInsert: true })],
    },
    {
      title: 'Logic',
      chips: [chip('OR', 'bool'), chip('AND', 'bool'), chip('AROUND(5)', 'proximity'), chip('(', 'open'), chip(')', 'close')],
    },
    {
      title: 'Terms',
      chips: [
        chip('""', 'phrase', { editOnInsert: true, label: '"exact phrase"' }),
        chip('-', 'exclude', { editOnInsert: true, label: '−exclude' }),
        chip('-intitle:job', 'exclude'),
        chip('-intitle:hiring', 'exclude'),
        chip('-recruiter', 'exclude'),
      ],
    },
    ...(ctx.roles?.length ? [{ title: 'Titles from this session', chips: ctx.roles.map((r) => chip(asPhrase(r), 'phrase')) }] : []),
    ...(ctx.skills?.length ? [{ title: 'Skills', chips: ctx.skills.map((s) => chip(asPhrase(s), 'phrase')) }] : []),
    ...(ctx.locations?.length ? [{ title: 'Location', chips: ctx.locations.map((l) => chip(asPhrase(l), 'phrase')) }] : []),
    ...(ctx.required?.length ? [{ title: 'Required phrases', chips: ctx.required.map((r) => chip(asPhrase(r), 'phrase')) }] : []),
    ...(ctx.excludes?.length ? [{ title: 'Exclusions', chips: ctx.excludes.map((e) => chip(asExclusion(e), 'exclude')) }] : []),
  ];
}

interface QueryBuilderProps {
  value: string;
  onChange: (next: string) => void;
  context?: BuilderContext;
  /** Start in the palette view (builder) or raw text. */
  initialMode?: 'builder' | 'text';
}

export function QueryBuilder({ value, onChange, context = {}, initialMode = 'builder' }: QueryBuilderProps) {
  const [mode, setMode] = useState<'builder' | 'text'>(initialMode);
  const [tokens, setTokens] = useState<QueryToken[]>(() => tokenize(value));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  // Keep tokens in sync when the parent changes the string from outside (e.g. text mode).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setTokens(tokenize(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const commit = (next: QueryToken[]) => {
    setTokens(next);
    const str = serialize(next);
    lastEmitted.current = str;
    onChange(str);
  };

  const palette = useMemo(() => buildPalette(context), [context]);
  const words = countGoogleWords(serialize(tokens));
  const balance = isBalanced(tokens);

  // --- insertion / movement --------------------------------------------------

  const insertAt = (index: number, text: string, kind: TokenKind, editOnInsert?: boolean) => {
    const token: QueryToken = { id: newTokenId(), kind, text };
    const next = [...tokens];
    next.splice(Math.min(Math.max(index, 0), next.length), 0, token);
    commit(next);
    if (editOnInsert) setEditingId(token.id);
  };

  const moveTo = (id: string, index: number) => {
    const from = tokens.findIndex((t) => t.id === id);
    if (from === -1) return;
    const next = [...tokens];
    const [tok] = next.splice(from, 1);
    const target = index > from ? index - 1 : index;
    next.splice(Math.min(Math.max(target, 0), next.length), 0, tok);
    commit(next);
  };

  const remove = (id: string) => commit(tokens.filter((t) => t.id !== id));

  const updateText = (id: string, raw: string) => {
    const tok = tokens.find((t) => t.id === id);
    if (!tok) return;
    let text = raw.trim();
    if (tok.kind === 'phrase') text = asPhrase(text);
    else if (tok.kind === 'exclude') text = asExclusion(text);
    else if (tok.kind === 'operator') {
      const { prefix } = splitOperator(tok.text);
      text = text.startsWith(prefix) ? text : `${prefix}${text.replace(/^[a-z]+:/i, '')}`;
    }
    if (!text || text === '""' || text === '-') {
      remove(id);
      return;
    }
    commit(tokens.map((t) => (t.id === id ? { ...t, text, kind: classify(text) === 'word' && t.kind !== 'word' ? t.kind : classify(text) } : t)));
  };

  // --- drag handlers -------------------------------------------------------------

  const onPaletteDragStart = (e: React.DragEvent, c: PaletteChip) => {
    e.dataTransfer.setData(DRAG_TYPE_NEW, JSON.stringify({ text: c.text, kind: c.kind, editOnInsert: c.editOnInsert }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onTokenDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(DRAG_TYPE_MOVE, id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(id);
  };

  const indexFromPointer = (e: React.DragEvent, tokenIndex: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    return before ? tokenIndex : tokenIndex + 1;
  };

  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const moveId = e.dataTransfer.getData(DRAG_TYPE_MOVE);
    if (moveId) {
      moveTo(moveId, index);
    } else {
      const raw = e.dataTransfer.getData(DRAG_TYPE_NEW);
      if (raw) {
        try {
          const c = JSON.parse(raw) as { text: string; kind: TokenKind; editOnInsert?: boolean };
          insertAt(index, c.text, c.kind, c.editOnInsert);
        } catch {
          // ignore foreign drops
        }
      }
    }
    setDropIndex(null);
    setDragging(null);
  };

  const allowDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_TYPE_NEW) || e.dataTransfer.types.includes(DRAG_TYPE_MOVE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_TYPE_MOVE) ? 'move' : 'copy';
    }
  };

  // --- render ----------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="seg" role="group" aria-label="Editor mode">
          <button type="button" aria-pressed={mode === 'builder'} onClick={() => setMode('builder')} className="seg-item h-7 px-2.5 text-body-xs">
            <LayoutGrid className="w-3 h-3" /> Builder
          </button>
          <button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')} className="seg-item h-7 px-2.5 text-body-xs">
            <Type className="w-3 h-3" /> Text
          </button>
        </div>
        <div className="flex items-center gap-2 text-body-xs">
          {!balance.ok && <span className="text-warning-deep">{balance.message}</span>}
          <span className={`chip tabular-nums ${words > GOOGLE_WORD_LIMIT ? 'text-warning-deep border-warning' : ''}`}>
            {words} / {GOOGLE_WORD_LIMIT} words
          </span>
        </div>
      </div>

      {mode === 'text' ? (
        <AutoTextarea
          value={value}
          onChange={(next) => {
            lastEmitted.current = next;
            setTokens(tokenize(next));
            onChange(next);
          }}
        />
      ) : (
        <>
          {/* Canvas */}
          <div
            className={`min-h-[56px] p-2 rounded-sm border bg-elevated flex flex-wrap items-center gap-x-1 gap-y-1.5 transition-colors ${
              dropIndex !== null ? 'border-ink' : 'border-hairline'
            }`}
            onDragOver={(e) => {
              allowDrop(e);
              if (e.target === e.currentTarget) setDropIndex(tokens.length);
            }}
            onDragLeave={(e) => {
              if (e.target === e.currentTarget) setDropIndex(null);
            }}
            onDrop={(e) => onDrop(e, dropIndex ?? tokens.length)}
            aria-label="Query canvas"
          >
            {tokens.length === 0 && <span className="text-body-xs text-faint px-1">Drag chips here, or click one in the palette to append it.</span>}
            {tokens.map((t, i) => (
              <React.Fragment key={t.id}>
                {dropIndex === i && <DropMarker />}
                <CanvasToken
                  token={t}
                  editing={editingId === t.id}
                  dragging={dragging === t.id}
                  onStartEdit={() => setEditingId(t.id)}
                  onCommitEdit={(raw) => {
                    setEditingId(null);
                    updateText(t.id, raw);
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onRemove={() => remove(t.id)}
                  onDragStart={(e) => onTokenDragStart(e, t.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropIndex(null);
                  }}
                  onDragOver={(e) => {
                    allowDrop(e);
                    e.stopPropagation();
                    setDropIndex(indexFromPointer(e, i));
                  }}
                  onDrop={(e) => onDrop(e, indexFromPointer(e, i))}
                />
              </React.Fragment>
            ))}
            {dropIndex === tokens.length && tokens.length > 0 && <DropMarker />}
          </div>

          {/* Palette */}
          <div className="rounded-sm border border-hairline bg-canvas p-2.5 flex flex-col gap-2 max-h-72 overflow-y-auto">
            {palette.map((group) => (
              <div key={group.title} className="flex flex-wrap items-center gap-1">
                <span className="eyebrow w-full sm:w-36 flex-shrink-0 text-[10px]">{group.title}</span>
                {group.chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    draggable
                    onDragStart={(e) => onPaletteDragStart(e, c)}
                    onClick={() => insertAt(tokens.length, c.text, c.kind, c.editOnInsert)}
                    title="Drag onto the query, or click to append"
                    className="cursor-grab active:cursor-grabbing focus-visible:outline-2 rounded-sm"
                  >
                    <TokenPill token={{ id: c.key, kind: c.kind, text: c.text }}>{null}</TokenPill>
                    {c.label && <span className="sr-only">{typeof c.label === 'string' ? c.label : c.text}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DropMarker() {
  return <span aria-hidden className="inline-block w-0.5 h-5 bg-link rounded-full" />;
}

interface CanvasTokenProps {
  token: QueryToken;
  editing: boolean;
  dragging: boolean;
  onStartEdit: () => void;
  onCommitEdit: (raw: string) => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function CanvasToken({ token, editing, dragging, onStartEdit, onCommitEdit, onCancelEdit, onRemove, onDragStart, onDragEnd, onDragOver, onDrop }: CanvasTokenProps) {
  const editable = token.kind === 'phrase' || token.kind === 'exclude' || token.kind === 'operator' || token.kind === 'word' || token.kind === 'proximity';
  const initial =
    token.kind === 'phrase' ? token.text.replace(/^"|"$/g, '') : token.kind === 'exclude' ? token.text.slice(1) : token.kind === 'operator' ? splitOperator(token.text).value : token.text;
  const prefix = token.kind === 'exclude' ? '−' : token.kind === 'operator' ? splitOperator(token.text).prefix : token.kind === 'phrase' ? '"' : '';
  const suffix = token.kind === 'phrase' ? '"' : '';

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 h-[22px] px-2 rounded-sm border border-ink bg-elevated font-mono text-body-xs">
        {prefix && <span className="text-mute">{prefix}</span>}
        <input
          autoFocus
          defaultValue={initial}
          onBlur={(e) => onCommitEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') onCancelEdit();
          }}
          className="bg-transparent outline-none min-w-[60px] w-[var(--w,120px)] text-ink"
          style={{ width: `${Math.max(6, initial.length + 2)}ch` }}
          aria-label={`Edit ${token.kind}`}
        />
        {suffix && <span className="text-mute">{suffix}</span>}
      </span>
    );
  }

  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={editable ? onStartEdit : undefined}
      onKeyDown={(e) => {
        if (editable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onStartEdit();
        }
        if (e.key === 'Delete' || e.key === 'Backspace') onRemove();
      }}
      role={editable ? 'button' : undefined}
      tabIndex={0}
      title={editable ? 'Click to edit · drag to move · Delete to remove' : 'Drag to move · Delete to remove'}
      className={`inline-flex items-center gap-0.5 group/tok rounded-sm cursor-grab active:cursor-grabbing focus-visible:outline-2 ${dragging ? 'opacity-40' : ''}`}
    >
      <GripVertical className="w-3 h-3 text-faint opacity-0 group-hover/tok:opacity-100 -mr-0.5" aria-hidden />
      <TokenPill token={token} className={editable ? 'hover:border-ink cursor-text' : ''}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${token.text}`}
          className="ml-0.5 opacity-60 hover:opacity-100 focus:opacity-100"
        >
          <X className="w-3 h-3" />
        </button>
      </TokenPill>
    </span>
  );
}

/** Textarea that grows to fit its content so a long query is never clipped. */
export function AutoTextarea({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      spellCheck={false}
      className={`textarea font-mono text-body-xs leading-5 py-2 overflow-hidden ${className}`}
    />
  );
}
