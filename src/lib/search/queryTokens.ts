// ---------------------------------------------------------------------------
// Query tokens — the shared model behind the pill view, the drag-and-drop
// builder and the raw text editor. Pure and browser-safe. Tokenizing then
// serializing a well-formed query reproduces it word for word, so switching
// between the three editors never rewrites what the recruiter typed.
// ---------------------------------------------------------------------------

export type TokenKind =
  | 'operator' // site:x, filetype:pdf, intitle:x, inurl:x, intext:x
  | 'bool' // OR, AND
  | 'proximity' // AROUND(n)
  | 'phrase' // "quoted phrase"
  | 'word' // bare word
  | 'exclude' // -term, -"phrase", -intitle:x
  | 'open' // (
  | 'close'; // )

export interface QueryToken {
  id: string;
  kind: TokenKind;
  /** The token exactly as it appears in the query string. */
  text: string;
}

export const OPERATORS = ['site', 'filetype', 'intitle', 'inurl', 'intext', 'allintitle', 'allinurl'] as const;

const TOKEN_RE = /-?"[^"]*"|-?(?:site|filetype|intitle|inurl|intext|allintitle|allinurl):(?:"[^"]*"|\(|[^\s()]+)|AROUND\(\d+\)|[()]|\S+/gi;

let counter = 0;
export function newTokenId(): string {
  counter = (counter + 1) % 1_000_000;
  return `tk-${Date.now().toString(36)}-${counter}`;
}

export function classify(text: string): TokenKind {
  if (text === '(') return 'open';
  if (text === ')') return 'close';
  if (/^AROUND\(\d+\)$/i.test(text)) return 'proximity';
  if (/^(OR|AND)$/.test(text)) return 'bool';
  if (text.startsWith('-') && text.length > 1) return 'exclude';
  if (/^"[^"]*"$/.test(text)) return 'phrase';
  if (new RegExp(`^(?:${OPERATORS.join('|')}):`, 'i').test(text)) return 'operator';
  return 'word';
}

export function tokenize(query: string): QueryToken[] {
  const out: QueryToken[] = [];
  const str = (query || '').replace(/\s+/g, ' ').trim();
  if (!str) return out;
  for (const m of str.matchAll(TOKEN_RE)) {
    const text = m[0];
    // "intitle:(" → operator applied to a group: split into operator + open.
    if (/^(?:site|filetype|intitle|inurl|intext|allintitle|allinurl):\($/i.test(text)) {
      out.push({ id: newTokenId(), kind: 'operator', text: text.slice(0, -1) });
      out.push({ id: newTokenId(), kind: 'open', text: '(' });
      continue;
    }
    out.push({ id: newTokenId(), kind: classify(text), text });
  }
  return out;
}

/**
 * Joins tokens back into a query string. No space after "(" or before ")",
 * and an operator that directly precedes "(" is attached to it (intitle:(a OR b)).
 */
export function serialize(tokens: QueryToken[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const attach =
      i === 0 ||
      t.kind === 'close' ||
      prev.kind === 'open' ||
      (prev.kind === 'operator' && /:$/.test(prev.text) && t.kind === 'open');
    out += (attach ? '' : ' ') + t.text;
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Human label for a token kind, used for palette headings and tooltips. */
export const KIND_LABEL: Record<TokenKind, string> = {
  operator: 'Operator',
  bool: 'Boolean',
  proximity: 'Proximity',
  phrase: 'Exact phrase',
  word: 'Word',
  exclude: 'Exclusion',
  open: 'Open group',
  close: 'Close group',
};

/** Splits an operator token into prefix ("site:") and value ("linkedin.com/in/"). */
export function splitOperator(text: string): { prefix: string; value: string } {
  const idx = text.indexOf(':');
  return idx === -1 ? { prefix: text, value: '' } : { prefix: text.slice(0, idx + 1), value: text.slice(idx + 1) };
}

/** Wraps a value in quotes when it has spaces (or the user wants an exact match). */
export function asPhrase(value: string): string {
  const v = value.replace(/^"|"$/g, '').trim();
  return v ? `"${v}"` : '""';
}

export function asExclusion(value: string): string {
  const v = value.replace(/^-+/, '').trim();
  if (!v) return '-';
  return /\s/.test(v) && !/^"/.test(v) ? `-"${v}"` : `-${v}`;
}

/** Balanced parentheses and quotes? Used for the builder's inline validity hint. */
export function isBalanced(tokens: QueryToken[]): { ok: boolean; message?: string } {
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'open') depth++;
    if (t.kind === 'close') depth--;
    if (depth < 0) return { ok: false, message: 'A ")" closes a group that was never opened.' };
    if (t.kind === 'phrase' && t.text === '""') return { ok: false, message: 'An exact phrase is empty.' };
    if (t.kind === 'exclude' && t.text === '-') return { ok: false, message: 'An exclusion has no term.' };
    if (t.kind === 'operator' && /:$/.test(t.text)) {
      // allowed only when followed by "("
      return { ok: true };
    }
  }
  if (depth !== 0) return { ok: false, message: `${depth} group${depth === 1 ? '' : 's'} left open.` };
  return { ok: true };
}
