// Standalone demonstration/probe for this POC — the thing that makes this
// folder a complete POC rather than just an engine file: you can run this on
// its own and see real results, without the rest of the app.
// Runs real generated bundles through searchOneQuery() → headless Bing (./engine.ts)
// → the indexer, and reports results, profiles and blocks per query. It scrapes
// Bing's result pages, which is against Bing's terms of service — run it
// sparingly, by hand, from your own machine:
//   PLAYWRIGHT_CHANNEL=msedge npm run test:poc:free-browser
// (~25 queries × up to 2 pages each, serialised with human pacing: roughly 3–5 minutes.)
process.env.SEARCH_PROVIDER = 'browser';
process.env.PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
const R = '../../src/lib/';
const { searchOneQuery } = require(R + 'search/x-raySearchService');
const { generateQueryBundleForConstraints } = require(R + 'ai/client');
const { closeBrowserSearch, toBingQuery } = require('./engine');
const { deduplicateCandidates } = require(R + 'utils/deduplication');

const base = { years_of_experience: { min: 0, max: 10 }, remote_eligible: false, nice_to_have_skills: [], domain: [], education: '', additional_details: '', results_cap: 50 };
const REQS = [
  { ...base, job_title: 'Senior Backend Engineer', role_type: 'Engineering', seniority: 'Senior', location: 'Bengaluru, India', must_have_skills: ['Golang', 'Kubernetes'], selected_platforms: ['LinkedIn', 'GitHub', 'StackOverflow'], gl: 'in' },
  { ...base, job_title: 'Product Designer', role_type: 'Design', seniority: 'Mid', location: 'Pune, India', must_have_skills: ['Figma', 'Design Systems'], selected_platforms: ['LinkedIn', 'Behance', 'Dribbble'], gl: 'in' },
  { ...base, job_title: 'Account Executive', role_type: 'Sales', seniority: 'Any', location: 'London, United Kingdom', must_have_skills: ['Salesforce'], domain: ['SaaS'], selected_platforms: ['LinkedIn', 'Resumes'], gl: 'uk' },
];

(async () => {
  const t0 = Date.now();
  let totals = { queries: 0, results: 0, profiles: 0, blocked: 0, pages: 0 };
  for (const req of REQS) {
    const bundle = generateQueryBundleForConstraints(req);
    const pool: any[] = [];
    console.log(`\n### ${req.job_title} · ${req.location} — ${bundle.length} queries`);
    for (const q of bundle) {
      const started = Date.now();
      const { outcome, candidates } = await searchOneQuery(q, req, 'poc', { serpapi: null }, { maxPagesPerQuery: 2, gl: req.gl });
      totals.queries++; totals.results += outcome.resultCount; totals.profiles += candidates.length; totals.pages += outcome.pagesFetched;
      if (outcome.status !== 'completed' || /unavailable|bot check/i.test(outcome.notice ?? outcome.error ?? '')) totals.blocked++;
      pool.push(...candidates);
      console.log(`  [${q.platform}/${q.query_type}] ${outcome.provider} · ${outcome.pagesFetched}p · ${outcome.resultCount} results → ${candidates.length} profiles · ${((Date.now() - started) / 1000).toFixed(1)}s${outcome.error ? ` · ERR ${outcome.error.slice(0, 80)}` : ''}${/unavailable/.test(outcome.notice ?? '') ? ` · ${outcome.notice.slice(0, 80)}` : ''}`);
      if (toBingQuery(q.query_string) !== q.query_string) console.log(`      bing: ${toBingQuery(q.query_string).slice(0, 150)}`);
    }
    const unique = deduplicateCandidates(pool);
    const top = [...unique].sort((a, b) => b.match_score - a.match_score).slice(0, 4);
    console.log(`  → ${unique.length} unique profiles; top: ${top.map((c: any) => `${c.name} (${c.match_score}, ${c.location})`).join(' | ')}`);
  }
  console.log(`\nTOTAL ${totals.queries} queries · ${totals.pages} pages · ${totals.results} results · ${totals.profiles} profiles · ${totals.blocked} blocked/fallback · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await closeBrowserSearch();
})();
