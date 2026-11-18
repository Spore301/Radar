// ---------------------------------------------------------------------------
// Candidate facets — normalised, filterable fields for one search result.
//
// SHARED CONTRACT. The signature of `deriveCandidateFacets` and the
// `CandidateFacets` shape (src/lib/types/index.ts) are frozen: the search
// indexer calls it at index time, and the results filters call it on the fly
// for rows stored before facets existed. Improve the internals freely; do not
// change the signature or the meaning of a field.
//
// Evidence rules: only the result's URL, title, snippet, the structured
// `extensions` / `displayed_link` the SERP itself returned, and the location
// the indexer already stored may be used. No fetching, no guessing — a field
// with no evidence stays null.
//
// Location evidence, strongest first (see locationEvidence):
//   1. Google's structured line (`extensions`: ["Bengaluru, Karnataka, India", …])
//   2. the snippet's own location fields: "Location: Hyderabad",
//      "Kolkata, West Bengal, India. 92 followers", a lead "Pune, Maharashtra, India · …"
//   3. a place segment in the result title
//   4. the current role's location: "Sep 2024 - Present 2 years. Chicago, Illinois, United States."
//   5. weak hints — the stored location of an old row, a "City, Region, Country"
//      elsewhere in the snippet, a bare city sentence — used only when they agree
//      with the LinkedIn country subdomain (they are usually a PAST job's place)
//   6. the LinkedIn country subdomain alone → country only.
//
// Pure and browser-safe.
// ---------------------------------------------------------------------------

import type { CandidateFacets, CandidateLocationFacets, FacetEvidence, SeniorityLevel } from '../types';
import { findCityInText, findCountryInText, KNOWN_REGIONS, type KnownCity } from './location';

/** Indexer placeholder for "no location in the result" (mirrors serpIndexer.UNKNOWN_LOCATION). */
const UNKNOWN_LOCATION_RE = /^location not specified/i;

/**
 * LinkedIn serves public profiles from country subdomains (in.linkedin.com,
 * uk.linkedin.com, …) chosen by the member's country, and Google indexes them
 * under that host. `www.` carries no country (it is the US default and the
 * fallback), so it is deliberately absent here.
 */
export const LINKEDIN_SUBDOMAIN_COUNTRY: Readonly<Record<string, { country: string; code: string }>> = {
  in: { country: 'India', code: 'in' },
  uk: { country: 'United Kingdom', code: 'gb' },
  ca: { country: 'Canada', code: 'ca' },
  au: { country: 'Australia', code: 'au' },
  nz: { country: 'New Zealand', code: 'nz' },
  ie: { country: 'Ireland', code: 'ie' },
  de: { country: 'Germany', code: 'de' },
  at: { country: 'Austria', code: 'at' },
  ch: { country: 'Switzerland', code: 'ch' },
  fr: { country: 'France', code: 'fr' },
  be: { country: 'Belgium', code: 'be' },
  nl: { country: 'Netherlands', code: 'nl' },
  es: { country: 'Spain', code: 'es' },
  pt: { country: 'Portugal', code: 'pt' },
  it: { country: 'Italy', code: 'it' },
  se: { country: 'Sweden', code: 'se' },
  dk: { country: 'Denmark', code: 'dk' },
  no: { country: 'Norway', code: 'no' },
  fi: { country: 'Finland', code: 'fi' },
  pl: { country: 'Poland', code: 'pl' },
  cz: { country: 'Czechia', code: 'cz' },
  ro: { country: 'Romania', code: 'ro' },
  tr: { country: 'Turkey', code: 'tr' },
  il: { country: 'Israel', code: 'il' },
  ae: { country: 'United Arab Emirates', code: 'ae' },
  sa: { country: 'Saudi Arabia', code: 'sa' },
  qa: { country: 'Qatar', code: 'qa' },
  eg: { country: 'Egypt', code: 'eg' },
  za: { country: 'South Africa', code: 'za' },
  ng: { country: 'Nigeria', code: 'ng' },
  ke: { country: 'Kenya', code: 'ke' },
  pk: { country: 'Pakistan', code: 'pk' },
  bd: { country: 'Bangladesh', code: 'bd' },
  lk: { country: 'Sri Lanka', code: 'lk' },
  np: { country: 'Nepal', code: 'np' },
  sg: { country: 'Singapore', code: 'sg' },
  my: { country: 'Malaysia', code: 'my' },
  id: { country: 'Indonesia', code: 'id' },
  ph: { country: 'Philippines', code: 'ph' },
  th: { country: 'Thailand', code: 'th' },
  vn: { country: 'Vietnam', code: 'vn' },
  hk: { country: 'Hong Kong', code: 'hk' },
  tw: { country: 'Taiwan', code: 'tw' },
  jp: { country: 'Japan', code: 'jp' },
  kr: { country: 'South Korea', code: 'kr' },
  cn: { country: 'China', code: 'cn' },
  br: { country: 'Brazil', code: 'br' },
  mx: { country: 'Mexico', code: 'mx' },
  ar: { country: 'Argentina', code: 'ar' },
  cl: { country: 'Chile', code: 'cl' },
  co: { country: 'Colombia', code: 'co' },
  pe: { country: 'Peru', code: 'pe' },
  ve: { country: 'Venezuela', code: 've' },
  ec: { country: 'Ecuador', code: 'ec' },
  uy: { country: 'Uruguay', code: 'uy' },
  py: { country: 'Paraguay', code: 'py' },
  bo: { country: 'Bolivia', code: 'bo' },
  cr: { country: 'Costa Rica', code: 'cr' },
  pa: { country: 'Panama', code: 'pa' },
  gt: { country: 'Guatemala', code: 'gt' },
  do: { country: 'Dominican Republic', code: 'do' },
  pr: { country: 'Puerto Rico', code: 'pr' },
  gr: { country: 'Greece', code: 'gr' },
  hu: { country: 'Hungary', code: 'hu' },
  ua: { country: 'Ukraine', code: 'ua' },
  sk: { country: 'Slovakia', code: 'sk' },
  si: { country: 'Slovenia', code: 'si' },
  hr: { country: 'Croatia', code: 'hr' },
  rs: { country: 'Serbia', code: 'rs' },
  bg: { country: 'Bulgaria', code: 'bg' },
  lt: { country: 'Lithuania', code: 'lt' },
  lv: { country: 'Latvia', code: 'lv' },
  ee: { country: 'Estonia', code: 'ee' },
  lu: { country: 'Luxembourg', code: 'lu' },
  cy: { country: 'Cyprus', code: 'cy' },
  mt: { country: 'Malta', code: 'mt' },
  ma: { country: 'Morocco', code: 'ma' },
  tn: { country: 'Tunisia', code: 'tn' },
  gh: { country: 'Ghana', code: 'gh' },
  ug: { country: 'Uganda', code: 'ug' },
  tz: { country: 'Tanzania', code: 'tz' },
  jo: { country: 'Jordan', code: 'jo' },
  lb: { country: 'Lebanon', code: 'lb' },
  kw: { country: 'Kuwait', code: 'kw' },
  bh: { country: 'Bahrain', code: 'bh' },
  om: { country: 'Oman', code: 'om' },
  kz: { country: 'Kazakhstan', code: 'kz' },
  mu: { country: 'Mauritius', code: 'mu' },
  uz: { country: 'Uzbekistan', code: 'uz' },
  mm: { country: 'Myanmar', code: 'mm' },
  md: { country: 'Moldova', code: 'md' },
  ge: { country: 'Georgia', code: 'ge' },
};

/** Country display name → ISO code, for countries the location table knows. */
const COUNTRY_CODE_BY_NAME: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.values(LINKEDIN_SUBDOMAIN_COUNTRY).map((v) => [v.country.toLowerCase(), v.code])),
  'united states': 'us',
};

/** ISO code for a country display name, or null. */
export function countryCode(countryName: string | null | undefined): string | null {
  if (!countryName) return null;
  return COUNTRY_CODE_BY_NAME[countryName.trim().toLowerCase()] ?? null;
}

/** The country a LinkedIn profile URL's subdomain encodes, or null (www., bare host, non-LinkedIn). */
export function countryFromLinkedInUrl(url: string | null | undefined): { country: string; country_code: string } | null {
  if (!url) return null;
  const m = /^(?:https?:\/\/)?([a-z]{2})\.linkedin\.com\//i.exec(url.trim());
  if (!m) return null;
  const hit = LINKEDIN_SUBDOMAIN_COUNTRY[m[1].toLowerCase()];
  return hit ? { country: hit.country, country_code: hit.code } : null;
}


/** LinkedIn host → subdomain, read from Google's printed breadcrumb ("in.linkedin.com › in › jane"). */
function countryFromDisplayedLink(displayed: string | null | undefined): { country: string; country_code: string } | null {
  const m = /^(?:https?:\/\/)?([a-z]{2})\.linkedin\.com\b/i.exec((displayed ?? '').trim());
  if (!m) return null;
  const hit = LINKEDIN_SUBDOMAIN_COUNTRY[m[1].toLowerCase()];
  return hit ? { country: hit.country, country_code: hit.code } : null;
}

export interface FacetInput {
  /** The profile URL exactly as the search result gave it (subdomain intact). */
  profile_url: string;
  /** SERP result title. */
  title?: string | null;
  /** SERP result snippet. */
  snippet?: string | null;
  /** Location string the indexer already stored ("Bengaluru, India", or the unknown placeholder). */
  location?: string | null;
  /** Headline the indexer parsed from the title. */
  headline?: string | null;
  /** Optional: Google's structured facts for the result (RawSearchResult.extensions), in order. */
  extensions?: string[] | null;
  /** Optional: the breadcrumb Google printed (RawSearchResult.displayed_link). */
  displayed_link?: string | null;
}

const NO_LOCATION: CandidateLocationFacets = { city: null, region: null, country: null, country_code: null, source: 'none' };

// --- Text helpers -------------------------------------------------------------

// Bidi marks LinkedIn puts around RTL names ("‏Vaseem D.‏ - ‏Enterprise AI Engineer").
const INVISIBLE_RE = /[​-‏‪-‮⁦-⁩﻿]/g;
const ELLIPSIS_RE = /\s*(?:\.{3}|…)\s*$/;

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(INVISIBLE_RE, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function titleCase(s: string): string {
  return s.replace(/\S+/g, (w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
}

// --- Countries ----------------------------------------------------------------

/** Country names a profile location line may end with → display name. Wider than the location table. */
const COUNTRY_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ...Object.values(LINKEDIN_SUBDOMAIN_COUNTRY).map((v) => [v.country.toLowerCase(), v.country] as [string, string]),
  ['united states', 'United States'],
  ['united states of america', 'United States'],
  ['usa', 'United States'],
  ['u.s.', 'United States'],
  ['uk', 'United Kingdom'],
  ['england', 'United Kingdom'],
  ['scotland', 'United Kingdom'],
  ['wales', 'United Kingdom'],
  ['great britain', 'United Kingdom'],
  ['uae', 'United Arab Emirates'],
  ['the netherlands', 'Netherlands'],
  ['czech republic', 'Czechia'],
  ['türkiye', 'Turkey'],
  ['turkiye', 'Turkey'],
  ['deutschland', 'Germany'],
  ['österreich', 'Austria'],
  ['schweiz', 'Switzerland'],
  ['suisse', 'Switzerland'],
  ['españa', 'Spain'],
  ['italia', 'Italy'],
  ['polska', 'Poland'],
  ['românia', 'Romania'],
  ['méxico', 'Mexico'],
  ['brasil', 'Brazil'],
  ['bharat', 'India'],
  ['república dominicana', 'Dominican Republic'],
]);

/** The country a whole location segment names ("India", "United States"), or null. */
function countryOfSegment(segment: string): string | null {
  const key = clean(segment).toLowerCase().replace(/[.]+$/, '');
  const named = COUNTRY_NAMES.get(key);
  if (named) return named;
  const table = findCountryInText(segment);
  return table && table.aliases.includes(key) ? table.name : null;
}

// --- Places -------------------------------------------------------------------

interface Place {
  city: KnownCity | null;
  region: string | null;
  country: string | null;
  /** The location as the result printed it, tidied ("Bengaluru, Karnataka, India"). */
  label: string;
}

// Words that mean a fragment is a job, an organisation, a skill list or a
// sentence — never a place. "Indian Institute of Technology, Delhi" and
// "Software Engineer, Java, Scala" must not be read as locations.
const NOT_A_PLACE_RE =
  /\b(engineer|engineering|developer|programmer|manager|consultant|consulting|analyst|designer|executive|director|lead|head|specialist|architect|scientist|intern|internship|founder|officer|president|associate|professional|student|recruiter|marketing|sales|hr|operations|software|data|ai|ml|experience|skills?|years?|months?|followers?|connections?|present|university|universität|college|institute|school|academy|technologies|technology|solutions|limited|ltd|pvt|inc|llc|bank|group|services|labs|studio|agency|company|corp|java|python|scala|remote|hybrid|business|development|management|team|project|projects|worked|working|helped|building|i|my|we|our|the|with|for|and)\b/i;

const AREA_WORDS_RE = /^(?:(?:greater|metropolitan|metro|area|region|urban|rural|city|district|division|ncr|and|surrounding)\b\s*)+$/i;

/**
 * Reads a candidate location phrase. `trusted` phrases come from a labelled
 * field ("Location: …", the line before "N followers"), so an unknown town is
 * still kept as a label; untrusted ones must name a known city or country.
 */
function parsePlace(raw: string, trusted: boolean): Place | null {
  // "... Calcutta" is the tail of a cut-off field ("University of Calcutta"), not a place.
  if (/^\s*(?:\.{2,}|…)/.test(raw)) return null;
  // "Pune/Pimpri-Chinchwad Area": LinkedIn's twin-city areas — the first city names it.
  const text = clean(trusted ? raw.split('/')[0] : raw).replace(/^[\s·•|,.:;–—-]+|[\s·•|,.:;–—-]+$/g, '');
  if (!text || text.length > 70 || /\d/.test(text) || /[@#|/()]/.test(text)) return null;
  if (NOT_A_PLACE_RE.test(text)) return null;
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 4 || parts.some((p) => p.split(/\s+/).length > 4)) return null;

  const country = parts.length > 1 ? countryOfSegment(parts[parts.length - 1]) : countryOfSegment(parts[0]);
  const cityParts = country ? parts.slice(0, -1) : parts;
  // The city leads the line and stands alone or with an area word ("Bangalore
  // Urban", "Greater Kolkata Area"); "IIT Delhi", "NMIMS, Mumbai" and "Great
  // Lakes Chennai" are schools.
  let city: KnownCity | null = null;
  if (cityParts.length) {
    const lead = cityParts[0];
    const hit = findCityInText(lead);
    const rest = hit ? lead.replace(new RegExp(hit.aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i'), '').trim() : '';
    if (hit && (!rest || AREA_WORDS_RE.test(rest))) city = hit;
    else if (hit) return null;
  }
  // "Paris, Texas, United States": the stated country wins over the table's city.
  if (city && country && city.country !== country) city = null;
  const regionPart = cityParts.find((p) => KNOWN_REGIONS.has(p.toLowerCase()));
  const region = city?.region ?? (regionPart ? titleCase(regionPart) : null);

  if (!city && !country) {
    // An unknown town is kept only from a labelled field, and never when Google truncated it ("Location: Costa ...").
    if (!trusted || !/^[A-ZÀ-Þ]/.test(text) || parts.length > 3 || /(?:\.{2,}|…)\s*$/.test(raw)) return null;
    return { city: null, region: null, country: null, label: text };
  }
  return { city, region, country: country ?? city?.country ?? null, label: text };
}

/** "Hyderabad" → "Hyderabad, India"; labels that already name the country stay as printed. */
function labelWithCountry(place: Place, country: string | null): string {
  if (!country || place.label.toLowerCase().includes(country.toLowerCase())) return place.label;
  if (countryOfSegment(place.label.split(',').pop() ?? '')) return place.label;
  return `${place.label}, ${country}`;
}

// --- Location evidence --------------------------------------------------------

type Strength = 'strong' | 'weak';
interface LocationHit {
  place: Place;
  strength: Strength;
  source: FacetEvidence;
}

const COUNT_TAIL = String.raw`\d[\d,.]*\s*K?\+?\s*(?:followers|connections)`;
const LOCATION_FIELD_RE = /\b(?:Location|Ort|Standort|Lieu|Ubicación|Localização|Località)\s*:\s*([^·•|]{2,70}?)\s*(?=[·•|]|\.\s|\d[\d,.]*\s*K?\+?\s*(?:followers|connections)|$)/i;
const BEFORE_COUNT_RE = new RegExp(String.raw`(?:^|[.·•|]\s*)([A-ZÀ-Þ][^.·•|]{1,70}?)\s*[.·•]?\s*${COUNT_TAIL}`);
const CURRENT_ROLE_RE = /\b(?:Present|Current|Now)\b[^.·•|]{0,40}?[.·•]\s*([A-ZÀ-Þ][^.·•|]{1,70}?)\s*(?=[.·•|]|$)/;
// "Dec 2015 - Feb 2017 1 year 3 months. " right before a place: that place is a past job's.
const CLOSED_RANGE_BEFORE_RE = /\b(?:19|20)\d{2}\b[^·•|]{0,25}?[-–][^·•|]{0,25}?\b(?:19|20)\d{2}\b[^·•|]{0,30}$/;

/** Snippet fragments separated by sentence / bullet punctuation, each with the text just before it. */
function fragments(snippet: string): Array<{ text: string; before: string }> {
  const out: Array<{ text: string; before: string }> = [];
  const sep = /\s*[·•|;]\s*|\.\s+|\s[-–—]\s|\n/g;
  let start = 0;
  const pushFrag = (end: number) => {
    const text = snippet.slice(start, end).trim();
    if (text) out.push({ text, before: snippet.slice(Math.max(0, start - 80), start) });
  };
  for (const m of snippet.matchAll(sep)) {
    pushFrag(m.index ?? 0);
    start = (m.index ?? 0) + m[0].length;
  }
  pushFrag(snippet.length);
  return out;
}

function locationEvidence(input: FacetInput, title: string, snippet: string): LocationHit[] {
  const hits: LocationHit[] = [];
  const push = (raw: string | undefined | null, trusted: boolean, strength: Strength, source: FacetEvidence) => {
    if (!raw) return;
    const place = parsePlace(raw, trusted);
    if (place) hits.push({ place, strength, source });
  };

  // 1. Google's structured line. Its location entry is a place; titles and
  //    companies fail parsePlace's job/organisation test.
  for (const ext of input.extensions ?? []) push(typeof ext === 'string' ? ext : null, false, 'strong', 'snippet');

  // 2. The snippet's location fields.
  push(LOCATION_FIELD_RE.exec(snippet)?.[1], true, 'strong', 'snippet');
  push(BEFORE_COUNT_RE.exec(snippet)?.[1], true, 'strong', 'snippet');
  push(snippet.split(/\s[·•|]\s/)[0], false, 'strong', 'snippet');

  // 3. A place segment in the title (never the name segment). A lone country
  //    there is a headline claim ("Director | United States"), so it must
  //    agree with the subdomain like any weak hint.
  title
    .split(/\s+[-–—|·]\s+/)
    .slice(1)
    .forEach((seg) => {
      const place = parsePlace(seg.replace(ELLIPSIS_RE, ''), false);
      if (place) hits.push({ place, strength: place.city ? 'strong' : 'weak', source: 'title' });
    });

  // 4. The current role's place.
  push(CURRENT_ROLE_RE.exec(snippet)?.[1], false, 'strong', 'snippet');

  // 5. Weak hints. The stored location of an old row was read by an older,
  //    looser parser; other places in the snippet are usually past jobs.
  const stored = clean(input.location);
  // A bare country with no city ("Germany") in an old row came from a free-text
  // country scan ("Junior Year Abroad, Heidelberg Germany") — not evidence.
  const bareCountry = !stored.includes(',') && countryOfSegment(stored) !== null;
  if (stored && !UNKNOWN_LOCATION_RE.test(stored) && !/^remote$/i.test(stored) && !bareCountry) push(stored, false, 'weak', 'snippet');
  for (const frag of fragments(snippet)) {
    // A place right after a closed date range ("Dec 2015 - Feb 2017 1 year. Bangalore Area, India") is a past job's.
    if (CLOSED_RANGE_BEFORE_RE.test(frag.before)) continue;
    push(frag.text, false, 'weak', 'snippet');
  }
  return hits;
}

/**
 * Location facets plus the label to store. Strong evidence wins even against
 * the subdomain (the member's own location line is fresher than the host
 * Google indexed); weak evidence must agree with the subdomain country.
 */
function resolveLocation(input: FacetInput, title: string, snippet: string): { location: CandidateLocationFacets; label: string | null } {
  const sub = countryFromLinkedInUrl(input.profile_url) ?? (/linkedin\.com/i.test(input.profile_url) ? countryFromDisplayedLink(input.displayed_link) : null);
  const hits = locationEvidence(input, title, snippet);

  const strong = hits.find((h) => h.strength === 'strong' && (h.place.city || h.place.country));
  const strongLabelOnly = hits.find((h) => h.strength === 'strong' && !h.place.city && !h.place.country);
  const weak = hits.find((h) => {
    if (h.strength !== 'weak' || !(h.place.city || h.place.country)) return false;
    return !sub || !h.place.country || h.place.country === sub.country;
  });
  const chosen = strong ?? weak ?? null;

  if (chosen) {
    const p = chosen.place;
    const country = p.country ?? sub?.country ?? null;
    const code = country ? countryCode(country) ?? (sub && sub.country === country ? sub.country_code : null) : null;
    const source: FacetEvidence = p.city || p.country ? chosen.source : 'url_subdomain';
    const label = p.city && chosen.strength === 'weak' ? `${p.city.name}, ${p.city.country}` : labelWithCountry(p, country);
    return { location: { city: p.city?.name ?? null, region: p.region, country, country_code: code, source }, label };
  }
  if (strongLabelOnly && sub) {
    // An unknown town from a labelled field ("Location: Polokwane Local Municipality") plus the subdomain's country.
    return {
      location: { city: null, region: null, country: sub.country, country_code: sub.country_code, source: 'url_subdomain' },
      label: labelWithCountry(strongLabelOnly.place, sub.country),
    };
  }
  if (sub) return { location: { city: null, region: null, country: sub.country, country_code: sub.country_code, source: 'url_subdomain' }, label: sub.country };
  if (strongLabelOnly) return { location: NO_LOCATION, label: strongLabelOnly.place.label };
  return { location: NO_LOCATION, label: null };
}

// --- Current title, company, seniority ------------------------------------------

const ROLE_WORD_RE =
  /\b(engineer|developer|programmer|designer|manager|consultant|analyst|associate|executive|lead|head|director|officer|president|vp|specialist|architect|scientist|researcher|marketer|strategist|recruiter|representative|coordinator|administrator|accountant|writer|editor|tester|technician|intern|founder|co-founder|sde|sre|swe|devops|qa|professional|leader|expert|trainer|student|generalist|owner|ceo|cto|cfo|coo|cmo|advisor|adviser|lawyer|attorney|teacher|professor|lecturer|economist|statistician|planner|buyer|controller|auditor|supervisor|assistant|partner|trainee|fellow)s?\b/i;
const SENTENCE_RE = /\b(i|i'm|im|my|we|our|you|your|help|helping|passionate|looking|seeking|years of)\b|\bwith\s+\d|\d+\+?\s*(?:years?|yrs?)\b|[“”"]/i;

function tidyRole(raw: string | null | undefined): string | null {
  const original = clean(raw);
  const truncated = ELLIPSIS_RE.test(original);
  const t = original
    .replace(/^[^\p{L}\p{N}]+/u, '') // leading emoji / bullets
    .replace(/^(?:role|title|position|designation)\s*:\s*/i, '')
    .replace(ELLIPSIS_RE, '')
    .replace(/[\s,;:.–—-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = t.split(/\s+/).length;
  if (!t || t.length > 80 || words > 8 || (truncated && words > 4)) return null;
  // "Lead Generation" is a skill, not a lead.
  if (!ROLE_WORD_RE.test(t.replace(/\blead\s+gen\w*/gi, '')) || SENTENCE_RE.test(t)) return null;
  return t;
}

// Words that name a function, a discipline, a skill, a level or a job — never
// an employer. A "company" made only of these ("Backend", "Digital Marketing",
// "Java, Scala, Kotlin", "AWS opensearch", "PI", "Talent Acquisition") is a
// department or a skill list read from the wrong title segment: left null.
const NON_COMPANY_WORDS: ReadonlySet<string> = new Set(
  (
    // functions & disciplines
    'backend back-end back end frontend front-end front end fullstack full-stack full stack software engineering development data science analytics ' +
    'analysis marketing digital performance content growth brand branding social media seo sem orm smm sales inside b2b b2c presales pre-sales ' +
    'business development bd account accounts management operations ops administration admin hr human resource resources people talent acquisition ' +
    'recruitment recruiting staffing hiring payroll compensation benefits finance financial accounting audit tax legal compliance risk strategy ' +
    'consulting research product design ux ui creative engagement communications pr public relations customer success support service services ' +
    'quality qa qe testing automation devops cloud infrastructure platform security cybersecurity network networking it information technology ' +
    'mobile android ios web embedded ai ml genai gen generative artificial intelligence machine learning deep nlp llm llms edtech fintech healthtech ' +
    'saas ecommerce e-commerce retail logistics supply chain procurement learning training education teaching delivery project program programme ' +
    'portfolio integration implementation solutions crm erp bi rpa ' +
    // skills & tools
    'java scala kotlin python go golang javascript typescript js ts react reactjs angular vue node nodejs node.js spring boot springboot django flask ' +
    'fastapi ruby rails php laravel c c++ c# .net dotnet rust swift sql nosql mysql postgresql postgres mongodb redis kafka spark hadoop airflow dbt ' +
    'snowflake databricks aws azure gcp kubernetes k8s docker terraform opensearch elasticsearch graphql rest microservices excel tableau looker power ' +
    'sap abap pi po hana s/4hana fiori salesforce hubspot zoho jira figma sketch photoshop illustrator ' +
    // levels, job nouns, connectors
    'senior sr junior jr lead principal staff head chief vp director manager executive associate intern trainee specialist consultant engineer ' +
    'developer analyst architect officer coordinator expert professional freelance freelancer independent self contractor team and & of the in for ' +
    'operation operation\'s department division'
  ).split(/\s+/)
);

// Employers whose name is also a skill or product word — kept when they are the whole name ("Engineer @ AWS").
const COMPANY_ALSO_SKILL: ReadonlySet<string> = new Set(
  ['aws', 'amazon web services', 'oracle', 'sap', 'salesforce', 'hubspot', 'zoho', 'databricks', 'snowflake', 'mongodb', 'redis', 'tableau', 'docker', 'figma', 'atlassian']
);

/** True when every word of `name` is a function / skill / level / job word (see NON_COMPANY_WORDS). */
export function isNonCompanyPhrase(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (COMPANY_ALSO_SKILL.has(lower)) return false;
  const words = lower.split(/[\s,/|()&+;:]+|\s-\s/).map((w) => w.replace(/^[.'’-]+|[.'’-]+$/g, '')).filter(Boolean);
  return words.length > 0 && words.every((w) => NON_COMPANY_WORDS.has(w));
}

/**
 * An employer name, or null. `strict` is for weak sources — the third dash
 * segment of a title ("Name - Title - Backend") and Google's structured line —
 * where departments and skill lists are common: those must also be a plain
 * name (no lists, no parentheses, no place parts).
 */
function tidyCompany(raw: string | null | undefined, strict = false): string | null {
  const original = clean(raw);
  // "Tech ..." / "Lending ... Hyderabad" are truncated names, not names.
  if (!original || /\.{3}|…/.test(original)) return null;
  let c = original.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})+&]+$/u, '').trim();
  // "Allan travels / Ai Consultant" → "Allan travels"; "Thinknext Technologies, Mohali" → "Thinknext Technologies".
  c = c.replace(/\s+\/\s+.*$/, (tail) => (ROLE_WORD_RE.test(tail) ? '' : tail)).trim();
  const commaParts = c.split(/\s*,\s*/);
  if (commaParts.length > 1 && parsePlace(commaParts[commaParts.length - 1], false)) c = commaParts.slice(0, -1).join(', ');
  if (c.length < 2 || c.length > 60 || c.split(/\s+/).length > 6) return null;
  if (SENTENCE_RE.test(c) || /[|·•]/.test(c) || parsePlace(c, false)) return null;
  if ((c.match(/\(/g) ?? []).length !== (c.match(/\)/g) ?? []).length) return null; // "Teads (Nasdaq"
  if (isNonCompanyPhrase(c)) return null;
  if (strict && (/[(),/]/.test(c) || c.split(/\s*(?:&|,)\s*/).some((part) => parsePlace(part, false)))) return null;
  return c;
}

const AT_RE = /^(.{2,80}?)\s+(?:at|@)\s*(.{2,60})$/i;

/** Title and company from "Senior Engineer at Acme" / "Engineer @Acme" / "Engineer" (role word required). */
function splitRoleAt(segment: string): { title: string | null; company: string | null } {
  const m = AT_RE.exec(clean(segment));
  if (m && ROLE_WORD_RE.test(m[1])) return { title: tidyRole(m[1]), company: tidyCompany(m[2]) };
  return { title: tidyRole(segment), company: null };
}

const TITLE_SITE_SUFFIX = /\s*[-–—|•·:]\s*(LinkedIn|GitHub|Stack Overflow|Dribbble|Behance|XING|Xing|Wellfound|AngelList|SlideShare)\b.*$/i;

function roleAndCompany(input: FacetInput, title: string, snippet: string): { title: string | null; company: string | null } {
  let current_title: string | null = null;
  let current_company: string | null = null;
  const take = (t: string | null, c: string | null) => {
    if (!current_title && t) current_title = t;
    if (!current_company && c) current_company = c;
  };

  // 1. Structured line: [location, title, company] in some order.
  const ext = (input.extensions ?? []).filter((e): e is string => typeof e === 'string').map(clean);
  const tIdx = ext.findIndex((e) => !parsePlace(e, false) && !/\d+\s*\+?\s*(followers|connections)/i.test(e) && tidyRole(e));
  if (tIdx >= 0) {
    const r = splitRoleAt(ext[tIdx]);
    const next = ext[tIdx + 1];
    take(r.title, r.company ?? (next && !ROLE_WORD_RE.test(next) ? tidyCompany(next, true) : null));
  }

  // 2. The result title: "Name - Title - Company" or "Name - Headline".
  const parts = title.replace(TITLE_SITE_SUFFIX, '').split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3 && tidyRole(parts[1]) && !ROLE_WORD_RE.test(parts[2])) {
    take(tidyRole(parts[1]), tidyCompany(parts[2], true));
  } else if (parts.length >= 2) {
    const first = parts.slice(1).join(' - ').split(/\s*[|·•]\s*/)[0];
    const r = splitRoleAt(first);
    take(r.title, r.company);
  }

  // 3. The snippet: "Title at Company · …" lead, and LinkedIn's "Experience: Company" field.
  const lead = snippet.split(/\s[·•|]\s/)[0] ?? '';
  if (lead.length <= 100) {
    const r = splitRoleAt(lead);
    take(r.title, r.company);
  }
  const exp = /\bExperience\s*:\s*([^·•|]{2,60}?)\s*(?=[·•|]|$)/i.exec(snippet)?.[1];
  take(null, tidyCompany(exp));

  // 4. The indexer's headline as a last resort for the title.
  if (!current_title && input.headline) take(splitRoleAt(clean(input.headline).split(/\s*[|·•]\s*/)[0]).title, null);
  return { title: current_title, company: current_company };
}

/** The seniority a title states, mapped onto the app's levels; null when it states none. */
export function seniorityFromTitle(text: string | null | undefined): SeniorityLevel | null {
  const t = clean(text).toLowerCase();
  if (!t) return null;
  if (/\bsemi[- ]?senior\b/.test(t)) return 'Mid';
  if (/\b(chief|ceo|cto|cfo|coo|cmo|cio|ciso|vp|svp|evp|vice president|director|head of|head\b|managing partner)\b/.test(t)) return 'Executive';
  if (/\b(principal|staff)\b/.test(t)) return 'Staff';
  if (/\b(lead|tech lead|team lead)\b/.test(t) && !/\blead\s+gen/.test(t)) return 'Lead';
  if (/\b(senior|sr\.?)\b/.test(t)) return 'Senior';
  if (/\b(junior|jr\.?|intern|trainee|apprentice|fresher|entry[- ]level|graduate engineer)\b/.test(t)) return 'Junior';
  if (/\bassociate\s+(software|engineer|developer|consultant|analyst)/.test(t)) return 'Junior';
  return null;
}

// --- Public API -------------------------------------------------------------------

/**
 * Facets plus the location label the indexer should store ("Bengaluru,
 * Karnataka, India", or "India" when only the country is known, or null when
 * nothing is). Shares every rule with deriveCandidateFacets.
 */
export function deriveFacetsWithLabel(input: FacetInput): { facets: CandidateFacets; location_label: string | null } {
  const title = clean(input.title);
  const snippet = clean(input.snippet);
  const { location, label } = resolveLocation(input, title, snippet);
  const { title: current_title, company: current_company } = roleAndCompany(input, title, snippet);
  const seniority = seniorityFromTitle(current_title) ?? seniorityFromTitle(clean(input.headline).split(/\s*[|·•]\s*/)[0]);
  return { facets: { location, current_title, current_company, seniority }, location_label: label };
}

/**
 * Normalised facets for one result: location from every piece of evidence the
 * result carries (see the module header), current title and company from the
 * title format, the snippet and the structured line, seniority from the title.
 */
export function deriveCandidateFacets(input: FacetInput): CandidateFacets {
  return deriveFacetsWithLabel(input).facets;
}

/** How specific a location facet is: 2 city, 1 country, 0 nothing. Used to never downgrade on re-runs. */
export function locationSpecificity(loc: CandidateLocationFacets | null | undefined): number {
  if (!loc) return 0;
  if (loc.city) return 2;
  return loc.country ? 1 : 0;
}

/** Loose shape check for facets read back from JSON. */
export function isCandidateFacets(x: unknown): x is CandidateFacets {
  if (!x || typeof x !== 'object') return false;
  const loc = (x as CandidateFacets).location;
  return !!loc && typeof loc === 'object' && 'country' in loc && 'city' in loc && 'source' in loc;
}
