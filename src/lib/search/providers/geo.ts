import { locationCountries, parseLocation } from '../location';
import { glFromTld } from '../serpConfig';
import type { SearchGeo } from './types';

// ---------------------------------------------------------------------------
// Search vantage point for a requisition.
//
//   * Country known (city-bound, hybrid, on-site, or "Remote (India)")
//       → gl + google_domain of that country.
//   * Exactly one city and the role is not remote
//       → also a city-level `location`, as a canonical Google location name.
//   * Remote with no country, or nothing parseable
//       → the provider's default vantage point (no geo parameters).
//   * Several cities ("Bengaluru / Hyderabad", "NCR")
//       → country only: pinning one city would bias ranking against the others.
//
// Canonical names come from SerpAPI's free Locations API
// (https://serpapi.com/locations-api; GET /locations.json?q=…, no key, no
// credit). The cities in location.ts are resolved here as a static table
// (generated from that API on 2026-11-14, top "City" hit in the right
// country; Goa / Singapore / Jakarta corrected by hand to the state /
// country / province entry). A town outside the table is looked up once at
// run start and cached in-process; the result is frozen into the run config.
// ---------------------------------------------------------------------------

export const DEFAULT_GEO: SearchGeo = Object.freeze({ gl: '', hl: 'en', googleDomain: '', location: '' }) as SearchGeo;

/** location.ts city name → canonical Google location name. */
export const CANONICAL_CITY_LOCATION: Readonly<Record<string, string>> = {
  // India
  Bengaluru: 'Bengaluru,Karnataka,India',
  Mumbai: 'Mumbai,Maharashtra,India',
  Delhi: 'Delhi,Delhi,India',
  Gurugram: 'Gurugram,Haryana,India',
  Noida: 'Noida,Uttar Pradesh,India',
  Hyderabad: 'Hyderabad,Telangana,India',
  Pune: 'Pune,Maharashtra,India',
  Chennai: 'Chennai,Tamil Nadu,India',
  Kolkata: 'Kolkata,West Bengal,India',
  Ahmedabad: 'Ahmedabad,Gujarat,India',
  Jaipur: 'Jaipur,Rajasthan,India',
  Kochi: 'Kochi,Kerala,India',
  Coimbatore: 'Coimbatore,Tamil Nadu,India',
  Indore: 'Indore,Madhya Pradesh,India',
  Lucknow: 'Lucknow,Uttar Pradesh,India',
  Nagpur: 'Nagpur,Maharashtra,India',
  Surat: 'Surat,Gujarat,India',
  Chandigarh: 'Chandigarh,Chandigarh,India',
  Bhubaneswar: 'Bhubaneswar,Odisha,India',
  Vadodara: 'Vadodara,Gujarat,India',
  Mysuru: 'Mysuru,Karnataka,India',
  Thiruvananthapuram: 'Thiruvananthapuram,Kerala,India',
  Visakhapatnam: 'Visakhapatnam,Andhra Pradesh,India',
  Goa: 'Goa,India',
  // DACH
  Berlin: 'Berlin,Berlin,Germany',
  Munich: 'Munich,Bavaria,Germany',
  Hamburg: 'Hamburg,Hamburg,Germany',
  Frankfurt: 'Frankfurt,Hessen,Germany',
  Cologne: 'Cologne,North Rhine-Westphalia,Germany',
  Stuttgart: 'Stuttgart,Baden-Wurttemberg,Germany',
  Düsseldorf: 'Dusseldorf,North Rhine-Westphalia,Germany',
  Vienna: 'Vienna,Vienna,Austria',
  Zurich: 'Zurich,Zurich,Switzerland',
  Geneva: 'Geneva,Geneva,Geneva,Switzerland',
  // UK / Ireland
  London: 'London,England,United Kingdom',
  Manchester: 'Manchester,England,United Kingdom',
  Birmingham: 'Birmingham,England,United Kingdom',
  Edinburgh: 'Edinburgh,Scotland,United Kingdom',
  Dublin: 'Dublin,County Dublin,Ireland',
  // US / Canada
  'San Francisco': 'San Francisco,California,United States',
  'New York': 'New York,New York,United States',
  Seattle: 'Seattle,Washington,United States',
  Austin: 'Austin,Texas,United States',
  Boston: 'Boston,Massachusetts,United States',
  'Los Angeles': 'Los Angeles,California,United States',
  Chicago: 'Chicago,Illinois,United States',
  Toronto: 'Toronto,Ontario,Canada',
  Vancouver: 'Vancouver,British Columbia,Canada',
  // Rest of world
  Amsterdam: 'Amsterdam,North Holland,Netherlands',
  Paris: 'Paris,Paris,Ile-de-France,France',
  Madrid: 'Madrid,Community of Madrid,Spain',
  Barcelona: 'Barcelona,Catalonia,Spain',
  Milan: 'Milan,Lombardy,Italy',
  Warsaw: 'Warsaw,Masovian Voivodeship,Poland',
  Stockholm: 'Stockholm,Stockholm Municipality,Stockholm County,Sweden',
  Singapore: 'Singapore',
  Sydney: 'Sydney,New South Wales,Australia',
  Melbourne: 'Melbourne,Victoria,Australia',
  Dubai: 'Dubai,Dubai,United Arab Emirates',
  'Abu Dhabi': 'Abu Dhabi,Abu Dhabi,United Arab Emirates',
  'São Paulo': 'Sao Paulo,State of Sao Paulo,Brazil',
  Tokyo: 'Tokyo,Tokyo,Japan',
  Manila: 'Manila,Metro Manila,Philippines',
  Jakarta: 'Jakarta,Indonesia',
  'Kuala Lumpur': 'Kuala Lumpur,Federal Territory of Kuala Lumpur,Malaysia',
};

/** gl → Google domain (https://serpapi.com/google-domains.json). */
export const GOOGLE_DOMAIN_BY_GL: Readonly<Record<string, string>> = {
  in: 'google.co.in',
  uk: 'google.co.uk',
  us: 'google.com',
  de: 'google.de',
  at: 'google.at',
  ch: 'google.ch',
  nl: 'google.nl',
  fr: 'google.fr',
  es: 'google.es',
  it: 'google.it',
  pl: 'google.pl',
  se: 'google.se',
  ie: 'google.ie',
  sg: 'google.com.sg',
  au: 'google.com.au',
  nz: 'google.co.nz',
  ca: 'google.ca',
  br: 'google.com.br',
  ae: 'google.ae',
  za: 'google.co.za',
  jp: 'google.co.jp',
  ph: 'google.com.ph',
  id: 'google.co.id',
  my: 'google.com.my',
};

/** Locations API country codes are ISO ('GB'); Google's gl for the UK is 'uk'. */
function glFromIso(iso: string): string {
  const cc = iso.trim().toLowerCase();
  if (cc === 'gb') return 'uk';
  return /^[a-z]{2}$/.test(cc) ? cc : '';
}

export interface GeoPlan {
  geo: SearchGeo;
  /** A single town outside the city table that a run-start lookup may resolve. */
  unresolvedTown: string | null;
}

/** Pure, table-driven vantage point. Exported for tests and for the run start. */
export function planSearchGeo(locationText: string | null | undefined, remoteEligible: boolean): GeoPlan {
  const loc = parseLocation(locationText);
  const remote = Boolean(remoteEligible) || loc.remote;
  // One vantage country only when the role sits in exactly one country — the
  // same rule the templates use for the LinkedIn host. "London or Berlin" gets
  // the default vantage point rather than the first city's country.
  const countries = locationCountries(loc);
  const gl = countries.length === 1 ? glFromTld(countries[0].tld) : '';
  const base: SearchGeo = { ...DEFAULT_GEO, gl, googleDomain: gl ? GOOGLE_DOMAIN_BY_GL[gl] ?? '' : '' };

  if (remote) return { geo: base, unresolvedTown: null };

  if (loc.cities.length === 1) {
    return { geo: { ...base, location: CANONICAL_CITY_LOCATION[loc.cities[0].name] ?? '' }, unresolvedTown: null };
  }
  if (loc.cities.length === 0 && loc.unknown.length === 1) {
    return { geo: base, unresolvedTown: loc.unknown[0] };
  }
  return { geo: base, unresolvedTown: null };
}

interface LocationHit {
  canonical_name?: unknown;
  country_code?: unknown;
  target_type?: unknown;
}

/**
 * Pure: picks the Locations API hit to use for a town. With a known country,
 * only a hit in that country is accepted ("Delhi" also matches Delhi, Ohio).
 * Without one, the API's top city (it sorts by reach) is taken.
 */
export function pickLocationHit(hits: unknown, gl: string): { location: string; gl: string } | null {
  if (!Array.isArray(hits)) return null;
  const cities = (hits as LocationHit[]).filter(
    (h) => h && typeof h.canonical_name === 'string' && typeof h.country_code === 'string' && /^(City|Municipality)$/.test(String(h.target_type))
  );
  const hit = gl ? cities.find((h) => glFromIso(String(h.country_code)) === gl) : cities[0];
  if (!hit) return null;
  return { location: String(hit.canonical_name), gl: glFromIso(String(hit.country_code)) };
}

const townCache = new Map<string, Promise<{ location: string; gl: string } | null>>();

/**
 * The run's vantage point: the table plan, plus — for a single town outside
 * the table — one Locations API lookup (3 s, cached per process). A failed
 * lookup degrades to country-only geo; it never blocks a run.
 */
export async function resolveSearchGeo(
  locationText: string | null | undefined,
  remoteEligible: boolean,
  fetchImpl: typeof fetch = fetch
): Promise<SearchGeo> {
  const { geo, unresolvedTown } = planSearchGeo(locationText, remoteEligible);
  if (!unresolvedTown) return geo;

  const key = `${unresolvedTown.toLowerCase()}|${geo.gl}`;
  let pending = townCache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetchImpl(`https://serpapi.com/locations.json?q=${encodeURIComponent(unresolvedTown)}&limit=10`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (!res.ok) return null;
        return pickLocationHit(await res.json(), geo.gl);
      } catch {
        return null;
      }
    })();
    townCache.set(key, pending);
    // A failed lookup should not stick for the life of the process.
    void pending.then((hit) => {
      if (!hit) townCache.delete(key);
    });
  }
  const hit = await pending;
  if (!hit) return geo;
  const gl = geo.gl || hit.gl;
  return { ...geo, gl, googleDomain: gl ? GOOGLE_DOMAIN_BY_GL[gl] ?? '' : '', location: hit.location };
}

/** Test hook. */
export function resetTownCache(): void {
  townCache.clear();
}
