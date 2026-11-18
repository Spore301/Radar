// ---------------------------------------------------------------------------
// Results filters: pure, browser-safe filter and facet-count logic for the
// candidate list.
//
// Product rules this module keeps:
//   - A filter never deletes a candidate. It only decides which rows the UI
//     shows. The caller always has the full list, and the hook reports how many
//     rows are hidden.
//   - No guessing. Location, company and seniority come from CandidateFacets
//     (stored at index time, or derived on the fly for older rows from the
//     result's URL / title / snippet). A facet with no evidence is "unknown",
//     and "unknown" is a first-class bucket the recruiter can include or hide.
//
// Location is hierarchical: pick countries, then optionally cities inside a
// country. A selected country with no selected cities means the whole
// country. "Include unknown location" keeps the rows whose location cannot
// rule them out: rows with no country, and (in city mode) rows in a selected
// country whose city is not stated.
//
// Imports are relative (like src/lib/search/facets.ts) so the module also runs
// under plain tsx scripts.
// ---------------------------------------------------------------------------

import type { CandidateFacets, CandidateLocationFacets, CandidatePlatform, CandidateProfile, MergedConstraints, SeniorityLevel } from '../types';
import { deriveCandidateFacets, isCandidateFacets } from '../search/facets';
import { parseLocation } from '../search/location';
import { scoreTier, type Tier } from '../utils/tier';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Sentinel for the "not stated" bucket in seniority / company selections. */
export const UNKNOWN_FACET = '__unknown__' as const;
export type UnknownFacet = typeof UNKNOWN_FACET;

export type SortKey = 'score' | 'name' | 'date';
export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'score', label: 'Relevance' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Discovered' },
];
export function isSortKey(v: unknown): v is SortKey {
  return v === 'score' || v === 'name' || v === 'date';
}

export type LocationMode = 'any' | 'country' | 'city';

export interface LocationFilter {
  /** 'any' shows every location. 'country' filters by `countries`; 'city' also narrows countries that have selected cities. */
  mode: LocationMode;
  /** Country display names as CandidateFacets carries them ("India", "United Kingdom"). */
  countries: string[];
  /** City keys from `cityKey(country, city)`; each city's country is also in `countries`. */
  cities: string[];
  /** Keep rows whose location is unknown (see unknownLocationCount for exactly which rows). */
  includeUnknown: boolean;
}

export type SeniorityFilterValue = SeniorityLevel | UnknownFacet;

export interface CandidateFilterState {
  /** Free text over name, headline and detected skills (the same fields the list always searched). */
  search: string;
  /** Empty = every platform. */
  platforms: CandidatePlatform[];
  /** Empty = every tier. */
  tiers: Tier[];
  location: LocationFilter;
  /** Empty = any seniority. May hold UNKNOWN_FACET for "not stated". */
  seniority: SeniorityFilterValue[];
  /** Company keys from `companyKey()`. Empty = any company. May hold UNKNOWN_FACET. */
  companies: string[];
  /** Ordering only; never hides a row. */
  sortBy: SortKey;
}

export const SENIORITY_ORDER: readonly SeniorityLevel[] = ['Junior', 'Mid', 'Senior', 'Staff', 'Lead', 'Executive'];
export const TIER_ORDER: readonly Tier[] = ['strong', 'potential', 'low'];
export const TIER_RANGE: Record<Tier, string> = { strong: '70–100', potential: '40–69', low: 'under 40' };

export const OPEN_LOCATION: Readonly<LocationFilter> = Object.freeze({ mode: 'any', countries: [], cities: [], includeUnknown: true }) as LocationFilter;

/** Every filter open: shows every candidate. */
export function openFilters(sortBy: SortKey = 'score'): CandidateFilterState {
  return { search: '', platforms: [], tiers: [], location: { ...OPEN_LOCATION, countries: [], cities: [] }, seniority: [], companies: [], sortBy };
}

const CITY_KEY_SEP = '::';
/** Stable key for a city inside a country ("India::Bengaluru"). */
export function cityKey(country: string, city: string): string {
  return `${country}${CITY_KEY_SEP}${city}`;
}
export function splitCityKey(key: string): { country: string; city: string } {
  const i = key.indexOf(CITY_KEY_SEP);
  return i < 0 ? { country: '', city: key } : { country: key.slice(0, i), city: key.slice(i + CITY_KEY_SEP.length) };
}

/**
 * The filters a session opens with. When the role is not remote and the
 * session names a place, location is preset to that place's country (and its
 * cities when city-bound) with unknown locations included. Remote, no
 * location, or a place the location table does not know: location 'any'.
 * Everything else starts open.
 */
export function defaultFiltersFor(constraints: Pick<MergedConstraints, 'location' | 'remote_eligible'> | null | undefined, sortBy: SortKey = 'score'): CandidateFilterState {
  const base = openFilters(sortBy);
  if (!constraints || constraints.remote_eligible) return base;
  const parsed = parseLocation(constraints.location);
  if (parsed.remote) return base;
  if (parsed.cities.length > 0) {
    const countries = uniq(parsed.cities.map((c) => c.country));
    const cities = uniq(parsed.cities.map((c) => cityKey(c.country, c.name)));
    return { ...base, location: { mode: 'city', countries, cities, includeUnknown: true } };
  }
  if (parsed.country) {
    return { ...base, location: { mode: 'country', countries: [parsed.country.name], cities: [], includeUnknown: true } };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Indexing (memoised per candidate)
// ---------------------------------------------------------------------------

export interface IndexedCandidate {
  candidate: CandidateProfile;
  facets: CandidateFacets;
  tier: Tier;
  /** Facet country, or null when the result states none. */
  country: string | null;
  /** Facet city, only when its country is known too. */
  city: string | null;
  seniority: SeniorityLevel | null;
  companyKey: string | null;
  companyLabel: string | null;
  /** Lower-cased name, headline and skills, newline-separated. */
  haystack: string;
  discoveredTs: number;
}

/** One validity rule for stored facets, shared with the server (src/lib/search/facets.ts). */
const isFacets = isCandidateFacets;

function facetInputSignature(c: CandidateProfile): string {
  const title = c.raw_scraped_data?.serp_title;
  return [c.profile_url, c.location, c.headline, c.summary_snippet, typeof title === 'string' ? title : ''].join('\u0001');
}

/** Derived facets for rows stored without them, keyed by id and checked against the inputs. */
const derivedById = new Map<string, { sig: string; facets: CandidateFacets }>();
/** Whole index entries, keyed by the candidate object itself. */
const indexByObject = new WeakMap<CandidateProfile, IndexedCandidate>();
const DERIVED_CACHE_LIMIT = 20000;

function resolveFacets(c: CandidateProfile): CandidateFacets {
  if (isFacets(c.facets)) return c.facets;
  const sig = facetInputSignature(c);
  const hit = derivedById.get(c.id);
  if (hit && hit.sig === sig) return hit.facets;
  const title = c.raw_scraped_data?.serp_title;
  const facets = deriveCandidateFacets({
    profile_url: c.profile_url,
    location: c.location,
    headline: c.headline,
    snippet: c.summary_snippet,
    title: typeof title === 'string' ? title : null,
    extensions: Array.isArray(c.raw_scraped_data?.serp_extensions) ? c.raw_scraped_data.serp_extensions : null,
    displayed_link: typeof c.raw_scraped_data?.displayed_link === 'string' ? c.raw_scraped_data.displayed_link : undefined,
  });
  if (derivedById.size >= DERIVED_CACHE_LIMIT) derivedById.clear();
  derivedById.set(c.id, { sig, facets });
  return facets;
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

const COMPANY_SUFFIX_RE = /[\s,]+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|pvt|private|plc|gmbh|corp|corporation)\.?$/i;

/**
 * Grouping key for a company name: case, spacing, trailing punctuation and
 * legal suffixes ignored ("Infosys Ltd." and "infosys" group together).
 */
export function companyKey(name: string | null | undefined): string | null {
  let k = clean(name)?.toLowerCase().replace(/[‘’]/g, "'") ?? '';
  for (let i = 0; i < 3; i++) {
    const next = k.replace(/[\s.,;:|·\-–—]+$/, '').replace(COMPANY_SUFFIX_RE, '').trim();
    if (next === k) break;
    k = next;
  }
  return k || null;
}

function buildEntry(c: CandidateProfile): IndexedCandidate {
  const facets = resolveFacets(c);
  const loc = facets.location ?? ({} as CandidateLocationFacets);
  const country = clean(loc.country);
  const city = country ? clean(loc.city) : null;
  const companyLabel = clean(facets.current_company);
  const ts = Date.parse(c.discovered_at);
  return {
    candidate: c,
    facets,
    tier: scoreTier(c.match_score),
    country,
    city,
    seniority: facets.seniority && SENIORITY_ORDER.includes(facets.seniority) ? facets.seniority : null,
    companyKey: companyKey(companyLabel),
    companyLabel,
    haystack: [c.name ?? '', c.headline ?? '', ...(c.skills_detected ?? [])].join('\n').toLowerCase(),
    discoveredTs: Number.isFinite(ts) ? ts : 0,
  };
}

/** Index entry for one candidate (cached on the object; facets cached by id + inputs). */
export function indexCandidate(c: CandidateProfile): IndexedCandidate {
  let e = indexByObject.get(c);
  if (!e) {
    e = buildEntry(c);
    indexByObject.set(c, e);
  }
  return e;
}

export function indexCandidates(candidates: readonly CandidateProfile[]): IndexedCandidate[] {
  return candidates.map(indexCandidate);
}

/** The candidate's facets: stored ones when present, otherwise derived (cached). For cards and drawers. */
export function getCandidateFacets(c: CandidateProfile): CandidateFacets {
  return indexCandidate(c).facets;
}

// ---------------------------------------------------------------------------
// Filtering + counts
// ---------------------------------------------------------------------------

const BIT_SEARCH = 1;
const BIT_PLATFORM = 2;
const BIT_TIER = 4;
const BIT_LOCATION = 8;
const BIT_SENIORITY = 16;
const BIT_COMPANY = 32;
const BIT_ALL = 63;

interface Prepared {
  q: string;
  platforms: Set<string> | null;
  tiers: Set<string> | null;
  locMode: LocationMode;
  countries: Set<string>;
  citiesByCountry: Map<string, Set<string>>;
  includeUnknown: boolean;
  seniority: Set<string> | null;
  companies: Set<string> | null;
}

function prepare(state: CandidateFilterState): Prepared {
  const loc = normaliseLocation(state.location);
  const citiesByCountry = new Map<string, Set<string>>();
  if (loc.mode === 'city') {
    for (const key of loc.cities) {
      const { country, city } = splitCityKey(key);
      let s = citiesByCountry.get(country);
      if (!s) citiesByCountry.set(country, (s = new Set()));
      s.add(city);
    }
  }
  return {
    q: state.search.trim().toLowerCase(),
    platforms: state.platforms.length ? new Set(state.platforms) : null,
    tiers: state.tiers.length ? new Set(state.tiers) : null,
    locMode: loc.mode,
    countries: new Set(loc.countries),
    citiesByCountry,
    includeUnknown: loc.includeUnknown,
    seniority: state.seniority.length ? new Set(state.seniority) : null,
    companies: state.companies.length ? new Set(state.companies) : null,
  };
}

function passesLocation(r: IndexedCandidate, p: Prepared): boolean {
  if (p.locMode === 'any') return true;
  if (!r.country) return p.includeUnknown;
  if (!p.countries.has(r.country)) return false;
  if (p.locMode === 'country') return true;
  const cities = p.citiesByCountry.get(r.country);
  if (!cities || cities.size === 0) return true; // a selected country without selected cities = the whole country
  if (!r.city) return p.includeUnknown;
  return cities.has(r.city);
}

function rowMask(r: IndexedCandidate, p: Prepared): number {
  let m = 0;
  if (!p.q || r.haystack.includes(p.q)) m |= BIT_SEARCH;
  if (!p.platforms || p.platforms.has(r.candidate.platform)) m |= BIT_PLATFORM;
  if (!p.tiers || p.tiers.has(r.tier)) m |= BIT_TIER;
  if (passesLocation(r, p)) m |= BIT_LOCATION;
  if (!p.seniority || p.seniority.has(r.seniority ?? UNKNOWN_FACET)) m |= BIT_SENIORITY;
  if (!p.companies || p.companies.has(r.companyKey ?? UNKNOWN_FACET)) m |= BIT_COMPANY;
  return m;
}

export interface CountryCount {
  country: string;
  count: number;
  /** Cities inside this country, by count. */
  cities: Array<{ city: string; key: string; count: number }>;
  /** Rows in this country with no city stated. */
  cityUnknown: number;
}

export interface FacetCounts {
  /** Rows these counts cover. */
  total: number;
  platforms: Partial<Record<CandidatePlatform, number>>;
  tiers: Record<Tier, number>;
  location: {
    /** Countries by count, most first. */
    countries: CountryCount[];
    /** Rows with no country at all. */
    unknown: number;
    /** Rows where the evidence was only the LinkedIn country subdomain. */
    fromUrlSubdomain: number;
  };
  seniority: { levels: Array<{ level: SeniorityLevel; count: number }>; unknown: number };
  companies: { items: Array<{ key: string; label: string; count: number }>; unknown: number };
}

class CountAccumulator {
  total = 0;
  platforms: Partial<Record<CandidatePlatform, number>> = {};
  tiers: Record<Tier, number> = { strong: 0, potential: 0, low: 0 };
  countries = new Map<string, { count: number; cities: Map<string, number>; cityUnknown: number }>();
  locUnknown = 0;
  fromUrlSubdomain = 0;
  seniority = new Map<SeniorityLevel, number>();
  seniorityUnknown = 0;
  companies = new Map<string, { count: number; labels: Map<string, number> }>();
  companyUnknown = 0;

  platform(r: IndexedCandidate) {
    this.platforms[r.candidate.platform] = (this.platforms[r.candidate.platform] ?? 0) + 1;
  }
  tier(r: IndexedCandidate) {
    this.tiers[r.tier]++;
  }
  location(r: IndexedCandidate) {
    if (!r.country) {
      this.locUnknown++;
      return;
    }
    if (r.facets.location?.source === 'url_subdomain') this.fromUrlSubdomain++;
    let c = this.countries.get(r.country);
    if (!c) this.countries.set(r.country, (c = { count: 0, cities: new Map(), cityUnknown: 0 }));
    c.count++;
    if (r.city) c.cities.set(r.city, (c.cities.get(r.city) ?? 0) + 1);
    else c.cityUnknown++;
  }
  senior(r: IndexedCandidate) {
    if (r.seniority) this.seniority.set(r.seniority, (this.seniority.get(r.seniority) ?? 0) + 1);
    else this.seniorityUnknown++;
  }
  company(r: IndexedCandidate) {
    if (!r.companyKey || !r.companyLabel) {
      this.companyUnknown++;
      return;
    }
    let c = this.companies.get(r.companyKey);
    if (!c) this.companies.set(r.companyKey, (c = { count: 0, labels: new Map() }));
    c.count++;
    c.labels.set(r.companyLabel, (c.labels.get(r.companyLabel) ?? 0) + 1);
  }
  all(r: IndexedCandidate) {
    this.platform(r);
    this.tier(r);
    this.location(r);
    this.senior(r);
    this.company(r);
  }

  build(): FacetCounts {
    const byCountDesc = <T extends { count: number }>(a: T & { name: string }, b: T & { name: string }) => b.count - a.count || a.name.localeCompare(b.name);
    const countries: CountryCount[] = [...this.countries.entries()]
      .map(([country, v]) => ({
        name: country,
        country,
        count: v.count,
        cityUnknown: v.cityUnknown,
        cities: [...v.cities.entries()]
          .map(([city, count]) => ({ name: city, city, key: cityKey(country, city), count }))
          .sort(byCountDesc)
          .map(({ city, key, count }) => ({ city, key, count })),
      }))
      .sort(byCountDesc)
      .map(({ country, count, cities, cityUnknown }) => ({ country, count, cities, cityUnknown }));
    const items = [...this.companies.entries()]
      .map(([key, v]) => {
        // Display the spelling the results use most.
        let label = key;
        let best = -1;
        for (const [spelling, n] of v.labels) {
          if (n > best) {
            best = n;
            label = spelling;
          }
        }
        return { name: label, key, label, count: v.count };
      })
      .sort(byCountDesc)
      .map(({ key, label, count }) => ({ key, label, count }));
    return {
      total: this.total,
      platforms: this.platforms,
      tiers: this.tiers,
      location: { countries, unknown: this.locUnknown, fromUrlSubdomain: this.fromUrlSubdomain },
      seniority: {
        levels: SENIORITY_ORDER.filter((l) => this.seniority.has(l)).map((level) => ({ level, count: this.seniority.get(level) ?? 0 })),
        unknown: this.seniorityUnknown,
      },
      companies: { items, unknown: this.companyUnknown },
    };
  }
}

// Default options: the same order as the a.name.localeCompare(b.name) the list always used, just without re-creating a collator per comparison.
const nameCollator = new Intl.Collator();

function sortRows(rows: IndexedCandidate[], sortBy: SortKey): IndexedCandidate[] {
  if (sortBy === 'score') rows.sort((a, b) => b.candidate.match_score - a.candidate.match_score);
  else if (sortBy === 'name') rows.sort((a, b) => nameCollator.compare(a.candidate.name, b.candidate.name));
  else rows.sort((a, b) => b.discoveredTs - a.discoveredTs);
  return rows;
}

export interface FilterRun {
  /** Visible rows, sorted. */
  filtered: CandidateProfile[];
  /**
   * Contextual counts: each facet group is counted over the rows that pass
   * every OTHER active filter, so a number is what selecting that value would
   * show (standard faceted search).
   */
  counts: FacetCounts;
  /** Counts over every candidate, ignoring all filters. */
  totals: FacetCounts;
}

/** Filters, sorts and counts in two passes over the index. */
export function runCandidateFilters(indexed: readonly IndexedCandidate[], state: CandidateFilterState): FilterRun {
  const p = prepare(state);
  const ctx = new CountAccumulator();
  const all = new CountAccumulator();
  const visible: IndexedCandidate[] = [];
  for (const r of indexed) {
    all.total++;
    all.all(r);
    const m = rowMask(r, p);
    if (m === BIT_ALL) {
      visible.push(r);
      ctx.total++;
      ctx.all(r);
      continue;
    }
    // Missing exactly one group: the row counts toward that group's values only.
    const missing = BIT_ALL & ~m;
    if ((missing & (missing - 1)) !== 0) continue;
    if (missing === BIT_PLATFORM) ctx.platform(r);
    else if (missing === BIT_TIER) ctx.tier(r);
    else if (missing === BIT_LOCATION) ctx.location(r);
    else if (missing === BIT_SENIORITY) ctx.senior(r);
    else if (missing === BIT_COMPANY) ctx.company(r);
    // BIT_SEARCH: free text has no facet values to count.
  }
  return { filtered: sortRows(visible, state.sortBy).map((r) => r.candidate), counts: ctx.build(), totals: all.build() };
}

/** The visible candidates for a filter state, sorted. Never mutates or drops anything from the input. */
export function applyCandidateFilters(candidates: readonly CandidateProfile[], state: CandidateFilterState): CandidateProfile[] {
  return runCandidateFilters(indexCandidates(candidates), state).filtered;
}

/** Counts per country, city (within each country), seniority, company, platform, tier and the unknown buckets, over every candidate. */
export function facetCounts(candidates: readonly CandidateProfile[]): FacetCounts {
  const acc = new CountAccumulator();
  for (const c of candidates) {
    acc.total++;
    acc.all(indexCandidate(c));
  }
  return acc.build();
}

/**
 * How many rows the "Include unknown location" toggle adds or removes under
 * the given location filter: rows with no country, plus (in city mode) rows in
 * a country with selected cities whose city is not stated. 0 in 'any' mode.
 */
export function unknownLocationCount(counts: FacetCounts, location: LocationFilter): { total: number; noLocation: number; cityNotStated: Array<{ country: string; count: number }> } {
  const loc = normaliseLocation(location);
  if (loc.mode === 'any') return { total: 0, noLocation: counts.location.unknown, cityNotStated: [] };
  const cityNotStated: Array<{ country: string; count: number }> = [];
  if (loc.mode === 'city') {
    const withCities = new Set(loc.cities.map((k) => splitCityKey(k).country));
    for (const c of counts.location.countries) if (withCities.has(c.country) && c.cityUnknown > 0) cityNotStated.push({ country: c.country, count: c.cityUnknown });
  }
  const total = counts.location.unknown + cityNotStated.reduce((s, x) => s + x.count, 0);
  return { total, noLocation: counts.location.unknown, cityNotStated };
}

// ---------------------------------------------------------------------------
// State transitions (pure)
// ---------------------------------------------------------------------------

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
function toggle<T>(xs: readonly T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

/** Keeps mode, countries and cities consistent: mode follows the selection. */
export function normaliseLocation(loc: LocationFilter): LocationFilter {
  const countries = uniq(loc.countries.filter(Boolean));
  if (loc.mode === 'any' || countries.length === 0) return { mode: 'any', countries: [], cities: [], includeUnknown: loc.includeUnknown };
  const allowed = new Set(countries);
  const cities = loc.mode === 'city' ? uniq(loc.cities.filter((k) => allowed.has(splitCityKey(k).country))) : [];
  return { mode: cities.length ? 'city' : 'country', countries, cities, includeUnknown: loc.includeUnknown };
}

export function setSearch(s: CandidateFilterState, search: string): CandidateFilterState {
  return { ...s, search };
}
export function togglePlatform(s: CandidateFilterState, p: CandidatePlatform): CandidateFilterState {
  return { ...s, platforms: toggle(s.platforms, p) };
}
export function toggleTier(s: CandidateFilterState, t: Tier): CandidateFilterState {
  return { ...s, tiers: toggle(s.tiers, t) };
}
export function toggleSeniority(s: CandidateFilterState, v: SeniorityFilterValue): CandidateFilterState {
  return { ...s, seniority: toggle(s.seniority, v) };
}
export function toggleCompany(s: CandidateFilterState, key: string): CandidateFilterState {
  return { ...s, companies: toggle(s.companies, key) };
}
export function toggleCountry(s: CandidateFilterState, country: string): CandidateFilterState {
  const loc = s.location;
  const on = loc.mode !== 'any' && loc.countries.includes(country);
  const countries = on ? loc.countries.filter((c) => c !== country) : [...(loc.mode === 'any' ? [] : loc.countries), country];
  const cities = loc.mode === 'city' ? loc.cities.filter((k) => splitCityKey(k).country !== country || !on) : [];
  return { ...s, location: normaliseLocation({ ...loc, mode: cities.length ? 'city' : 'country', countries, cities }) };
}
export function toggleCity(s: CandidateFilterState, country: string, city: string): CandidateFilterState {
  const loc = s.location;
  const key = cityKey(country, city);
  const countries = loc.mode === 'any' ? [country] : loc.countries.includes(country) ? loc.countries : [...loc.countries, country];
  const cities = toggle(loc.mode === 'city' ? loc.cities : [], key);
  return { ...s, location: normaliseLocation({ ...loc, mode: 'city', countries, cities }) };
}
/** Drops the city refinement inside one country (keeps the country). */
export function clearCities(s: CandidateFilterState, country: string): CandidateFilterState {
  const loc = s.location;
  return { ...s, location: normaliseLocation({ ...loc, cities: loc.cities.filter((k) => splitCityKey(k).country !== country) }) };
}
export function setIncludeUnknownLocation(s: CandidateFilterState, includeUnknown: boolean): CandidateFilterState {
  return { ...s, location: { ...s.location, includeUnknown } };
}
export function clearLocation(s: CandidateFilterState): CandidateFilterState {
  return { ...s, location: { ...OPEN_LOCATION, countries: [], cities: [] } };
}

const sameSet = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Equal as filters (ignores sortBy, array order and a stale location mode). */
export function filtersEqual(a: CandidateFilterState, b: CandidateFilterState): boolean {
  const la = normaliseLocation(a.location);
  const lb = normaliseLocation(b.location);
  return (
    a.search.trim() === b.search.trim() &&
    sameSet(a.platforms, b.platforms) &&
    sameSet(a.tiers, b.tiers) &&
    sameSet(a.seniority, b.seniority) &&
    sameSet(a.companies, b.companies) &&
    la.mode === lb.mode &&
    sameSet(la.countries, lb.countries) &&
    sameSet(la.cities, lb.cities) &&
    (la.mode === 'any' || la.includeUnknown === lb.includeUnknown)
  );
}

/** True when nothing is filtered (every row would show). */
export function isOpen(s: CandidateFilterState): boolean {
  return filtersEqual(s, openFilters(s.sortBy));
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export type ChipGroup = 'search' | 'platform' | 'tier' | 'location' | 'seniority' | 'company';

export interface ActiveFilterChip {
  id: string;
  group: ChipGroup;
  label: string;
  /** Platform id, for chips that show a platform mark. */
  platform?: CandidatePlatform;
  /** Removes just this filter value. */
  remove: (s: CandidateFilterState) => CandidateFilterState;
}

const TIER_CHIP: Record<Tier, string> = { strong: 'Strong · 70+', potential: 'Potential · 40–69', low: 'Low · under 40' };

/**
 * One removable chip per active filter value. `companyLabels` maps company
 * keys to display names (FacetCounts.companies.items of the unfiltered totals).
 */
export function activeFilterChips(s: CandidateFilterState, platformLabel: (p: CandidatePlatform) => string, companyLabels: ReadonlyMap<string, string>): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  const q = s.search.trim();
  if (q) chips.push({ id: 'search', group: 'search', label: `“${q}”`, remove: (x) => setSearch(x, '') });
  for (const p of s.platforms) chips.push({ id: `platform:${p}`, group: 'platform', label: platformLabel(p), platform: p, remove: (x) => togglePlatform(x, p) });
  for (const t of TIER_ORDER) if (s.tiers.includes(t)) chips.push({ id: `tier:${t}`, group: 'tier', label: TIER_CHIP[t], remove: (x) => toggleTier(x, t) });

  const loc = normaliseLocation(s.location);
  if (loc.mode !== 'any') {
    const withCities = new Set(loc.cities.map((k) => splitCityKey(k).country));
    for (const country of loc.countries) {
      if (!withCities.has(country)) chips.push({ id: `country:${country}`, group: 'location', label: country, remove: (x) => toggleCountry(x, country) });
    }
    for (const key of loc.cities) {
      const { country, city } = splitCityKey(key);
      chips.push({ id: `city:${key}`, group: 'location', label: `${city}, ${country}`, remove: (x) => toggleCity(x, country, city) });
    }
    if (!loc.includeUnknown) chips.push({ id: 'location:unknown-hidden', group: 'location', label: 'Unknown location hidden', remove: (x) => setIncludeUnknownLocation(x, true) });
  }

  for (const v of s.seniority) {
    chips.push({ id: `seniority:${v}`, group: 'seniority', label: v === UNKNOWN_FACET ? 'Seniority not stated' : v, remove: (x) => toggleSeniority(x, v) });
  }
  for (const k of s.companies) {
    chips.push({ id: `company:${k}`, group: 'company', label: k === UNKNOWN_FACET ? 'Company not stated' : companyLabels.get(k) ?? k, remove: (x) => toggleCompany(x, k) });
  }
  return chips;
}

export interface LocationDisplay {
  /** "Bengaluru, India", "India", or "Location not stated". */
  text: string;
  /** Short provenance note ("from profile URL"), or null. */
  note: string | null;
  /** Tooltip explaining where the location came from. */
  title: string;
  known: boolean;
}

/** How to show a location facet on a card. Never falls back to the raw stored string. */
export function locationDisplay(loc: CandidateLocationFacets | null | undefined): LocationDisplay {
  const city = clean(loc?.city);
  const country = clean(loc?.country);
  if (!city && !country) return { text: 'Location not stated', note: null, title: 'The search result does not state a location.', known: false };
  const text = city && country ? `${city}, ${country}` : (city ?? country)!;
  if (loc?.source === 'url_subdomain') {
    return { text, note: 'from profile URL', title: `Country read from the LinkedIn country subdomain of the profile URL; the result states no city.`, known: true };
  }
  const where = loc?.source === 'title' ? 'result title' : 'search result';
  return { text, note: null, title: `Stated in the ${where}.`, known: true };
}
