// Match-score tiers. Colours follow the Vercel palette: the positive tier is
// link blue (Vercel maps "success" to its blue), the middle tier is ink, the
// low tier is the faint grey. No green / amber / coral anywhere in the app.
export type Tier = 'strong' | 'potential' | 'low';

export function scoreTier(score: number): Tier {
  if (score >= 70) return 'strong';
  if (score >= 40) return 'potential';
  return 'low';
}

export const TIER_LABEL: Record<Tier, string> = { strong: 'Strong', potential: 'Potential', low: 'Low' };
export const TIER_BG: Record<Tier, string> = { strong: 'bg-link', potential: 'bg-ink', low: 'bg-faint' };
export const TIER_TEXT: Record<Tier, string> = { strong: 'text-link', potential: 'text-ink', low: 'text-mute' };
