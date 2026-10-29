// ---------------------------------------------------------------------------
// Location parsing for sourcing.
//
// A JD says "Kolkata", "Bengaluru / Hyderabad", "Remote (India)", "NCR" or
// "London, UK"; a profile says "Greater Bengaluru Area", "Amstelveen, North
// Holland, Netherlands" or "Cambridge, Massachusetts, United States". Both
// sides go through parseLocation(), so "is this person where the job is?"
// compares like with like. Queries need the spellings a profile would carry
// (city + its common alternate), the country for the search vantage point,
// and a clean "City, Country" string to store. Pure, browser-safe,
// table-driven.
//
// Metros: cities that are one labour market share a `metro` id and match each
// other (Gurugram for a "Delhi" role, Amstelveen for "Amsterdam"). A suburb
// that is effectively the city is an alias instead ("Navi Mumbai").
// ---------------------------------------------------------------------------

export interface KnownCity {
  /** Canonical display name. */
  name: string;
  /** One alternate spelling worth searching alongside `name` ("Bangalore"). */
  alt?: string;
  /** Every lower-case name that identifies this city on a profile, including `name`. */
  aliases: string[];
  /** State / region shown on profiles ("Karnataka"). */
  region?: string;
  country: string;
  /** Cities sharing a metro match each other. Defaults to `name`. */
  metro?: string;
}

export interface CountryInfo {
  name: string;
  /** Two-letter code: SerpAPI `gl`, Bing market and LinkedIn's country subdomain ('uk' for the UK). */
  code: string;
  tld: string;
  aliases: string[];
}

const COUNTRIES: CountryInfo[] = [
  { name: 'India', code: 'in', tld: '.in', aliases: ['india', 'bharat'] },
  { name: 'Germany', code: 'de', tld: '.de', aliases: ['germany', 'deutschland'] },
  { name: 'Austria', code: 'at', tld: '.at', aliases: ['austria', 'österreich', 'osterreich'] },
  { name: 'Switzerland', code: 'ch', tld: '.ch', aliases: ['switzerland', 'schweiz', 'suisse', 'svizzera'] },
  { name: 'United Kingdom', code: 'uk', tld: '.co.uk', aliases: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'northern ireland', 'great britain', 'britain'] },
  { name: 'United States', code: 'us', tld: '.com', aliases: ['united states', 'united states of america', 'usa', 'us', 'america'] },
  { name: 'Netherlands', code: 'nl', tld: '.nl', aliases: ['netherlands', 'the netherlands', 'holland', 'nederland'] },
  { name: 'Belgium', code: 'be', tld: '.be', aliases: ['belgium', 'belgië', 'belgie', 'belgique'] },
  { name: 'Luxembourg', code: 'lu', tld: '.lu', aliases: ['luxembourg'] },
  { name: 'France', code: 'fr', tld: '.fr', aliases: ['france'] },
  { name: 'Spain', code: 'es', tld: '.es', aliases: ['spain', 'españa', 'espana'] },
  { name: 'Portugal', code: 'pt', tld: '.pt', aliases: ['portugal'] },
  { name: 'Italy', code: 'it', tld: '.it', aliases: ['italy', 'italia'] },
  { name: 'Ireland', code: 'ie', tld: '.ie', aliases: ['ireland'] },
  { name: 'Sweden', code: 'se', tld: '.se', aliases: ['sweden', 'sverige'] },
  { name: 'Norway', code: 'no', tld: '.no', aliases: ['norway', 'norge'] },
  { name: 'Denmark', code: 'dk', tld: '.dk', aliases: ['denmark', 'danmark'] },
  { name: 'Finland', code: 'fi', tld: '.fi', aliases: ['finland', 'suomi'] },
  { name: 'Poland', code: 'pl', tld: '.pl', aliases: ['poland', 'polska'] },
  { name: 'Czech Republic', code: 'cz', tld: '.cz', aliases: ['czech republic', 'czechia'] },
  { name: 'Hungary', code: 'hu', tld: '.hu', aliases: ['hungary', 'magyarország'] },
  { name: 'Romania', code: 'ro', tld: '.ro', aliases: ['romania', 'românia'] },
  { name: 'Greece', code: 'gr', tld: '.gr', aliases: ['greece'] },
  { name: 'Estonia', code: 'ee', tld: '.ee', aliases: ['estonia'] },
  { name: 'Lithuania', code: 'lt', tld: '.lt', aliases: ['lithuania'] },
  { name: 'Ukraine', code: 'ua', tld: '.com.ua', aliases: ['ukraine'] },
  { name: 'Turkey', code: 'tr', tld: '.com.tr', aliases: ['turkey', 'türkiye', 'turkiye'] },
  { name: 'Israel', code: 'il', tld: '.co.il', aliases: ['israel'] },
  { name: 'United Arab Emirates', code: 'ae', tld: '.ae', aliases: ['united arab emirates', 'uae', 'emirates'] },
  { name: 'Saudi Arabia', code: 'sa', tld: '.com.sa', aliases: ['saudi arabia', 'ksa'] },
  { name: 'Qatar', code: 'qa', tld: '.qa', aliases: ['qatar'] },
  { name: 'Egypt', code: 'eg', tld: '.com.eg', aliases: ['egypt'] },
  { name: 'Nigeria', code: 'ng', tld: '.com.ng', aliases: ['nigeria'] },
  { name: 'Kenya', code: 'ke', tld: '.co.ke', aliases: ['kenya'] },
  { name: 'South Africa', code: 'za', tld: '.co.za', aliases: ['south africa'] },
  { name: 'Singapore', code: 'sg', tld: '.sg', aliases: ['singapore'] },
  { name: 'Malaysia', code: 'my', tld: '.my', aliases: ['malaysia'] },
  { name: 'Indonesia', code: 'id', tld: '.co.id', aliases: ['indonesia'] },
  { name: 'Philippines', code: 'ph', tld: '.ph', aliases: ['philippines'] },
  { name: 'Thailand', code: 'th', tld: '.co.th', aliases: ['thailand'] },
  { name: 'Vietnam', code: 'vn', tld: '.com.vn', aliases: ['vietnam', 'viet nam'] },
  { name: 'China', code: 'cn', tld: '.cn', aliases: ['china'] },
  { name: 'Hong Kong', code: 'hk', tld: '.com.hk', aliases: ['hong kong', 'hong kong sar'] },
  { name: 'Taiwan', code: 'tw', tld: '.com.tw', aliases: ['taiwan'] },
  { name: 'South Korea', code: 'kr', tld: '.co.kr', aliases: ['south korea', 'korea', 'republic of korea'] },
  { name: 'Japan', code: 'jp', tld: '.co.jp', aliases: ['japan'] },
  { name: 'Australia', code: 'au', tld: '.com.au', aliases: ['australia'] },
  { name: 'New Zealand', code: 'nz', tld: '.co.nz', aliases: ['new zealand'] },
  { name: 'Pakistan', code: 'pk', tld: '.com.pk', aliases: ['pakistan'] },
  { name: 'Bangladesh', code: 'bd', tld: '.com.bd', aliases: ['bangladesh'] },
  { name: 'Sri Lanka', code: 'lk', tld: '.lk', aliases: ['sri lanka'] },
  { name: 'Canada', code: 'ca', tld: '.ca', aliases: ['canada'] },
  { name: 'Mexico', code: 'mx', tld: '.com.mx', aliases: ['mexico', 'méxico'] },
  { name: 'Brazil', code: 'br', tld: '.com.br', aliases: ['brazil', 'brasil'] },
  { name: 'Argentina', code: 'ar', tld: '.com.ar', aliases: ['argentina'] },
  { name: 'Colombia', code: 'co', tld: '.com.co', aliases: ['colombia'] },
  { name: 'Chile', code: 'cl', tld: '.cl', aliases: ['chile'] },
  { name: 'Peru', code: 'pe', tld: '.com.pe', aliases: ['peru', 'perú'] },
];

const c = (name: string, country: string, aliases: string[], extra: Partial<KnownCity> = {}): KnownCity => ({
  name,
  country,
  aliases: Array.from(new Set([name.toLowerCase(), ...(extra.alt ? [extra.alt.toLowerCase()] : []), ...aliases])),
  ...extra,
});

const CITIES: KnownCity[] = [
  // India
  c('Bengaluru', 'India', ['bangalore', 'blr', 'bengaluru urban', 'bangalore urban', 'whitefield', 'electronic city'], { alt: 'Bangalore', region: 'Karnataka' }),
  c('Mumbai', 'India', ['bombay', 'navi mumbai', 'thane', 'powai'], { alt: 'Bombay', region: 'Maharashtra' }),
  c('Delhi', 'India', ['new delhi'], { region: 'Delhi', metro: 'Delhi NCR' }),
  c('Gurugram', 'India', ['gurgaon'], { alt: 'Gurgaon', region: 'Haryana', metro: 'Delhi NCR' }),
  c('Noida', 'India', ['greater noida'], { region: 'Uttar Pradesh', metro: 'Delhi NCR' }),
  c('Ghaziabad', 'India', [], { region: 'Uttar Pradesh', metro: 'Delhi NCR' }),
  c('Faridabad', 'India', [], { region: 'Haryana', metro: 'Delhi NCR' }),
  c('Hyderabad', 'India', ['secunderabad', 'hitec city', 'gachibowli'], { region: 'Telangana' }),
  c('Pune', 'India', ['poona', 'pimpri-chinchwad', 'pimpri', 'chinchwad', 'hinjewadi'], { region: 'Maharashtra' }),
  c('Chennai', 'India', ['madras'], { region: 'Tamil Nadu' }),
  c('Kolkata', 'India', ['calcutta'], { region: 'West Bengal' }),
  c('Ahmedabad', 'India', ['amdavad'], { region: 'Gujarat' }),
  c('Gandhinagar', 'India', [], { region: 'Gujarat', metro: 'Ahmedabad' }),
  c('Jaipur', 'India', [], { region: 'Rajasthan' }),
  c('Kochi', 'India', ['cochin', 'ernakulam', 'kakkanad'], { region: 'Kerala' }),
  c('Thiruvananthapuram', 'India', ['trivandrum', 'technopark'], { alt: 'Trivandrum', region: 'Kerala' }),
  c('Coimbatore', 'India', [], { region: 'Tamil Nadu' }),
  c('Madurai', 'India', [], { region: 'Tamil Nadu' }),
  c('Indore', 'India', [], { region: 'Madhya Pradesh' }),
  c('Bhopal', 'India', [], { region: 'Madhya Pradesh' }),
  c('Lucknow', 'India', [], { region: 'Uttar Pradesh' }),
  c('Kanpur', 'India', [], { region: 'Uttar Pradesh' }),
  c('Nagpur', 'India', [], { region: 'Maharashtra' }),
  c('Nashik', 'India', ['nasik'], { region: 'Maharashtra' }),
  c('Surat', 'India', [], { region: 'Gujarat' }),
  c('Vadodara', 'India', ['baroda'], { alt: 'Baroda', region: 'Gujarat' }),
  c('Chandigarh', 'India', ['mohali', 'panchkula', 'tricity'], { region: 'Chandigarh' }),
  c('Ludhiana', 'India', [], { region: 'Punjab' }),
  c('Bhubaneswar', 'India', ['bhubaneshwar'], { region: 'Odisha' }),
  c('Mysuru', 'India', ['mysore'], { alt: 'Mysore', region: 'Karnataka' }),
  c('Mangaluru', 'India', ['mangalore'], { alt: 'Mangalore', region: 'Karnataka' }),
  c('Hubballi', 'India', ['hubli', 'hubli-dharwad'], { region: 'Karnataka' }),
  c('Visakhapatnam', 'India', ['vizag'], { alt: 'Vizag', region: 'Andhra Pradesh' }),
  c('Vijayawada', 'India', [], { region: 'Andhra Pradesh' }),
  c('Goa', 'India', ['panaji', 'panjim', 'margao'], { region: 'Goa' }),
  c('Patna', 'India', [], { region: 'Bihar' }),
  c('Ranchi', 'India', [], { region: 'Jharkhand' }),
  c('Raipur', 'India', [], { region: 'Chhattisgarh' }),
  c('Guwahati', 'India', [], { region: 'Assam' }),
  c('Dehradun', 'India', [], { region: 'Uttarakhand' }),
  // Pakistan / Bangladesh / Sri Lanka
  c('Karachi', 'Pakistan', [], { region: 'Sindh' }),
  c('Hyderabad', 'Pakistan', [], { region: 'Sindh', metro: 'Hyderabad (Pakistan)' }),
  c('Lahore', 'Pakistan', [], { region: 'Punjab' }),
  c('Islamabad', 'Pakistan', ['rawalpindi'], {}),
  c('Dhaka', 'Bangladesh', ['dacca'], {}),
  c('Colombo', 'Sri Lanka', [], {}),
  // DACH
  c('Berlin', 'Germany', [], {}),
  c('Munich', 'Germany', ['münchen', 'muenchen'], { alt: 'München', region: 'Bavaria' }),
  c('Hamburg', 'Germany', [], {}),
  c('Frankfurt', 'Germany', ['frankfurt am main'], { region: 'Hesse' }),
  c('Cologne', 'Germany', ['köln', 'koeln'], { alt: 'Köln', region: 'North Rhine-Westphalia' }),
  c('Düsseldorf', 'Germany', ['dusseldorf', 'duesseldorf'], { region: 'North Rhine-Westphalia' }),
  c('Stuttgart', 'Germany', [], { region: 'Baden-Württemberg' }),
  c('Leipzig', 'Germany', [], { region: 'Saxony' }),
  c('Dresden', 'Germany', [], { region: 'Saxony' }),
  c('Nuremberg', 'Germany', ['nürnberg', 'nuernberg'], { alt: 'Nürnberg', region: 'Bavaria' }),
  c('Hanover', 'Germany', ['hannover'], { alt: 'Hannover', region: 'Lower Saxony' }),
  c('Karlsruhe', 'Germany', [], { region: 'Baden-Württemberg' }),
  c('Mannheim', 'Germany', [], { region: 'Baden-Württemberg' }),
  c('Bonn', 'Germany', [], { region: 'North Rhine-Westphalia' }),
  c('Dortmund', 'Germany', [], { region: 'North Rhine-Westphalia' }),
  c('Bremen', 'Germany', [], {}),
  c('Vienna', 'Austria', ['wien'], { alt: 'Wien' }),
  c('Graz', 'Austria', [], {}),
  c('Linz', 'Austria', [], {}),
  c('Zurich', 'Switzerland', ['zürich', 'zuerich'], { alt: 'Zürich' }),
  c('Geneva', 'Switzerland', ['genève', 'geneve', 'genf'], {}),
  c('Basel', 'Switzerland', [], {}),
  c('Lausanne', 'Switzerland', [], {}),
  c('Bern', 'Switzerland', ['berne'], {}),
  // UK / Ireland
  c('London', 'United Kingdom', ['greater london', 'city of london'], { region: 'England' }),
  c('Manchester', 'United Kingdom', ['greater manchester'], { region: 'England' }),
  c('Birmingham', 'United Kingdom', [], { region: 'England' }),
  c('Leeds', 'United Kingdom', [], { region: 'England' }),
  c('Bristol', 'United Kingdom', [], { region: 'England' }),
  c('Cambridge', 'United Kingdom', [], { region: 'England' }),
  c('Oxford', 'United Kingdom', [], { region: 'England' }),
  c('Liverpool', 'United Kingdom', [], { region: 'England' }),
  c('Newcastle', 'United Kingdom', ['newcastle upon tyne'], { region: 'England' }),
  c('Sheffield', 'United Kingdom', [], { region: 'England' }),
  c('Nottingham', 'United Kingdom', [], { region: 'England' }),
  c('Edinburgh', 'United Kingdom', [], { region: 'Scotland' }),
  c('Glasgow', 'United Kingdom', [], { region: 'Scotland' }),
  c('Cardiff', 'United Kingdom', [], { region: 'Wales' }),
  c('Belfast', 'United Kingdom', [], { region: 'Northern Ireland' }),
  c('Dublin', 'Ireland', [], {}),
  c('Galway', 'Ireland', [], {}),
  // United States
  c('San Francisco', 'United States', ['sf'], { region: 'California', metro: 'Bay Area' }),
  c('San Jose', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Oakland', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Berkeley', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Palo Alto', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Mountain View', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Sunnyvale', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Santa Clara', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Menlo Park', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Redwood City', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Cupertino', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Fremont', 'United States', [], { region: 'California', metro: 'Bay Area' }),
  c('Los Angeles', 'United States', ['la', 'santa monica'], { region: 'California' }),
  c('San Diego', 'United States', [], { region: 'California' }),
  c('New York', 'United States', ['nyc', 'new york city', 'manhattan', 'brooklyn', 'queens'], { region: 'New York' }),
  c('Jersey City', 'United States', ['hoboken'], { region: 'New Jersey', metro: 'New York' }),
  c('Seattle', 'United States', [], { region: 'Washington' }),
  c('Bellevue', 'United States', ['redmond', 'kirkland'], { region: 'Washington', metro: 'Seattle' }),
  c('Boston', 'United States', [], { region: 'Massachusetts' }),
  c('Cambridge', 'United States', [], { region: 'Massachusetts', metro: 'Boston' }),
  c('Austin', 'United States', [], { region: 'Texas' }),
  c('Dallas', 'United States', ['fort worth'], { region: 'Texas' }),
  c('Houston', 'United States', [], { region: 'Texas' }),
  c('Chicago', 'United States', [], { region: 'Illinois' }),
  c('Washington, D.C.', 'United States', ['washington dc', 'washington d.c.', 'd.c.'], { region: 'District of Columbia' }),
  c('Atlanta', 'United States', [], { region: 'Georgia' }),
  c('Denver', 'United States', ['boulder'], { region: 'Colorado' }),
  c('Miami', 'United States', [], { region: 'Florida' }),
  c('Philadelphia', 'United States', [], { region: 'Pennsylvania' }),
  c('Pittsburgh', 'United States', [], { region: 'Pennsylvania' }),
  c('Phoenix', 'United States', [], { region: 'Arizona' }),
  c('Raleigh', 'United States', ['durham', 'research triangle'], { region: 'North Carolina' }),
  c('Minneapolis', 'United States', [], { region: 'Minnesota' }),
  c('Detroit', 'United States', [], { region: 'Michigan' }),
  c('Portland', 'United States', [], { region: 'Oregon' }),
  c('Salt Lake City', 'United States', [], { region: 'Utah' }),
  // Canada
  c('Toronto', 'Canada', ['mississauga', 'brampton', 'markham', 'gta'], { region: 'Ontario' }),
  c('Waterloo', 'Canada', ['kitchener'], { region: 'Ontario' }),
  c('Ottawa', 'Canada', [], { region: 'Ontario' }),
  c('Vancouver', 'Canada', ['burnaby'], { region: 'British Columbia' }),
  c('Montreal', 'Canada', ['montréal'], { region: 'Quebec' }),
  c('Calgary', 'Canada', [], { region: 'Alberta' }),
  c('Edmonton', 'Canada', [], { region: 'Alberta' }),
  // Benelux
  c('Amsterdam', 'Netherlands', ['amstelveen', 'diemen', 'hoofddorp', 'schiphol'], { region: 'North Holland' }),
  c('Haarlem', 'Netherlands', [], { region: 'North Holland', metro: 'Amsterdam' }),
  c('Zaandam', 'Netherlands', ['zaanstad'], { region: 'North Holland', metro: 'Amsterdam' }),
  c('Almere', 'Netherlands', [], { region: 'Flevoland', metro: 'Amsterdam' }),
  c('Rotterdam', 'Netherlands', [], { region: 'South Holland' }),
  c('The Hague', 'Netherlands', ['den haag', "'s-gravenhage"], { alt: 'Den Haag', region: 'South Holland' }),
  c('Leiden', 'Netherlands', [], { region: 'South Holland' }),
  c('Delft', 'Netherlands', [], { region: 'South Holland' }),
  c('Utrecht', 'Netherlands', [], { region: 'Utrecht' }),
  c('Eindhoven', 'Netherlands', [], { region: 'North Brabant' }),
  c('Groningen', 'Netherlands', [], { region: 'Groningen' }),
  c('Brussels', 'Belgium', ['bruxelles', 'brussel'], {}),
  c('Antwerp', 'Belgium', ['antwerpen'], {}),
  c('Ghent', 'Belgium', ['gent'], {}),
  // Rest of Europe
  c('Paris', 'France', ['île-de-france', 'ile-de-france'], {}),
  c('Lyon', 'France', [], {}),
  c('Toulouse', 'France', [], {}),
  c('Marseille', 'France', [], {}),
  c('Lille', 'France', [], {}),
  c('Bordeaux', 'France', [], {}),
  c('Nantes', 'France', [], {}),
  c('Madrid', 'Spain', [], {}),
  c('Barcelona', 'Spain', [], {}),
  c('Valencia', 'Spain', [], {}),
  c('Seville', 'Spain', ['sevilla'], {}),
  c('Málaga', 'Spain', ['malaga'], {}),
  c('Lisbon', 'Portugal', ['lisboa'], { alt: 'Lisboa' }),
  c('Porto', 'Portugal', ['oporto'], {}),
  c('Milan', 'Italy', ['milano'], { alt: 'Milano' }),
  c('Rome', 'Italy', ['roma'], { alt: 'Roma' }),
  c('Turin', 'Italy', ['torino'], { alt: 'Torino' }),
  c('Bologna', 'Italy', [], {}),
  c('Stockholm', 'Sweden', [], {}),
  c('Gothenburg', 'Sweden', ['göteborg', 'goteborg'], {}),
  c('Malmö', 'Sweden', ['malmo'], {}),
  c('Oslo', 'Norway', [], {}),
  c('Copenhagen', 'Denmark', ['københavn', 'kobenhavn'], {}),
  c('Aarhus', 'Denmark', [], {}),
  c('Helsinki', 'Finland', ['espoo'], {}),
  c('Warsaw', 'Poland', ['warszawa'], {}),
  c('Kraków', 'Poland', ['krakow', 'cracow'], {}),
  c('Wrocław', 'Poland', ['wroclaw'], {}),
  c('Gdańsk', 'Poland', ['gdansk'], {}),
  c('Prague', 'Czech Republic', ['praha'], {}),
  c('Brno', 'Czech Republic', [], {}),
  c('Budapest', 'Hungary', [], {}),
  c('Bucharest', 'Romania', ['bucurești', 'bucuresti'], {}),
  c('Cluj-Napoca', 'Romania', ['cluj'], {}),
  c('Athens', 'Greece', [], {}),
  c('Tallinn', 'Estonia', [], {}),
  c('Vilnius', 'Lithuania', [], {}),
  c('Kyiv', 'Ukraine', ['kiev'], {}),
  c('Istanbul', 'Turkey', ['i̇stanbul'], {}),
  c('Ankara', 'Turkey', [], {}),
  // Middle East / Africa
  c('Dubai', 'United Arab Emirates', ['sharjah'], {}),
  c('Abu Dhabi', 'United Arab Emirates', [], {}),
  c('Riyadh', 'Saudi Arabia', [], {}),
  c('Jeddah', 'Saudi Arabia', [], {}),
  c('Doha', 'Qatar', [], {}),
  c('Tel Aviv', 'Israel', ['tel aviv-yafo', 'tel-aviv'], {}),
  c('Cairo', 'Egypt', [], {}),
  c('Lagos', 'Nigeria', [], {}),
  c('Nairobi', 'Kenya', [], {}),
  c('Cape Town', 'South Africa', [], {}),
  c('Johannesburg', 'South Africa', ['joburg', 'sandton'], {}),
  // Asia-Pacific
  c('Singapore', 'Singapore', [], {}),
  c('Kuala Lumpur', 'Malaysia', ['kl', 'petaling jaya'], {}),
  c('Jakarta', 'Indonesia', [], {}),
  c('Manila', 'Philippines', ['metro manila', 'makati', 'taguig', 'pasig', 'quezon city'], {}),
  c('Cebu', 'Philippines', ['cebu city'], {}),
  c('Bangkok', 'Thailand', [], {}),
  c('Ho Chi Minh City', 'Vietnam', ['ho chi minh', 'saigon', 'hcmc'], {}),
  c('Hanoi', 'Vietnam', ['ha noi'], {}),
  c('Hong Kong', 'Hong Kong', [], {}),
  c('Shanghai', 'China', [], {}),
  c('Beijing', 'China', [], {}),
  c('Shenzhen', 'China', [], {}),
  c('Taipei', 'Taiwan', [], {}),
  c('Seoul', 'South Korea', [], {}),
  c('Tokyo', 'Japan', [], {}),
  c('Osaka', 'Japan', [], {}),
  c('Sydney', 'Australia', [], { region: 'New South Wales' }),
  c('Melbourne', 'Australia', [], { region: 'Victoria' }),
  c('Brisbane', 'Australia', [], { region: 'Queensland' }),
  c('Perth', 'Australia', [], { region: 'Western Australia' }),
  c('Adelaide', 'Australia', [], { region: 'South Australia' }),
  c('Canberra', 'Australia', [], {}),
  c('Auckland', 'New Zealand', [], {}),
  c('Wellington', 'New Zealand', [], {}),
  // Latin America
  c('São Paulo', 'Brazil', ['sao paulo'], {}),
  c('Rio de Janeiro', 'Brazil', [], {}),
  c('Mexico City', 'Mexico', ['ciudad de méxico', 'ciudad de mexico', 'cdmx'], {}),
  c('Guadalajara', 'Mexico', [], {}),
  c('Monterrey', 'Mexico', [], {}),
  c('Buenos Aires', 'Argentina', [], {}),
  c('Bogotá', 'Colombia', ['bogota'], {}),
  c('Medellín', 'Colombia', ['medellin'], {}),
  c('Santiago', 'Chile', [], {}),
  c('Lima', 'Peru', [], {}),
];

/** Region-level groupings JDs use as a location ("NCR", "Bay Area", "DACH"). */
interface RegionGroup {
  match: RegExp;
  label: string;
  /** City-level group: these cities. */
  cities?: string[];
  /** Country-level group: these countries. */
  countries?: string[];
  /** What a query should carry for this group — the labels profiles actually show. */
  searchTerms: string[];
}

const EUROPE = [
  'Germany', 'Austria', 'Switzerland', 'United Kingdom', 'Netherlands', 'Belgium', 'Luxembourg', 'France', 'Spain', 'Portugal', 'Italy',
  'Ireland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Czech Republic', 'Hungary', 'Romania', 'Greece', 'Estonia', 'Lithuania', 'Ukraine',
];

const REGION_GROUPS: RegionGroup[] = [
  { match: /\b(delhi[\s-]*ncr|ncr|national capital region)\b/i, label: 'Delhi NCR', cities: ['Delhi', 'Gurugram', 'Noida', 'Ghaziabad', 'Faridabad'], searchTerms: ['Delhi', 'Gurugram', 'Noida'] },
  {
    match: /\b(san francisco bay area|sf bay area|bay area|silicon valley)\b/i,
    label: 'Bay Area',
    cities: ['San Francisco', 'San Jose', 'Oakland', 'Berkeley', 'Palo Alto', 'Mountain View', 'Sunnyvale', 'Santa Clara', 'Menlo Park', 'Redwood City', 'Cupertino', 'Fremont'],
    searchTerms: ['San Francisco Bay Area', 'San Francisco', 'San Jose'],
  },
  { match: /\bdach\b/i, label: 'DACH', countries: ['Germany', 'Austria', 'Switzerland'], searchTerms: ['Germany', 'Austria', 'Switzerland'] },
  { match: /\bbenelux\b/i, label: 'Benelux', countries: ['Netherlands', 'Belgium', 'Luxembourg'], searchTerms: ['Netherlands', 'Belgium', 'Luxembourg'] },
  { match: /\b(nordics?|scandinavia)\b/i, label: 'Nordics', countries: ['Sweden', 'Norway', 'Denmark', 'Finland'], searchTerms: [] },
  { match: /\b(gcc|gulf region)\b/i, label: 'Gulf', countries: ['United Arab Emirates', 'Saudi Arabia', 'Qatar'], searchTerms: [] },
  { match: /\b(europe|european union|eu)\b/i, label: 'Europe', countries: EUROPE, searchTerms: [] },
];

/** Remote work. Hybrid is NOT remote: a hybrid role needs someone within commuting distance. */
const REMOTE_RE = /\b(remote|work from home|wfh|distributed|anywhere)\b/i;
/** Work-mode words stripped before reading place names, so "Hybrid" never becomes a town. */
const WORK_MODE_RE = /\b(remote|work from home|wfh|distributed|anywhere|hybrid|on-?site|in[- ]office|wfo)\b/gi;
/** Words that frame a place without being one ("Greater Bengaluru Area"). */
const PLACE_FILLER_RE = /\b(greater|area|metropolitan|metro|region|urban|rural|city of|district|east|west|north|south|central)\b/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLength = (a: string, b: string) => b.length - a.length;

// One alternation over every alias, longest first, so a single scan finds the
// earliest (and at that position longest) place name in a piece of text.
const ALIAS_TO_CITIES = new Map<string, KnownCity[]>();
for (const city of CITIES) for (const a of city.aliases) ALIAS_TO_CITIES.set(a, [...(ALIAS_TO_CITIES.get(a) ?? []), city]);
const CITY_RE = new RegExp(`(?<![\\w-])(${Array.from(ALIAS_TO_CITIES.keys()).sort(byLength).map(escape).join('|')})(?![\\w-])`, 'iu');

const ALIAS_TO_COUNTRY = new Map<string, CountryInfo>();
for (const country of COUNTRIES) for (const a of country.aliases) ALIAS_TO_COUNTRY.set(a, country);
const COUNTRY_RE = new RegExp(`(?<![\\w-])(${Array.from(ALIAS_TO_COUNTRY.keys()).sort(byLength).map(escape).join('|')})(?![\\w-])`, 'iu');

const REGION_NAMES = new Set(CITIES.map((x) => x.region?.toLowerCase()).filter((x): x is string => Boolean(x)));
for (const r of ['noord-holland', 'zuid-holland', 'bayern', 'nordrhein-westfalen', 'hessen', 'baden-wurttemberg', 'kerala', 'punjab', 'texas', 'california']) REGION_NAMES.add(r);

// Free-text scanning (a bio, a snippet) only trusts names that can't be an
// ordinary word or abbreviation: "LA", "SF", "KL", "GTA" and friends are fine
// inside a location field, but in prose they are noise.
const MENTION_EXCLUDED = new Set(['phoenix', 'lima', 'santiago', 'bonn', 'goa', 'durham', 'boulder', 'queens', 'portland', 'cambridge', 'oxford', 'tricity']);
/** One regex that matches any (unambiguous) known city alias — for scanning snippets and JDs. */
export const ANY_CITY_RE = new RegExp(
  `(?<![\\w-])(${Array.from(ALIAS_TO_CITIES.keys())
    .filter((a) => a.length > 3 && !MENTION_EXCLUDED.has(a))
    .sort(byLength)
    .map(escape)
    .join('|')})(?![\\w-])`,
  'iu'
);

export interface ParsedLocation {
  /** What the recruiter (or the profile) wrote. */
  raw: string;
  /** Canonical cities found, in order (a region group expands to its cities). */
  cities: KnownCity[];
  /** Best single country (explicit, else the first city's, else the group's). */
  country: CountryInfo | null;
  /** Every country involved — multi-country groups (DACH) and multi-city roles. */
  countries: CountryInfo[];
  /** True when the text says remote / WFH / distributed (never for "hybrid"). */
  remote: boolean;
  /** Free text that matched no table — kept so an unknown town still becomes a query term. */
  unknown: string[];
  /** The region group named, when there was one ("Delhi NCR"). */
  groupLabel: string;
  /** "Kolkata, India" / "Bengaluru / Hyderabad, India" — what to store. Empty when nothing could be read. */
  display: string;
  /** Country domain for the geo sweep, or '' when unknown. */
  tld: string;
  /**
   * Terms a profile page would carry, primary names first so a tight word
   * budget keeps one name per place: group labels, each city's name, then
   * alternate spellings, then unrecognised towns. Never includes "Remote".
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

const titleCase = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());

export function countryByName(name: string): CountryInfo | null {
  return COUNTRIES.find((x) => x.name === name) ?? null;
}

/** LinkedIn subdomain / SerpAPI gl code → country ('uk' → United Kingdom). */
export function countryByCode(code: string): CountryInfo | null {
  const k = code.trim().toLowerCase();
  return COUNTRIES.find((x) => x.code === k) ?? null;
}

/**
 * Any two-letter country code (as LinkedIn's subdomains use them) → a name,
 * whether or not the country is in the table above: ps → "Palestinian
 * Territories". Comparing codes is what matters; the name is for display.
 */
export function countryRef(code: string): { code: string; name: string } {
  const k = code.trim().toLowerCase();
  const known = countryByCode(k);
  if (known) return { code: k, name: known.name };
  try {
    return { code: k, name: new Intl.DisplayNames(['en'], { type: 'region' }).of(k === 'uk' ? 'GB' : k.toUpperCase()) ?? k.toUpperCase() };
  } catch {
    return { code: k, name: k.toUpperCase() };
  }
}

export function countryOf(city: KnownCity): CountryInfo | null {
  return countryByName(city.country);
}

/** Cities sharing a metro are one labour market. */
export function metroOf(city: KnownCity): string {
  return `${city.metro ?? city.name}|${city.country}`;
}

/** Parses free-text location into cities, countries, remote flag and query terms. */
export function parseLocation(raw: string | null | undefined): ParsedLocation {
  const text = (raw ?? '').trim();
  const empty: ParsedLocation = { raw: text, cities: [], country: null, countries: [], remote: false, unknown: [], groupLabel: '', display: '', tld: '', searchTerms: [] };
  if (!text) return empty;

  const remote = REMOTE_RE.test(text);
  const groupCities: KnownCity[] = [];
  const groupCountries: CountryInfo[] = [];
  const groupTerms: string[] = [];
  let groupLabel = '';
  let rest = text;
  for (const group of REGION_GROUPS) {
    if (!group.match.test(rest)) continue;
    groupLabel = groupLabel || group.label;
    groupTerms.push(...group.searchTerms);
    for (const name of group.cities ?? []) {
      const city = CITIES.find((x) => x.name === name);
      if (city && !groupCities.includes(city)) groupCities.push(city);
    }
    for (const name of group.countries ?? []) {
      const country = countryByName(name);
      if (country && !groupCountries.includes(country)) groupCountries.push(country);
    }
    // The group's own words must not come back as an unknown town ("Ncr").
    rest = rest.replace(new RegExp(group.match.source, 'gi'), ' ');
  }

  // Split on the separators JDs and profiles use for multi-part locations.
  const split = (s: string) =>
    s
      .replace(WORK_MODE_RE, ' ')
      .split(/\s*(?:[\/,|;()·•]|\bor\b|\band\b|&|\+)\s*/i)
      .map((x) => x.trim())
      .filter(Boolean);
  const segments = split(rest);

  // Pass 1 — countries named outright, so a same-name city can be told apart
  // ("Cambridge, Massachusetts, United States" is not Cambridge, England).
  const explicit: CountryInfo[] = [];
  for (const seg of segments) {
    if (CITY_RE.test(seg)) continue; // "Singapore" / "Hong Kong" are cities first
    const m = seg.match(COUNTRY_RE);
    const country = m ? ALIAS_TO_COUNTRY.get(m[1].toLowerCase()) : undefined;
    if (country && !explicit.includes(country)) explicit.push(country);
  }

  // LinkedIn's "City, Region, Country": a middle part is the region, even when
  // it is also a city's name — "Amsterdam, New York, United States" is not New
  // York City, and "New York, New York" names the city once. It's only read
  // that way when it is the first city's own region, or the first part isn't
  // a known city there, so a JD's "Mumbai, Delhi, India" keeps both cities.
  let placeSegments = segments;
  const parts = rest.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 3 && COUNTRY_RE.test(parts[parts.length - 1]) && !CITY_RE.test(parts[parts.length - 1])) {
    const firstHit = parts[0].match(CITY_RE);
    const firstCity = firstHit ? (ALIAS_TO_CITIES.get(firstHit[1].toLowerCase()) ?? []).find((h) => !explicit.length || explicit.some((e) => e.name === h.country)) : undefined;
    const regionAt = new Set<number>();
    parts.forEach((part, i) => {
      const k = part.toLowerCase();
      if (i > 0 && i < parts.length - 1 && REGION_NAMES.has(k) && (!firstCity || firstCity.region?.toLowerCase() === k)) regionAt.add(i);
    });
    if (regionAt.size) placeSegments = split(parts.filter((_, i) => !regionAt.has(i)).join(', '));
  }

  // Pass 2 — cities, regions and whatever is left.
  const named: KnownCity[] = [];
  const unknown: string[] = [];
  for (const seg of placeSegments) {
    const m = seg.match(CITY_RE);
    if (m) {
      const hits = ALIAS_TO_CITIES.get(m[1].toLowerCase()) ?? [];
      const inCountry = explicit.length ? hits.find((h) => explicit.some((e) => e.name === h.country)) : hits[0];
      if (inCountry) {
        if (!named.includes(inCountry) && !groupCities.includes(inCountry)) named.push(inCountry);
        continue;
      }
      // A known name in a country it doesn't exist in (Amsterdam, New York):
      // a different place that happens to share the name.
      unknown.push(titleCase(seg));
      continue;
    }
    if (COUNTRY_RE.test(seg)) continue;
    const bare = seg.toLowerCase().replace(PLACE_FILLER_RE, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!bare || REGION_NAMES.has(seg.toLowerCase()) || REGION_NAMES.has(bare)) continue;
    if (seg.length >= 3 && seg.length <= 40 && !/\d/.test(seg)) unknown.push(titleCase(seg));
  }

  const cities = [...groupCities, ...named];
  const countries: CountryInfo[] = [];
  for (const x of [...explicit, ...cities.map(countryOf), ...groupCountries]) if (x && !countries.includes(x)) countries.push(x);
  const country = explicit[0] ?? (cities[0] ? countryOf(cities[0]) : null) ?? groupCountries[0] ?? null;

  const searchTerms = uniqCI([
    ...groupTerms,
    ...named.map((x) => x.name),
    ...named.map((x) => x.alt ?? ''),
    ...unknown,
  ]).slice(0, 4);

  const labels = uniqCI([groupLabel, ...named.map((x) => x.name), ...unknown]).slice(0, 3);
  let display = labels.join(' / ');
  if (display && countries.length === 1 && display.toLowerCase() !== countries[0].name.toLowerCase()) display = `${display}, ${countries[0].name}`;
  if (!display && countries.length) display = countries.map((x) => x.name).join(' / ');
  if (!display && remote) display = 'Remote';

  return { raw: text, cities, country, countries, remote, unknown, groupLabel, display, tld: country?.tld ?? '', searchTerms };
}

/** First (unambiguous) known city mentioned anywhere in a body of text, or null. */
export function detectCityInText(text: string): KnownCity | null {
  const m = text.match(ANY_CITY_RE);
  if (!m) return null;
  return ALIAS_TO_CITIES.get(m[1].toLowerCase())?.[0] ?? null;
}

/** "Bengaluru, India" for display. */
export function cityDisplay(city: KnownCity): string {
  return [city.name, city.country].join(', ');
}

/** Do two location strings refer to the same city or metro (any alias)? */
export function sameCity(a: string, b: string): boolean {
  const ca = parseLocation(a).cities;
  const cb = parseLocation(b).cities;
  if (ca.length && cb.length) return ca.some((x) => cb.some((y) => metroOf(x) === metroOf(y)));
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Every country name (not alias), longest first — for scanning prose where "us" or "uk" would be noise. */
export const COUNTRY_NAME_RE = new RegExp(`(?<![\\w-])(${COUNTRIES.map((x) => x.name).sort(byLength).map(escape).join('|')})(?![\\w-])`, 'i');

export type PlaceLookup = { kind: 'city'; city: KnownCity } | { kind: 'country'; country: CountryInfo } | { kind: 'region' } | { kind: 'remote' } | null;

/**
 * Is this WHOLE phrase a place (not just a phrase containing one)? Used on
 * single query terms, where "Bangalore Tech Labs" must stay a company and
 * only "Bangalore" or "Greater Bengaluru Area" counts as a location.
 */
export function lookupPlace(phrase: string): PlaceLookup {
  const k = phrase.replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!k) return null;
  if (REMOTE_RE.test(k) && k.replace(WORK_MODE_RE, '').trim() === '') return { kind: 'remote' };
  const bare = k.replace(PLACE_FILLER_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  for (const key of [k, bare]) {
    const city = ALIAS_TO_CITIES.get(key)?.[0];
    if (city) return { kind: 'city', city };
    const country = ALIAS_TO_COUNTRY.get(key);
    if (country) return { kind: 'country', country };
  }
  if (REGION_NAMES.has(k) || REGION_NAMES.has(bare)) return { kind: 'region' };
  for (const group of REGION_GROUPS) if (group.match.test(k) && k.replace(new RegExp(group.match.source, 'gi'), '').trim() === '') return { kind: 'region' };
  return null;
}

// Anything that reads like a role, an employer or a sentence rather than a
// place. A snippet's leading segment only counts as the person's location
// when none of these appear in it.
const NOT_A_PLACE_RE =
  /\b(engineer|developer|designer|manager|lead|head|consultant|founder|co-founder|ceo|cto|cfo|coo|vp|director|intern|student|analyst|specialist|architect|scientist|recruiter|officer|executive|associate|freelancer?|at|for|with|of the|years?|experience|skills?|tags?|profile|followers?|connections?)\b/i;

/** Does this short string read as a place and nothing else ("Bengaluru, Karnataka, India", "Amsterdam Area")? */
export function isLocationShaped(s: string): boolean {
  const t = (s || '').trim();
  if (!t || t.length > 70 || /[:@#]|\d/.test(t) || NOT_A_PLACE_RE.test(t)) return false;
  if (t.split(/\s*,\s*/).some((seg) => seg.split(/\s+/).length > 4)) return false;
  const p = parseLocation(t);
  return p.cities.length > 0 || p.countries.length > 0;
}

/**
 * Does a JD's text offer remote work? Explicit phrasings only, and not when
 * negated ("no remote", "not remote"). Bare "remote" in prose ("remote
 * monitoring", "remote teams") and "hybrid" do not count.
 */
export function jdOffersRemote(text: string): boolean {
  const re =
    /\b(fully[\s-]remote|100%\s*remote|remote[\s-](?:first|friendly|eligible|ok|okay|role|position|job|opportunity|company|culture)|work(?:ing)?\s+remotely|work\s+from\s+(?:home|anywhere)|wfh|distributed\s+team|location\s*:\s*remote|remote\s*\([^)]{2,30}\))/gi;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
    if (!/\b(no|not|non|isn'?t|cannot|can'?t|never)\b[^.]*$/i.test(before)) return true;
  }
  return false;
}
