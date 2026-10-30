import { parseLocation } from './location';

// ---------------------------------------------------------------------------
// A JD's headline is often the ad, not the title: "Lead Product Designer,
// Bangalore (Hybrid)", "Senior Engineer | Remote - India", "Product Manager @
// Acme (Full-time)". Quoted as an exact phrase, that string matches other job
// ads and recruiters' hiring posts — never a person's profile, whose headline
// says "Lead Product Designer". So only the role itself may become a search
// term: places, work mode, employment type, placeholders and the employer go.
// ---------------------------------------------------------------------------

const ROLE_WORD_RE =
  /\b(engineer|developer|programmer|designer|manager|consultant|analyst|associate|executive|lead|head|director|officer|president|vp|specialist|architect|scientist|researcher|marketer|strategist|recruiter|representative|coordinator|administrator|accountant|writer|editor|tester|technician|intern|partner|founder|sde|sre|devops|qa)s?\b/i;

const FURNITURE_RE =
  /\b(hybrid|remote|on[\s-]?site|in[\s-]?office|wfh|wfo|work\s+from\s+(?:home|office|anywhere)|full[\s-]?time|part[\s-]?time|contract(?:ual)?|freelance|permanent|temporary|fixed[\s-]?term|immediate(?:\s+joiners?)?|urgent(?:ly)?|hiring|[mfwdh]\/[mfwdh](?:\/[mfwdh])?|all\s+genders|\d+\s*(?:[-–]\s*\d+|\+)?\s*(?:yrs?|years?))\b/gi;

/** Is this part of a headline only ad furniture — a place, a work mode, an employment type? */
function isFurniture(segment: string): boolean {
  const rest = segment.replace(FURNITURE_RE, ' ').replace(/[^A-Za-z0-9À-ɏ]+/g, ' ').trim();
  if (!rest) return true;
  if (ROLE_WORD_RE.test(rest)) return false;
  const p = parseLocation(rest);
  return p.cities.length > 0 || p.country !== null;
}

/** "Lead Product Designer, Bangalore (Hybrid)" → "Lead Product Designer". Unchanged when there's nothing to drop. */
export function cleanJobTitle(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const segments = text
    .replace(/\[[^\]]*\]/g, ' ') // "[Company Name]" placeholders
    .replace(/\(([^)]*)\)/g, (whole, inner: string) => (isFurniture(inner) ? ' ' : whole))
    .replace(/\s+(?:@\s*|at\s+).*$/i, '') // "… at Acme" / "… @Acme" names the employer
    .split(/\s*[,|·•;–—]\s*|\s+-\s+|\s*:\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = segments.filter((s) => !isFurniture(s));
  const best = kept.find((s) => ROLE_WORD_RE.test(s)) ?? kept[0];
  return (best ?? text).slice(0, 80);
}
