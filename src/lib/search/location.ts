// ---------------------------------------------------------------------------
// Location parsing for sourcing.
//
// A JD says "Kolkata", "Bengaluru / Hyderabad", "Remote (India)", "NCR" or
// "London, UK". Queries need the spellings a profile would actually carry
// (city + its common alias), the country domain for the geo sweep, and a
// clean "City, Country" string to store. Pure, browser-safe, table-driven.
// ---------------------------------------------------------------------------

export interface KnownCity {
  /** Canonical display name. */
  name: string;
  /** Other spellings recruiters and profiles use, matched case-insensitively. */
  aliases: string[];
  /** State / region shown on profiles ("Karnataka"). */
  region?: string;
  country: string;
}

export interface CountryInfo {
  name: string;
  tld: string;
  aliases: string[];
}

const COUNTRIES: CountryInfo[] = [
  { name: 'India', tld: '.in', aliases: ['india', 'bharat'] },
  { name: 'Germany', tld: '.de', aliases: ['germany', 'deutschland'] },
  { name: 'Austria', tld: '.at', aliases: ['austria', 'österreich'] },
  { name: 'Switzerland', tld: '.ch', aliases: ['switzerland', 'schweiz', 'suisse'] },
  { name: 'United Kingdom', tld: '.co.uk', aliases: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'great britain', 'britain'] },
  { name: 'United States', tld: '.com', aliases: ['united states', 'usa', 'us', 'america'] },
  { name: 'Netherlands', tld: '.nl', aliases: ['netherlands', 'holland'] },
  { name: 'France', tld: '.fr', aliases: ['france'] },
  { name: 'Spain', tld: '.es', aliases: ['spain', 'españa'] },
  { name: 'Italy', tld: '.it', aliases: ['italy', 'italia'] },
  { name: 'Poland', tld: '.pl', aliases: ['poland', 'polska'] },
  { name: 'Sweden', tld: '.se', aliases: ['sweden'] },
  { name: 'Ireland', tld: '.ie', aliases: ['ireland'] },
  { name: 'Singapore', tld: '.sg', aliases: ['singapore'] },
  { name: 'Australia', tld: '.com.au', aliases: ['australia'] },
  { name: 'New Zealand', tld: '.co.nz', aliases: ['new zealand'] },
  { name: 'Canada', tld: '.ca', aliases: ['canada'] },
  { name: 'Brazil', tld: '.com.br', aliases: ['brazil', 'brasil'] },
  { name: 'United Arab Emirates', tld: '.ae', aliases: ['uae', 'united arab emirates', 'emirates'] },
  { name: 'South Africa', tld: '.co.za', aliases: ['south africa'] },
  { name: 'Japan', tld: '.co.jp', aliases: ['japan'] },
  { name: 'Philippines', tld: '.ph', aliases: ['philippines'] },
  { name: 'Indonesia', tld: '.co.id', aliases: ['indonesia'] },
  { name: 'Malaysia', tld: '.my', aliases: ['malaysia'] },
];

const CITIES: KnownCity[] = [
  // India
  { name: 'Bengaluru', aliases: ['bangalore', 'bengaluru', 'blr'], region: 'Karnataka', country: 'India' },
  { name: 'Mumbai', aliases: ['mumbai', 'bombay', 'navi mumbai', 'thane'], region: 'Maharashtra', country: 'India' },
  { name: 'Delhi', aliases: ['delhi', 'new delhi'], region: 'Delhi', country: 'India' },
  { name: 'Gurugram', aliases: ['gurgaon', 'gurugram'], region: 'Haryana', country: 'India' },
  { name: 'Noida', aliases: ['noida', 'greater noida'], region: 'Uttar Pradesh', country: 'India' },
  { name: 'Hyderabad', aliases: ['hyderabad', 'secunderabad'], region: 'Telangana', country: 'India' },
  { name: 'Pune', aliases: ['pune', 'poona'], region: 'Maharashtra', country: 'India' },
  { name: 'Chennai', aliases: ['chennai', 'madras'], region: 'Tamil Nadu', country: 'India' },
  { name: 'Kolkata', aliases: ['kolkata', 'calcutta'], region: 'West Bengal', country: 'India' },
  { name: 'Ahmedabad', aliases: ['ahmedabad', 'amdavad'], region: 'Gujarat', country: 'India' },
  { name: 'Jaipur', aliases: ['jaipur'], region: 'Rajasthan', country: 'India' },
  { name: 'Kochi', aliases: ['kochi', 'cochin', 'ernakulam'], region: 'Kerala', country: 'India' },
  { name: 'Coimbatore', aliases: ['coimbatore'], region: 'Tamil Nadu', country: 'India' },
  { name: 'Indore', aliases: ['indore'], region: 'Madhya Pradesh', country: 'India' },
  { name: 'Lucknow', aliases: ['lucknow'], region: 'Uttar Pradesh', country: 'India' },
  { name: 'Nagpur', aliases: ['nagpur'], region: 'Maharashtra', country: 'India' },
  { name: 'Surat', aliases: ['surat'], region: 'Gujarat', country: 'India' },
  { name: 'Chandigarh', aliases: ['chandigarh', 'mohali', 'panchkula'], region: 'Chandigarh', country: 'India' },
  { name: 'Bhubaneswar', aliases: ['bhubaneswar', 'bhubaneshwar'], region: 'Odisha', country: 'India' },
  { name: 'Vadodara', aliases: ['vadodara', 'baroda'], region: 'Gujarat', country: 'India' },
  { name: 'Mysuru', aliases: ['mysore', 'mysuru'], region: 'Karnataka', country: 'India' },
  { name: 'Thiruvananthapuram', aliases: ['thiruvananthapuram', 'trivandrum'], region: 'Kerala', country: 'India' },
  { name: 'Visakhapatnam', aliases: ['visakhapatnam', 'vizag'], region: 'Andhra Pradesh', country: 'India' },
  { name: 'Goa', aliases: ['goa', 'panaji'], region: 'Goa', country: 'India' },
  // DACH
  { name: 'Berlin', aliases: ['berlin'], country: 'Germany' },
  { name: 'Munich', aliases: ['munich', 'münchen', 'muenchen'], region: 'Bavaria', country: 'Germany' },
  { name: 'Hamburg', aliases: ['hamburg'], country: 'Germany' },
  { name: 'Frankfurt', aliases: ['frankfurt', 'frankfurt am main'], region: 'Hesse', country: 'Germany' },
  { name: 'Cologne', aliases: ['cologne', 'köln', 'koeln'], region: 'North Rhine-Westphalia', country: 'Germany' },
  { name: 'Stuttgart', aliases: ['stuttgart'], region: 'Baden-Württemberg', country: 'Germany' },
  { name: 'Düsseldorf', aliases: ['düsseldorf', 'dusseldorf'], region: 'North Rhine-Westphalia', country: 'Germany' },
  { name: 'Vienna', aliases: ['vienna', 'wien'], country: 'Austria' },
  { name: 'Zurich', aliases: ['zurich', 'zürich'], country: 'Switzerland' },
  { name: 'Geneva', aliases: ['geneva', 'genève'], country: 'Switzerland' },
  // UK / Ireland
  { name: 'London', aliases: ['london', 'greater london'], region: 'England', country: 'United Kingdom' },
  { name: 'Manchester', aliases: ['manchester'], region: 'England', country: 'United Kingdom' },
  { name: 'Birmingham', aliases: ['birmingham'], region: 'England', country: 'United Kingdom' },
  { name: 'Edinburgh', aliases: ['edinburgh'], region: 'Scotland', country: 'United Kingdom' },
  { name: 'Dublin', aliases: ['dublin'], country: 'Ireland' },
  // US / Canada
  { name: 'San Francisco', aliases: ['san francisco', 'sf', 'bay area', 'silicon valley'], region: 'California', country: 'United States' },
  { name: 'New York', aliases: ['new york', 'nyc', 'new york city', 'manhattan'], region: 'New York', country: 'United States' },
  { name: 'Seattle', aliases: ['seattle'], region: 'Washington', country: 'United States' },
  { name: 'Austin', aliases: ['austin'], region: 'Texas', country: 'United States' },
  { name: 'Boston', aliases: ['boston'], region: 'Massachusetts', country: 'United States' },
  { name: 'Los Angeles', aliases: ['los angeles', 'la'], region: 'California', country: 'United States' },
  { name: 'Chicago', aliases: ['chicago'], region: 'Illinois', country: 'United States' },
  { name: 'Toronto', aliases: ['toronto'], region: 'Ontario', country: 'Canada' },
  { name: 'Vancouver', aliases: ['vancouver'], region: 'British Columbia', country: 'Canada' },
  // Rest of world
  { name: 'Amsterdam', aliases: ['amsterdam'], country: 'Netherlands' },
  { name: 'Paris', aliases: ['paris'], country: 'France' },
  { name: 'Madrid', aliases: ['madrid'], country: 'Spain' },
  { name: 'Barcelona', aliases: ['barcelona'], country: 'Spain' },
  { name: 'Milan', aliases: ['milan', 'milano'], country: 'Italy' },
  { name: 'Warsaw', aliases: ['warsaw', 'warszawa'], country: 'Poland' },
  { name: 'Stockholm', aliases: ['stockholm'], country: 'Sweden' },
  { name: 'Singapore', aliases: ['singapore'], country: 'Singapore' },
  { name: 'Sydney', aliases: ['sydney'], region: 'New South Wales', country: 'Australia' },
  { name: 'Melbourne', aliases: ['melbourne'], region: 'Victoria', country: 'Australia' },
  { name: 'Dubai', aliases: ['dubai'], country: 'United Arab Emirates' },
  { name: 'Abu Dhabi', aliases: ['abu dhabi'], country: 'United Arab Emirates' },
  { name: 'São Paulo', aliases: ['são paulo', 'sao paulo'], country: 'Brazil' },
  { name: 'Tokyo', aliases: ['tokyo'], country: 'Japan' },
  { name: 'Manila', aliases: ['manila', 'metro manila'], country: 'Philippines' },
  { name: 'Jakarta', aliases: ['jakarta'], country: 'Indonesia' },
  { name: 'Kuala Lumpur', aliases: ['kuala lumpur', 'kl'], country: 'Malaysia' },
];

/** Region-level groupings that JDs use as a location ("NCR", "DACH"). */
const REGION_GROUPS: Array<{ match: RegExp; cities: string[]; label: string; country: string }> = [
  { match: /\b(ncr|delhi ncr|national capital region)\b/i, cities: ['Delhi', 'Gurugram', 'Noida'], label: 'Delhi NCR', country: 'India' },
  { match: /\bdach\b/i, cities: ['Berlin', 'Munich', 'Vienna', 'Zurich'], label: 'DACH', country: 'Germany' },
  { match: /\b(bay area|silicon valley)\b/i, cities: ['San Francisco'], label: 'Bay Area', country: 'United States' },
];

const REMOTE_RE = /\b(remote|work from home|wfh|distributed|anywhere|hybrid)\b/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cityAliasIndex: Array<{ re: RegExp; city: KnownCity }> = CITIES.flatMap((city) =>
  city.aliases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((alias) => ({ re: new RegExp(`(?<![\\w-])${escape(alias)}(?![\\w-])`, 'i'), city }))
);
const countryAliasIndex: Array<{ re: RegExp; country: CountryInfo }> = COUNTRIES.flatMap((c) =>
  c.aliases.map((alias) => ({ re: new RegExp(`(?<![\\w-])${escape(alias)}(?![\\w-])`, 'i'), country: c }))
);

/** One regex that matches any known city alias — for scanning snippets and JDs. */
export const ANY_CITY_RE = new RegExp(
  `(?<![\\w-])(${CITIES.flatMap((c) => c.aliases)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|')})(?![\\w-])`,
  'i'
);

export interface ParsedLocation {
  /** What the recruiter wrote. */
  raw: string;
  /** Canonical city names found, in order. */
  cities: KnownCity[];
  /** Best single country (from the first city, or an explicit country word). */
  country: CountryInfo | null;
  /** True when the text says remote / hybrid / WFH. */
  remote: boolean;
  /** Free text that matched no table — kept so an unknown town still becomes a query term. */
  unknown: string[];
  /** "Kolkata, India" — what to store. Empty when nothing could be read. */
  display: string;
  /** Country domain for the geo sweep, or '' when unknown. */
  tld: string;
  /**
   * Terms a profile page would carry, in priority order: each city with its
   * best-known alternate spelling, then the region. Never includes "Remote".
   */
  searchTerms: string[];
}

function uniqCI(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Parses free-text location into cities, country, remote flag and query terms. */
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  const text = (raw ?? '').trim();
  const empty: ParsedLocation = { raw: text, cities: [], country: null, remote: false, unknown: [], display: '', tld: '', searchTerms: [] };
  if (!text) return empty;

  const remote = REMOTE_RE.test(text);
  const found: KnownCity[] = [];
  let explicitCountry: CountryInfo | null = null;

  for (const group of REGION_GROUPS) {
    if (group.match.test(text)) {
      for (const name of group.cities) {
        const c = CITIES.find((x) => x.name === name);
        if (c && !found.includes(c)) found.push(c);
      }
    }
  }

  // Split on the separators JDs use for multi-location roles.
  const segments = text
    .replace(REMOTE_RE, ' ')
    .split(/\s*(?:[\/,|;()]|\bor\b|\band\b|&|\+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const unknown: string[] = [];
  for (const seg of segments) {
    const cityHit = cityAliasIndex.find(({ re }) => re.test(seg));
    if (cityHit) {
      if (!found.includes(cityHit.city)) found.push(cityHit.city);
      continue;
    }
    const countryHit = countryAliasIndex.find(({ re }) => re.test(seg));
    if (countryHit) {
      explicitCountry = explicitCountry ?? countryHit.country;
      continue;
    }
    // A region name attached to a known city ("Karnataka") is not unknown.
    if (CITIES.some((c) => c.region && c.region.toLowerCase() === seg.toLowerCase())) continue;
    if (seg.length >= 3 && seg.length <= 40 && !/\d/.test(seg)) unknown.push(seg.replace(/\b\w/g, (m) => m.toUpperCase()));
  }

  const country = explicitCountry ?? (found[0] ? COUNTRIES.find((c) => c.name === found[0].country) ?? null : null);

  const searchTerms = uniqCI([
    ...found.flatMap((c) => {
      const alt = c.aliases.map((a) => a.replace(/\b\w/g, (m) => m.toUpperCase())).find((a) => a.toLowerCase() !== c.name.toLowerCase() && a.length > 2);
      return alt ? [c.name, alt] : [c.name];
    }),
    ...unknown,
  ]).slice(0, 4);

  const primaryLabel = found[0]?.name ?? unknown[0] ?? (remote ? 'Remote' : '');
  const displayParts = [primaryLabel];
  if (country && primaryLabel && primaryLabel.toLowerCase() !== country.name.toLowerCase()) displayParts.push(country.name);
  if (!primaryLabel && country) displayParts.splice(0, 1, country.name);
  const display = displayParts.filter(Boolean).join(', ');

  return {
    raw: text,
    cities: found,
    country,
    remote,
    unknown,
    display: remote && found.length === 0 && !country ? 'Remote' : display,
    tld: country?.tld ?? '',
    searchTerms,
  };
}

/** First known city mentioned anywhere in a body of text (a JD), or null. */
export function detectCityInText(text: string): KnownCity | null {
  const m = text.match(ANY_CITY_RE);
  if (!m) return null;
  const alias = m[1].toLowerCase();
  return CITIES.find((c) => c.aliases.includes(alias)) ?? null;
}

/** "Bengaluru, Karnataka, India" or "Kolkata, India" for display. */
export function cityDisplay(city: KnownCity): string {
  return [city.name, city.country].join(', ');
}

/** Do two location strings refer to the same city (any alias)? Used by scoring. */
export function sameCity(a: string, b: string): boolean {
  const ca = detectCityInText(a);
  const cb = detectCityInText(b);
  if (ca && cb) return ca.name === cb.name;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
