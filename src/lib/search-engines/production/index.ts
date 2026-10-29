import { searchWithSerpApi } from './serpapi';
import type { SearchEngineModule } from '../types';

// ---------------------------------------------------------------------------
// Production engine — what RADR. ships with. Google results through SerpAPI,
// one page (10 organic results) = one SerpAPI credit, paged to the run's
// configured depth. This is the engine every recruiter uses unless
// SEARCH_PROVIDER picks something else in src/lib/search/serp.ts.
//
// Retries live here, not in the caller: a 429 or a dropped connection is this
// engine's own transient failure, and how it recovers from one is this
// engine's policy, not the orchestrator's.
// ---------------------------------------------------------------------------

export const productionEngine: SearchEngineModule = {
  id: 'production',
  label: 'SerpAPI (production)',
  status: 'production',
  requiresApiKey: true,
  description:
    'The engine RADR. ships with. Runs the X-Ray query against Google through SerpAPI, paged to the run\'s depth. Needs the user\'s own (or a platform fallback) SerpAPI key; one page of 10 results costs one credit.',

  async run(query, keys, options) {
    const apiKey = keys.serpapi?.trim();
    if (!apiKey) throw new Error('No SerpAPI key configured.');

    const messages: string[] = [];
    // Up to three attempts: SerpAPI's per-second rate limit and the occasional
    // upstream timeout are transient, and a query that fails here otherwise
    // silently contributes nothing to the run.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const paged = await searchWithSerpApi(query, apiKey, options);
        return { provider: 'serpapi', ...paged };
      } catch (err: any) {
        const timedOut = /timeout|aborted/i.test(String(err?.name || err?.message));
        const message = timedOut ? 'SerpAPI did not answer within 55 s' : err?.message || 'SerpAPI failed';
        messages.push(attempt === 0 ? message : `${message} (retry ${attempt})`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 2000 + Math.random() * 1000));
      }
    }
    throw new Error(messages.join('; '));
  },
};
