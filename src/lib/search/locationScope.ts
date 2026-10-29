import { metroOf, parseLocation, type CountryInfo, type ParsedLocation } from './location';
import type { MergedConstraints } from '../types';

// ---------------------------------------------------------------------------
// Location scope — "people in Bengaluru" means people in Bengaluru.
//
// The requisition's location becomes a scope; every profile the search finds
// is judged against it from what the result itself shows. The rule that makes
// this safe: only STRONG evidence can remove a profile. A labelled LinkedIn
// "Location:" field, a snippet that leads with "City, Region, Country", or
// LinkedIn's own country subdomain say where the person is. A city merely
// mentioned somewhere in the text ("Education: IIT Delhi") does not, so it can
// never get a Bengaluru engineer thrown out of a Bengaluru search.
//
//   city role            same metro → match · another known city / country → outside
//   city role, remote OK only the country is enforced
//   country role         same country → match · another country → outside
//   remote, no country   no gate
//
// Anything the result can't place is 'unknown': kept, and ranked below the
// confirmed matches by the scorer.
// ---------------------------------------------------------------------------

export type LocationVerdict = 'match' | 'unknown' | 'outside';

export interface LocationScope {
  kind: 'city' | 'country' | 'none';
  /** For receipts: "Bengaluru", "Delhi NCR", "Netherlands", "India (remote OK)". */
  label: string;
  metros: Set<string>;
  /** Lower-case place names the table doesn't know ("eindhoven" before it was added). */
  areas: string[];
  countries: CountryInfo[];
  /** Two-letter code to search from (SerpAPI gl / Bing market); '' = default vantage point. */
  searchFrom: string;
}

/** Where a found profile says the person is, and how much that's worth. */
export interface LocationEvidence {
  display: string;
  /** field / lead / url are strong; mention is a passing reference; none = nothing at all. */
  source: 'field' | 'lead' | 'url' | 'mention' | 'none';
  place: ParsedLocation | null;
  /**
   * Country from LinkedIn's subdomain (in.linkedin.com → India), when there is
   * one. Compared by code, so a country our table doesn't list (ps, ke) still
   * reads as "not the requisition's country".
   */
  urlCountry: { code: string; name: string } | null;
}

export const STRONG_SOURCES: ReadonlyArray<LocationEvidence['source']> = ['field', 'lead'];

const NONE: LocationScope = { kind: 'none', label: '', metros: new Set(), areas: [], countries: [], searchFrom: '' };
const cache = new Map<string, LocationScope>();

export function locationScopeFor(c: Pick<MergedConstraints, 'location' | 'remote_eligible'>): LocationScope {
  const key = `${c.location ?? ''}|${c.remote_eligible ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const p = parseLocation(c.location);
  const remoteOk = Boolean(c.remote_eligible) || p.remote;
  const hasPlace = p.cities.length > 0 || p.unknown.length > 0;
  let scope: LocationScope;

  if (!hasPlace && !p.countries.length) {
    scope = NONE;
  } else if (hasPlace && remoteOk && !p.countries.length) {
    // "Remote, or Eindhoven" with no knowable country: nothing to enforce.
    scope = NONE;
  } else {
    const countryLevel = !hasPlace || remoteOk;
    const placeLabel = p.groupLabel || [...p.cities.map((x) => x.name), ...p.unknown].slice(0, 3).join(' / ');
    const countryLabel = p.groupLabel && !p.cities.length ? p.groupLabel : p.countries.map((x) => x.name).slice(0, 3).join(' / ');
    scope = {
      kind: countryLevel ? 'country' : 'city',
      label: countryLevel ? `${countryLabel}${remoteOk && hasPlace ? ' (remote OK)' : ''}` : placeLabel,
      metros: new Set(p.cities.map(metroOf)),
      areas: p.unknown.map((x) => x.toLowerCase()),
      countries: p.countries,
      searchFrom: p.countries.length === 1 || p.cities.length ? (p.country?.code ?? '') : '',
    };
  }

  if (cache.size > 500) cache.clear();
  cache.set(key, scope);
  return scope;
}

const mentionsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);

/** Is the person where the requisition needs them? See the module header for the rules. */
export function judgeLocation(ev: LocationEvidence, scope: LocationScope): { verdict: LocationVerdict; reason: string } {
  if (scope.kind === 'none') return { verdict: 'match', reason: 'no location requirement' };
  const inScope = (x: CountryInfo | null | undefined) => Boolean(x && scope.countries.some((s) => s.name === x.name));

  if (STRONG_SOURCES.includes(ev.source) && ev.place) {
    const p = ev.place;
    if (scope.areas.some((a) => mentionsWord(ev.display, a))) return { verdict: 'match', reason: `lists ${ev.display}` };
    if (p.cities.length) {
      if (scope.kind === 'city') {
        if (p.cities.some((x) => scope.metros.has(metroOf(x)))) return { verdict: 'match', reason: `lives in ${ev.display}` };
        return { verdict: 'outside', reason: `lists ${ev.display}` };
      }
      return p.countries.some(inScope) ? { verdict: 'match', reason: `lives in ${ev.display}` } : { verdict: 'outside', reason: `lists ${ev.display}` };
    }
    if (p.countries.length) {
      if (scope.countries.length && !p.countries.some(inScope)) return { verdict: 'outside', reason: `lists ${ev.display}` };
      if (scope.kind === 'country') return { verdict: 'match', reason: `lists ${ev.display}` };
      return { verdict: 'unknown', reason: `only the country (${ev.display}) is shown` };
    }
    // A labelled place we don't recognise ("Thrissur"): let the URL's country decide if it can.
  }

  if (ev.urlCountry && scope.countries.length) {
    if (!scope.countries.some((s) => s.code === ev.urlCountry!.code)) return { verdict: 'outside', reason: `LinkedIn ${ev.urlCountry.name} profile` };
    if (scope.kind === 'country') return { verdict: 'match', reason: `LinkedIn ${ev.urlCountry.name} profile` };
  }
  return { verdict: 'unknown', reason: STRONG_SOURCES.includes(ev.source) ? `"${ev.display}" is not a place we recognise` : 'the result does not say where the person is' };
}
