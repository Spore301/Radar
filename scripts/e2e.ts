/* End-to-end check of the revamped UI against the real backend.
 *
 * 1. Seeds a QA user + Auth.js database session in prisma/dev.db.
 * 2. Drives the production server (port 3100) with Playwright using that
 *    session cookie: sidebar, history panel, demo session, constraints,
 *    query modal, streamed run (fallback engine — expected to index 0), then
 *    seeds fixture candidates through the repository and verifies cards,
 *    shortlist persistence, drawer save, pipeline, templates, settings.
 * 3. Cleans up everything it created.
 */
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { initDb, prisma } from '../src/lib/db/client';
import * as repo from '../src/lib/db/sessions';
import { setProviderKey } from '../src/lib/credentials';
import { indexSerpResult } from '../src/lib/search/serpIndexer';
import type { XRaySearchResult } from '../src/lib/search/x-raySearchService';

// Match the server's environment (AUTH_SECRET seals credentials; DATABASE_URL points at the dev db).
try {
  for (const line of require('node:fs').readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
} catch {
  // no .env.local — fine for CI where env is injected
}
const BASE = process.env.E2E_BASE ?? 'http://localhost:3100';
const SHOTS = path.resolve(__dirname, '.e2e-shots');
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = `file:${path.resolve(__dirname, '../prisma/dev.db')}`;
const TOKEN = `qa-e2e-${Date.now()}`;

const results: Array<{ name: string; ok: boolean; note?: string }> = [];
const check = (name: string, ok: boolean, note?: string) => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

(async () => {
  await initDb();
  const fs = await import('node:fs');
  fs.mkdirSync(SHOTS, { recursive: true });

  // --- fixture: user + session -------------------------------------------
  const user = await prisma.user.upsert({
    where: { email: 'qa-e2e@houseofedtech.in' },
    create: { email: 'qa-e2e@houseofedtech.in', name: 'QA Runner', company: 'QA Org', onboardedAt: new Date() },
    update: { name: 'QA Runner', company: 'QA Org', onboardedAt: new Date() },
  });
  await prisma.session.create({ data: { sessionToken: TOKEN, userId: user.id, expires: new Date(Date.now() + 3600_000) } });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'authjs.session-token', value: TOKEN, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  let createdSessionId: string | null = null;

  try {
    // --- unauthenticated redirect ------------------------------------------
    const anon = await browser.newContext();
    const anonPage = await anon.newPage();
    const landing = await anonPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    check('landing page at / for anonymous visitors', landing?.status() === 200 && (await anonPage.getByRole('link', { name: /Continue with Google/ }).count()) === 1, anonPage.url());
    await anonPage.screenshot({ path: `${SHOTS}/00-landing.png` });
    const resp = await anonPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    check('unauthenticated /dashboard redirects to /signin', anonPage.url().includes('/signin'), `${resp?.status()} → ${anonPage.url()}`);
    const health = await anon.request.get(`${BASE}/api/health`);
    check('/api/health reports ok', health.ok() && (await health.json()).ok === true, `status ${health.status()}`);
    const apiAnon = await anon.request.get(`${BASE}/api/sessions`);
    check('unauthenticated /api/sessions is 401', apiAnon.status() === 401, `status ${apiAnon.status()}`);
    await anon.close();

    // --- dashboard shell ---------------------------------------------------
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    check('signed-in visitor at / lands on /dashboard', page.url() === `${BASE}/dashboard`, page.url());
    check('sidebar shows the organisation from onboarding', await page.getByText('QA Org').first().isVisible());
    check('sidebar brand visible', await page.getByText('CandidateRadar', { exact: true }).first().isVisible());
    check('no announcement bar / footer marketing', (await page.getByText(/SaaS v1\.0|Grounded AI|Ethical Sourcing/i).count()) === 0);
    check('user shown in sidebar', await page.getByText('QA Runner').first().isVisible());
    check('agent entry in sidebar', (await page.getByRole('link', { name: 'Agent' }).count()) === 1);
    const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    check('Geist font applied to body', /Geist/i.test(fontFamily), fontFamily.slice(0, 60));
    await shot(page, '01-dashboard-new');

    // --- history panel -----------------------------------------------------
    await page.getByRole('button', { name: /^History/ }).click();
    const panel = page.locator('#history-panel');
    await panel.waitFor({ state: 'visible' });
    check('history panel opens beside the sidebar', await panel.isVisible());
    await page.waitForTimeout(400); // let the 150ms slide-in settle before measuring
    const box = await panel.boundingBox();
    check('history panel positioned right of the 232px sidebar', !!box && Math.round(box.x) === 232, `x=${box?.x}`);
    await shot(page, '02-history-open');
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    check('Escape closes the history panel', (await panel.count()) === 0);

    // --- demo session ------------------------------------------------------
    await page.getByRole('button', { name: 'Load demo role' }).click();
    await page.waitForURL(/\?session=/, { timeout: 15000 });
    createdSessionId = new URL(page.url()).searchParams.get('session');
    check('demo role creates a stored session and lands on it', !!createdSessionId, createdSessionId ?? undefined);
    await page.getByText('Search constraints').waitFor();
    check('constraints step shown after session creation', await page.getByText('Search constraints').isVisible());
    const platformTiles = await page.getByRole('button', { name: /types?$/ }).count();
    check('9 platform tiles rendered', platformTiles === 9, `${platformTiles} tiles`);
    await shot(page, '03-constraints');

    // --- generate queries ----------------------------------------------------
    await page.getByRole('button', { name: /^Generate \d+ quer/ }).click();
    await page.getByRole('dialog', { name: /quer(y|ies) · each searched individually/ }).waitFor({ timeout: 60000 });
    const rows = await page.locator('[role="dialog"] [data-query-row]').count();
    check('query rows render the whole query as pills (no clipped textarea)', (await page.locator('[role="dialog"] [data-query-row] textarea').count()) === 0 && (await page.locator('[role="dialog"] [data-query-row] [title="Operator"]').count()) >= rows);
    check('query modal shows one editable row per approved query', rows >= 8 && rows <= 16, `${rows} rows`);
    check('query modal has depth control', await page.getByText('Depth').isVisible());
    await shot(page, '04-query-modal');

    // --- editor: text box + coloured syntax chips ---------------------------------------
    const dialog = page.getByRole('dialog', { name: /quer(y|ies) · each searched individually/ });
    const firstRow = dialog.locator('[data-query-row]').first();
    await firstRow.getByRole('button', { name: 'Edit' }).click();
    const editor = dialog.getByLabel('Query editor');
    await editor.waitFor({ timeout: 5000 });
    check('editor is a text box with a syntax-only palette', (await dialog.locator('[data-palette-chip]').count()) >= 12 && (await dialog.getByText('Titles from this session').count()) === 0);
    const before = await editor.inputValue();
    await editor.focus();
    await editor.press('End');
    await dialog.locator('[data-palette-chip]').filter({ hasText: 'AROUND(5)' }).first().click();
    const afterClick = await editor.inputValue();
    check('clicking a chip inserts its syntax into the text box', afterClick.includes('AROUND(5)') && afterClick.length > before.length, afterClick.slice(-30));
    await editor.press('End');
    await editor.type(' -"agency"');
    check('typing in the box updates the coloured pills', (await firstRow.locator('[data-family="exclude"]').count()) >= 1 && (await firstRow.locator('[data-family="proximity"]').count()) >= 1);
    const families = new Set(await firstRow.locator('[data-family]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.family)));
    check('distinct colour families rendered', families.size >= 4, Array.from(families).join(','));
    await firstRow.getByRole('button', { name: 'Done' }).click();
    check('done returns to pill view with edited badge', (await firstRow.getByText('edited').count()) === 1);
    await dialog.getByRole('button', { name: 'Custom query' }).click();
    check('custom query adds a row in the editor', (await dialog.locator('[data-query-row]').count()) === rows + 1 && (await dialog.getByLabel('Query editor').count()) === 1);
    await dialog.locator('[data-query-row]').last().getByRole('button', { name: 'Remove query' }).click();

    // --- no SerpAPI key: the run is refused up front, not silently empty -----------
    await page.getByRole('dialog').getByRole('button', { name: /^Run \d+ quer/ }).click();
    await page.getByText(/No SerpAPI key on file/).first().waitFor({ timeout: 10000 });
    check('run without a SerpAPI key is refused with a clear message', await page.getByText(/No SerpAPI key on file/).first().isVisible());

    // --- with a key on file (deliberately invalid): the run proceeds and the receipt explains -----
    await setProviderKey(user.id, 'serpapi', 'qa-invalid-serpapi-key-000000');
    await page.getByRole('button', { name: /Review \d+ queries|Re-run queries/ }).click();
    await page.getByRole('dialog', { name: /quer(y|ies) · each searched individually/ }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: /^Run \d+ quer/ }).click();
    const overlay = page.getByRole('dialog', { name: /Running \d+ X-Ray/ });
    await overlay.waitFor({ timeout: 10000 });
    check('processing overlay appears with per-query rows', (await overlay.getByText(/queued|searching…/).count()) > 0);
    await shot(page, '05-overlay');
    await overlay.waitFor({ state: 'detached', timeout: 180000 });
    await page.getByText(/Query run receipt/).waitFor({ timeout: 10000 });
    check('run finishes and shows the receipt', await page.getByText(/Query run receipt/).isVisible());
    const statusText = await page.locator('[role="status"]').innerText();
    check('status bar reports run outcome', /Run complete/.test(statusText), statusText.split('\n').pop());
    await page.getByText(/Query run receipt/).click();
    check('receipt explains the SerpAPI failure per query', (await page.getByText(/Invalid API key|SerpAPI/i).count()) >= 1);
    await page.getByText(/Query run receipt/).click();
    await page.getByText(/Query run receipt/).click();
    const receiptRows = await page.locator('table tbody tr').count();
    check('receipt has one row per query', receiptRows === rows, `${receiptRows} rows`);
    await shot(page, '06-results-empty');

    // --- seed fixture candidates via the repository (fallback engine indexes 0) ---
    const detail = await repo.getSession(createdSessionId!);
    const q = detail!.job.query_bundle[0];
    const c = detail!.job.merged_constraints;
    const mk = (title: string, url: string, snippet: string) => indexSerpResult({ title, url, snippet }, q, c, createdSessionId!)!;
    const fixture: XRaySearchResult = {
      candidates: [
        mk('Priya Nair - Senior Product Designer - Acme | LinkedIn', 'https://in.linkedin.com/in/priya-nair-qa', 'Bengaluru, Karnataka, India · Senior Product Designer · Figma design systems, user research, prototyping'),
        mk('Rahul Verma - Product Designer | LinkedIn', 'https://www.linkedin.com/in/rahulv-qa', 'Mumbai, Maharashtra, India · Product Designer · Figma'),
        mk('Anita Rao on Behance', 'https://www.behance.net/anitarao-qa', 'UX Designer · Pune · Prototyping'),
      ],
      stats: { total: 3, deduplicated: 3, strong: 1, potential: 1, low: 1, queriesRun: 1, queriesFailed: 0, creditsUsed: 2 },
      queryResults: [{ queryId: q.id, platform: q.platform, queryType: q.query_type, queryString: q.query_string, status: 'completed', provider: 'serpapi', resultCount: 3, indexedCount: 3, pagesFetched: 2, creditsUsed: 2 }],
    };
    await repo.recordSearchRun(createdSessionId!, user.id, fixture, 50);

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Priya Nair').first().waitFor({ timeout: 15000 });
    const cards = await page.getByRole('button', { name: 'Shortlist' }).count();
    check('reopened session renders stored candidates as cards', cards === 3, `${cards} cards`);
    check('score distribution + platform charts render', (await page.getByText(/Score distribution/).count()) === 1 && (await page.getByText(/Profiles per platform/).count()) === 1);
    await shot(page, '07-results');

    // --- shortlist persists ----------------------------------------------------
    const priyaCard = page.locator('.card', { hasText: 'Priya Nair' }).first();
    const patchDone = page.waitForResponse((r) => r.url().includes('/api/candidates/') && r.request().method() === 'PATCH');
    await priyaCard.getByRole('button', { name: 'Shortlist' }).click();
    await priyaCard.getByText('Shortlisted').waitFor({ timeout: 10000 });
    const patchResp = await patchDone;
    check('shortlist PATCH returns 200', patchResp.ok(), `status ${patchResp.status()}`);
    const stored = await prisma.candidate.findFirst({ where: { jobId: createdSessionId!, name: 'Priya Nair' } });
    check('shortlist writes to the database', stored?.status === 'Shortlisted', `db status=${stored?.status}`);

    // --- drawer save -----------------------------------------------------------
    await priyaCard.getByRole('button', { name: 'Priya Nair' }).click();
    const drawer = page.getByRole('dialog', { name: 'Priya Nair' });
    await drawer.waitFor();
    await drawer.getByPlaceholder('Private recruiter notes').fill('Strong design-systems portfolio');
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await drawer.getByText('Saved to the session').waitFor({ timeout: 10000 });
    const withNotes = await prisma.candidate.findFirst({ where: { jobId: createdSessionId!, name: 'Priya Nair' } });
    check('drawer notes persist to the database', withNotes?.notes === 'Strong design-systems portfolio', withNotes?.notes ?? undefined);
    await shot(page, '08-drawer');
    await page.keyboard.press('Escape');

    // --- filters: platform pill -------------------------------------------------
    await page.getByRole('button', { name: /^Behance/ }).click();
    const behanceCards = await page.getByRole('button', { name: 'Shortlist' }).count();
    check('platform filter narrows the grid', behanceCards === 1, `${behanceCards} cards after Behance filter`);
    await page.getByRole('button', { name: /^All/ }).click();

    // --- history shows the session with counts --------------------------------
    await page.getByRole('button', { name: /^History/ }).click();
    await panel.waitFor({ state: 'visible' });
    const row = panel.getByText(/Senior Product Designer · Demo/).first();
    await row.waitFor({ timeout: 10000 }).catch(() => {});
    check('history lists the demo session', await row.isVisible(), (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 160));
    check('history row shows profile + shortlist counts', (await panel.getByText(/3 profiles · 1 shortlisted/).count()) >= 1);
    await shot(page, '09-history-with-session');
    await page.keyboard.press('Escape');

    // --- pipeline ----------------------------------------------------------------
    await page.goto(`${BASE}/dashboard/pipeline`, { waitUntil: 'networkidle' });
    await page.getByText('Outreach pipeline').waitFor();
    check('pipeline board lists shortlisted candidate', await page.locator('article', { hasText: 'Priya Nair' }).first().isVisible());
    await shot(page, '10-pipeline-board');
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.getByRole('button', { name: 'Export CSV' }).waitFor();
    check('pipeline table view renders with export', true);
    await shot(page, '11-pipeline-table');

    // --- templates + settings ----------------------------------------------------
    await page.goto(`${BASE}/dashboard/templates`, { waitUntil: 'networkidle' });
    check('templates page renders', await page.getByText('Message templates').isVisible());
    await shot(page, '12-templates');
    await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle' });
    check('settings page renders', await page.getByRole('heading', { name: 'Account' }).isVisible());
    check('settings shows SerpAPI key section', await page.getByRole('heading', { name: 'SerpAPI key' }).isVisible());
    await shot(page, '13-settings');

    // --- onboarding: a new user is sent to /onboarding and completes it ---------------------
    const fresh = await prisma.user.create({ data: { email: `qa-fresh-${Date.now()}@houseofedtech.in`, name: null } });
    const freshToken = `qa-fresh-${Date.now()}`;
    await prisma.session.create({ data: { sessionToken: freshToken, userId: fresh.id, expires: new Date(Date.now() + 3600_000) } });
    const freshCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await freshCtx.addCookies([{ name: 'authjs.session-token', value: freshToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const fp = await freshCtx.newPage();
    await fp.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    check('not-yet-onboarded user is redirected to /onboarding', fp.url().includes('/onboarding'), fp.url());
    await fp.getByPlaceholder('Priya Sharma').fill('Fresh Recruiter');
    await fp.getByRole('button', { name: /Continue/ }).click();
    await fp.getByPlaceholder('House of EdTech').fill('Fresh Org');
    await fp.getByRole('button', { name: /Continue/ }).click();
    await fp.getByRole('button', { name: /Skip for now/ }).click();
    await fp.waitForURL(/\/dashboard$/, { timeout: 15000 });
    const freshRow = await prisma.user.findUnique({ where: { id: fresh.id } });
    check('onboarding stores name, company and completion', freshRow?.name === 'Fresh Recruiter' && freshRow?.company === 'Fresh Org' && Boolean(freshRow?.onboardedAt));
    await fp.screenshot({ path: `${SHOTS}/14-onboarded.png` });
    await freshCtx.close();
    await prisma.session.deleteMany({ where: { userId: fresh.id } });
    await prisma.user.delete({ where: { id: fresh.id } }).catch(() => {});

    // --- agent view -----------------------------------------------------------------------
    await page.goto(`${BASE}/dashboard/agent`, { waitUntil: 'networkidle' });
    check('agent page is full-height with the scope panel on the right', await page.getByText('Describe the role, or attach the JD.').isVisible() && await page.getByText('Scope so far').isVisible());
    await page.getByLabel('Message the agent').fill('Hiring a Senior React developer in Pune, must have TypeScript');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Reasoning · \d+ steps/).first().waitFor({ timeout: 120000 });
    check('agent replies with a visible reasoning trace', (await page.getByText(/Reasoning · \d+ steps/).count()) >= 1);
    check('reasoning opens with the search-budget guardrail', (await page.getByText(/Search budget:/).count()) >= 1);
    check('agent extracted constraints into the scope panel', await page.getByText('Pune', { exact: false }).first().isVisible());
    check('agent does NOT build queries on a partial brief', (await page.getByRole('button', { name: /Review \d+ queries/ }).count()) === 0);
    check('agent is gathering or scoping, not ready', (await page.getByText(/Gathering required scope|Completing the scope|Awaiting your go-ahead/).count()) >= 1);
    const agentSessionId = new URL(page.url()).searchParams.get('session');
    check('agent turn created a stored session', Boolean(agentSessionId), agentSessionId ?? undefined);
    await shot(page, '15-agent');
    if (agentSessionId) await prisma.job.delete({ where: { id: agentSessionId } }).catch(() => {});

    // --- API contract with session cookie -------------------------------------------
    const apiSessions = await context.request.get(`${BASE}/api/sessions`);
    const body = await apiSessions.json();
    check('/api/sessions returns the stored session', apiSessions.ok() && body.sessions.some((s: any) => s.id === createdSessionId));
    const apiCands = await context.request.get(`${BASE}/api/candidates?jobId=${createdSessionId}&status=Shortlisted`);
    const cbody = await apiCands.json();
    check('/api/candidates filters by session + status', apiCands.ok() && cbody.candidates.length === 1 && cbody.candidates[0].name === 'Priya Nair');

    // --- console errors -----------------------------------------------------------------
    // The deliberate 400 from running without a SerpAPI key is logged by the browser as a failed resource load.
    const realErrors = consoleErrors.filter((e) => !/favicon|hydration|Download the React DevTools|status of 400/i.test(e));
    check('no browser console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  } catch (err: any) {
    check('script completed without exception', false, err?.message);
    await shot(page, '99-failure');
  } finally {
    await browser.close();
    if (createdSessionId) await prisma.job.delete({ where: { id: createdSessionId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { sessionToken: TOKEN } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  }
})();
