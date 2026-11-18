// ---------------------------------------------------------------------------
// Zero-result relaxation — SHARED CONTRACT.
//
// Called by the run worker (providers workstream) once for a query whose first
// page came back with zero organic results. Implemented by the query-targeting
// workstream, which owns the template shapes. Signature is frozen.
//
// Rules for the implementation:
//   * return ONE relaxed variant of `query.query_string`, or null when nothing
//     can be relaxed safely;
//   * loosen only the single most restrictive clause (a second skill, a
//     proximity operator, an intitle: group, an organisation group, a phrase
//     that can become unquoted, …);
//   * never drop the site:/filetype: anchor, the country targeting, recruiter
//     required phrases, or exclusions; never exceed Google's 32-word limit;
//   * pure and deterministic.
// ---------------------------------------------------------------------------

import type { MergedConstraints, XRayQuery } from '../types';
import { ANY_CITY_RE } from './location';
import { validateQuery } from './queryValidation';
import { serialize, tokenize, type QueryToken } from './queryTokens';
import { countGoogleWords, deriveQueryTerms, getTemplate, GOOGLE_WORD_LIMIT, stripSeniority } from './xrayTemplates';

// The query is read as top-level units (an operator with its group, a
// parenthesised group, a phrase, an exclusion, …), each unit classified by
// what it holds against the requisition's own vocabulary. Template, planner
// and hand-edited queries all relax the same way.

type UnitKind = 'anchor' | 'intitle' | 'proximity' | 'content' | 'exclude' | 'other';
type Meaning = 'required' | 'org' | 'location' | 'skill' | 'role' | 'topic';

interface Unit {
  kind: UnitKind;
  start: number;
  /** Exclusive. */
  end: number;
  /** Lower-cased phrases and words inside the unit (no operators, no OR). */
  texts: string[];
}

const strip = (t: string) => t.replace(/^-+/, '').replace(/^[a-z]+:/i, '').replace(/^"|"$/g, '').trim().toLowerCase();

function closeOf(tokens: QueryToken[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind === 'open') depth++;
    if (tokens[i].kind === 'close' && --depth === 0) return i;
  }
  return tokens.length - 1;
}

function textsOf(tokens: QueryToken[]): string[] {
  return tokens.filter((t) => t.kind === 'phrase' || t.kind === 'word' || (t.kind === 'operator' && /:"/.test(t.text))).map((t) => strip(t.text)).filter(Boolean);
}

function units(tokens: QueryToken[]): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'operator') {
      const prefix = t.text.slice(0, t.text.indexOf(':')).toLowerCase();
      const grouped = /:$/.test(t.text) && tokens[i + 1]?.kind === 'open';
      const end = grouped ? closeOf(tokens, i + 1) + 1 : i + 1;
      const kind: UnitKind = prefix === 'site' || prefix === 'filetype' ? 'anchor' : prefix === 'intitle' || prefix === 'allintitle' ? 'intitle' : 'other';
      out.push({ kind, start: i, end, texts: textsOf(tokens.slice(i, end)) });
      i = end - 1;
    } else if (t.kind === 'open') {
      const end = closeOf(tokens, i) + 1;
      const inner = tokens.slice(i, end);
      const isAnchor = inner.some((x) => x.kind === 'operator' && /^(site|filetype):/i.test(x.text));
      out.push({ kind: isAnchor ? 'anchor' : 'content', start: i, end, texts: textsOf(inner) });
      i = end - 1;
    } else if ((t.kind === 'phrase' || t.kind === 'word') && tokens[i + 1]?.kind === 'proximity') {
      out.push({ kind: 'proximity', start: i, end: i + 2, texts: [strip(t.text)] });
      i += 1;
    } else if (t.kind === 'phrase' || t.kind === 'word') {
      out.push({ kind: 'content', start: i, end: i + 1, texts: [strip(t.text)] });
    } else if (t.kind === 'exclude') {
      out.push({ kind: 'exclude', start: i, end: i + 1, texts: [strip(t.text)] });
    } else {
      out.push({ kind: 'other', start: i, end: i + 1, texts: [] });
    }
  }
  return out;
}

function vocabulary(constraints: MergedConstraints) {
  const terms = deriveQueryTerms(constraints);
  const lower = (xs: string[]) => new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean));
  return {
    required: lower((terms.required_phrases ?? []).flatMap((p) => p.split('|'))),
    orgs: lower(terms.target_orgs ?? []),
    locations: lower([...terms.location_terms, ...(terms.country_terms ?? [])]),
    skills: lower(terms.must_have_skills.flatMap((sk) => [sk, ...(terms.skill_synonyms[sk] ?? [])])),
    roles: lower(terms.role_synonyms.flatMap((r) => [r, stripSeniority(r)])),
  };
}

function meaningOf(u: Unit, v: ReturnType<typeof vocabulary>): Meaning {
  const isCity = (x: string) => v.locations.has(x) || (ANY_CITY_RE.exec(x)?.[0]?.toLowerCase() === x && x.length > 3);
  if (u.texts.some((x) => v.required.has(x))) return 'required';
  if (u.texts.some((x) => v.orgs.has(x))) return 'org';
  if (u.texts.length && u.texts.every(isCity)) return 'location';
  if (u.texts.some((x) => v.skills.has(x))) return 'skill';
  if (u.texts.some((x) => v.roles.has(x))) return 'role';
  return 'topic';
}

/**
 * Is the query's geography held by its hosts, so the city may widen to the
 * country? Only when EVERY site: anchor is a LinkedIn country subdomain or a
 * bare ccTLD. www.linkedin.com also holds non-US profiles, and a MultiSite
 * group's GitHub / Stack Overflow arms have no country at all.
 */
function hasCountryTargeting(query: string): boolean {
  const sites = [...query.matchAll(/\bsite:([^\s()]+)/gi)].map((m) => m[1].toLowerCase());
  return sites.length > 0 && sites.every((h) => /^(?!www\.)[a-z]{2}\.linkedin\.com\/in\b/.test(h) || /^\.[a-z]{2}(?:\.[a-z]{2})?$/.test(h));
}

/** Removes tokens [start, end). */
const without = (tokens: QueryToken[], u: Unit) => [...tokens.slice(0, u.start), ...tokens.slice(u.end)];

/** intitle:(A OR B) → (A OR B); intitle:"A" → "A". */
function unwrapIntitle(tokens: QueryToken[], u: Unit): QueryToken[] {
  const op = tokens[u.start];
  if (/:$/.test(op.text)) return without(tokens, { ...u, end: u.start + 1 });
  const value = op.text.slice(op.text.indexOf(':') + 1);
  return [...tokens.slice(0, u.start), { ...op, kind: /^"/.test(value) ? 'phrase' : 'word', text: value }, ...tokens.slice(u.end)];
}

export function relaxQueryString(query: XRayQuery, constraints: MergedConstraints): string | null {
  const original = (query?.query_string ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return null;
  const tokens = tokenize(original);
  const all = units(tokens);
  const v = vocabulary(constraints);
  const content = all.filter((u) => u.kind === 'content');
  const meaning = new Map(all.map((u) => [u, meaningOf(u, v)] as const));
  const is = (u: Unit, m: Meaning) => meaning.get(u) === m;

  // Candidate loosenings, most restrictive clause first. Each touches ONE
  // clause; the anchor, the country host, required phrases, organisations
  // (beyond lifting intitle:) and exclusions are never removed.
  const steps: Array<() => QueryToken[] | null> = [
    // 1. A proximity operator: undocumented, fragile, and often the reason for zero.
    () => {
      const u = all.find((x) => x.kind === 'proximity');
      return u ? without(tokens, u) : null;
    },
    // 2. The second AND'd skill.
    () => {
      const skills = content.filter((u) => is(u, 'skill'));
      return skills.length >= 2 ? without(tokens, skills[skills.length - 1]) : null;
    },
    // 3. The title from the page title to anywhere on the page.
    () => {
      const u = all.find((x) => x.kind === 'intitle' && is(x, 'role'));
      return u ? unwrapIntitle(tokens, u) : null;
    },
    // 4. "Current employer" to "anywhere in the history": the organisations stay required.
    () => {
      const u = all.find((x) => x.kind === 'intitle' && is(x, 'org'));
      return u ? unwrapIntitle(tokens, u) : null;
    },
    // 5. The city, when the host still pins the country (site:in.linkedin.com/in/, site:.de).
    () => {
      if (!hasCountryTargeting(original)) return null;
      const u = content.find((x) => is(x, 'location'));
      return u ? without(tokens, u) : null;
    },
    // 6. A field / domain group, when a title or skill still anchors the query.
    //    Only on unedited template queries: in a planner or hand-written query
    //    an unrecognised phrase may be the recruiter's own requirement.
    () => {
      if (query.is_edited || !getTemplate(query.query_type)) return null;
      const topics = content.filter((u) => is(u, 'topic'));
      const anchored = content.some((u) => is(u, 'role') || is(u, 'skill')) || all.some((u) => u.kind === 'intitle' && is(u, 'role'));
      return topics.length && anchored ? without(tokens, topics[topics.length - 1]) : null;
    },
  ];

  for (const step of steps) {
    const next = step();
    if (!next) continue;
    const relaxed = serialize(next).replace(/\s{2,}/g, ' ').trim();
    if (!relaxed || relaxed === original || countGoogleWords(relaxed) > GOOGLE_WORD_LIMIT) continue;
    const check = validateQuery({ ...query, query_string: relaxed }, constraints);
    if (check.ok) return relaxed;
  }
  return null;
}
