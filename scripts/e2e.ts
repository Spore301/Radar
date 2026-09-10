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
    check(
      'landing page at / for anonymous visitors',
      landing?.status() === 200 && (await anonPage.getByRole('link', { name: /Find Your Next Hire/ }).count()) >= 1,
      anonPage.url(),
    );
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
    check('sidebar brand visible', await page.getByRole('img', { name: 'RADR.' }).first().isVisible());
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

    // --- companies & institutions: a hard constraint typed into the form -----------------
    const orgs = page.locator('[data-organizations]');
    check('constraints form offers a companies & institutions section', await orgs.isVisible());
    await orgs.getByPlaceholder(/Google, McKinsey/).fill('Acme');
    await orgs.getByPlaceholder(/Google, McKinsey/).press('Enter');
    await orgs.getByRole('button', { name: 'Current employer only' }).click();
    await orgs.getByPlaceholder(/Infosys, Acme/).fill('Infosys');
    await orgs.getByPlaceholder(/Infosys, Acme/).press('Enter');
    check('organisation chips added with current-employer scope', (await orgs.locator('.chip', { hasText: 'Acme' }).count()) === 1 && (await orgs.getByRole('button', { name: 'Current employer only' }).getAttribute('aria-pressed')) === 'true');
    await shot(page, '03b-organisations');

    // --- generate queries ----------------------------------------------------
    await page.getByRole('button', { name: /^Generate \d+ quer/ }).click();
    await page.getByRole('dialog', { name: /quer(y|ies) · each searched individually/ }).waitFor({ timeout: 60000 });
    const rows = await page.locator('[role="dialog"] [data-query-row]').count();
    const rowTexts = (await page.locator('[role="dialog"] [data-query-row]').allTextContents()).map((t) => t.replace(/\s+/g, ' '));
    const linkedinRows = rowTexts.filter((t) => t.includes('linkedin.com/in'));
    check('LinkedIn queries carry the current-employer constraint as intitle:"Acme"', linkedinRows.length > 0 && linkedinRows.every((t) => /intitle:\s*"Acme"/.test(t)), `${linkedinRows.filter((t) => /intitle:\s*"Acme"/.test(t)).length}/${linkedinRows.length}`);
    const nonLinkedin = rowTexts.filter((t) => !t.includes('linkedin.com/in'));
    check('other platforms require the organisation as a plain mention', nonLinkedin.length > 0 && nonLinkedin.every((t) => /"Acme"/.test(t) && !/intitle:\s*"Acme"/.test(t)), `${nonLinkedin.filter((t) => /"Acme"/.test(t)).length}/${nonLinkedin.length}`);
    // Exclusion pills draw the minus as chrome, not text — assert on the pill family instead.
    const rowsWithExclusion = await page.locator('[role="dialog"] [data-query-row]').evaluateAll((els) =>
      els.filter((row) => Array.from(row.querySelectorAll('[data-family="exclude"]')).some((p) => /Infosys/i.test(p.textContent ?? ''))).length
    );
    check('every query excludes the excluded organisation', rowsWithExclusion === rows, `${rowsWithExclusion}/${rows}`);
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

    // --- async: stop waiting and the run keeps reporting in the popup ----------
    check('overlay offers to run in the background', await overlay.getByRole('button', { name: 'Run in the background' }).isVisible());
    await overlay.getByRole('button', { name: 'Run in the background' }).click();
    await overlay.waitFor({ state: 'detached', timeout: 10000 });
    const toaster = page.locator('[data-run-toaster]');
    await toaster.waitFor({ timeout: 10000 });
    check('progress popup takes over bottom-right', await toaster.isVisible());
    const popupBox = await toaster.boundingBox();
    const view = page.viewportSize()!;
    check(
      'popup is anchored bottom-right',
      Boolean(popupBox && popupBox.x + popupBox.width > view.width - 60 && popupBox.y + popupBox.height > view.height - 60),
      popupBox ? `x=${Math.round(popupBox.x)} y=${Math.round(popupBox.y)}` : 'no box'
    );
    check('popup names the session being searched', (await toaster.getByText(/Senior Product Designer/).count()) >= 1);
    await shot(page, '05b-run-popup');

    // The run outlives a full page reload, because its progress is in the DB.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-run-toaster]').waitFor({ timeout: 15000 });
    check('popup is restored after a reload', await page.locator('[data-run-toaster]').isVisible());
    await page.locator('[data-run-toaster]').getByRole('button', { name: /query detail/ }).first().click();
    await shot(page, '05c-run-popup-expanded');

    const runs = await (await page.request.get(`${BASE}/api/search-runs`)).json();
    check('GET /api/search-runs reports the run', Array.isArray(runs.runs) && runs.runs.length >= 1, `${runs.runs?.length} runs`);
    check(
      'run row carries per-query progress',
      Array.isArray(runs.runs?.[0]?.queries) && runs.runs[0].queries.length === rows,
      `${runs.runs?.[0]?.queries?.length} query rows`
    );
    await page.getByText(/Query run receipt/).waitFor({ timeout: 30000 });
    check('run finishes and shows the receipt', await page.getByText(/Query run receipt/).isVisible());
    const statusText = await page.locator('[role="status"]').first().innerText();
    check('status bar reports the reopened session', statusText.trim().length > 0, statusText.split('\n').pop());
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

    const storedConstraints = (await prisma.job.findUnique({ where: { id: createdSessionId! }, select: { mergedConstraints: true } }))?.mergedConstraints as any;
    check('organisation constraint persisted with the session', storedConstraints?.target_organizations?.[0] === 'Acme' && storedConstraints?.organization_scope === 'current' && storedConstraints?.excluded_organizations?.[0] === 'Infosys', JSON.stringify({ t: storedConstraints?.target_organizations, s: storedConstraints?.organization_scope, x: storedConstraints?.excluded_organizations }));
    const priyaRow = await prisma.candidate.findFirst({ where: { jobId: createdSessionId!, name: 'Priya Nair' }, select: { matchBreakdown: true, rawScrapedData: true, missingSignals: true } });
    const rahulRow = await prisma.candidate.findFirst({ where: { jobId: createdSessionId!, name: 'Rahul Verma' }, select: { matchBreakdown: true, rawScrapedData: true, missingSignals: true } });
    check('title "… - Acme | LinkedIn" scores as current-employer match (10/10)', (priyaRow?.matchBreakdown as any)?.organization_score === 10 && (priyaRow?.rawScrapedData as any)?.organization_match === 'Acme', JSON.stringify((priyaRow?.matchBreakdown as any)?.organization_score));
    check('profile without the organisation scores 0 and is flagged', (rahulRow?.matchBreakdown as any)?.organization_score === 0 && JSON.stringify(rahulRow?.missingSignals).includes('required organisations'), JSON.stringify(rahulRow?.missingSignals));

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Priya Nair').first().waitFor({ timeout: 15000 });
    check('card shows the matched organisation chip only where found', (await page.locator('.card', { hasText: 'Priya Nair' }).first().locator('[data-org-match="Acme"]').count()) === 1 && (await page.locator('.card', { hasText: 'Rahul Verma' }).first().locator('[data-org-match]').count()) === 0);
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

    // --- regression: draft outreach from the drawer, leave the modal, drawer must still close ---
    await drawer.getByRole('button', { name: /Draft outreach|Draft follow-up/ }).click();
    const outreachModal = page.locator('[aria-labelledby="outreach-title"]');
    await outreachModal.waitFor({ timeout: 10000 });
    await outreachModal.locator('header button[aria-label="Close"]').click();
    await outreachModal.waitFor({ state: 'detached', timeout: 5000 });
    const drawersAfterModal = await page.locator('[aria-labelledby="drawer-title"]').count();
    check('leaving the outreach modal leaves exactly one drawer (no duplicate from key collision)', drawersAfterModal === 1, `${drawersAfterModal} drawer(s)`);
    await page.locator('[aria-labelledby="drawer-title"] header button[aria-label="Close"]').click();
    await page.waitForTimeout(300);
    check('drawer X closes it after the modal cycle', (await page.locator('[aria-labelledby="drawer-title"]').count()) === 0);

    // --- regression: the Low tier bar must be visibly coloured, not the track colour ---
    const tierColours = await page.evaluate(() => {
      // The Low tier's class lives in src/lib/utils/tier.ts; if Tailwind does not
      // scan that folder the class is purged and the bar paints nothing.
      const probe = document.createElement('div');
      probe.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'h-full rounded-full bg-faint';
      probe.appendChild(fill);
      document.body.appendChild(probe);
      const out = { fill: getComputedStyle(fill).backgroundColor, track: getComputedStyle(probe).backgroundColor };
      probe.remove();
      const real = document.querySelector('[data-tier="low"]') as HTMLElement | null;
      return { ...out, realLow: real ? getComputedStyle(real).backgroundColor : null };
    });
    check(
      'low-tier score bar has its own colour (bg-faint not purged)',
      tierColours.fill !== tierColours.track && !/rgba\(0, 0, 0, 0\)|transparent/.test(tierColours.fill) && (tierColours.realLow === null || tierColours.realLow === tierColours.fill),
      `fill=${tierColours.fill} track=${tierColours.track}${tierColours.realLow ? ` real=${tierColours.realLow}` : ''}`
    );

    // --- regression: long names truncate inside the card instead of overflowing ---
    const nameBtn = page.locator('.card', { hasText: 'Priya Nair' }).first().getByRole('button', { name: 'Priya Nair' });
    const truncation = await nameBtn.evaluate((el) => {
      const b = el as HTMLElement;
      b.textContent = 'Aishwarya Venkataraghavan Subramaniam Iyer Narayanaswamy Krishnamurthy';
      const cs = getComputedStyle(b);
      const parentW = (b.parentElement as HTMLElement).clientWidth;
      return { overflow: cs.overflow, ellipsis: cs.textOverflow, nowrap: cs.whiteSpace, clipped: b.scrollWidth > b.clientWidth, fitsParent: b.clientWidth <= parentW + 1 };
    });
    check('card name truncates with an ellipsis within its column', truncation.ellipsis === 'ellipsis' && truncation.nowrap === 'nowrap' && truncation.clipped && truncation.fitsParent, JSON.stringify(truncation));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Priya Nair').first().waitFor({ timeout: 15000 });

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
    const columnOrder = await page.locator('[data-kanban] section[data-stage]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stage')));
    check('board columns follow the funnel order', columnOrder.join('>') === 'New>Reviewed>Saved>Shortlisted>Contacted>Replied>Archived', columnOrder.join(' > '));
    check('shortlisted card offers Message as its forward action', await page.locator('section[data-stage="Shortlisted"] article', { hasText: 'Priya Nair' }).getByRole('button', { name: /^Message/ }).isVisible());
    await shot(page, '10-pipeline-board');

    // --- connection request note: 300-char cap, logged, candidate → Contacted with a follow-up ---
    await page.locator('section[data-stage="Shortlisted"] article', { hasText: 'Priya Nair' }).getByRole('button', { name: /^Message/ }).click();
    const noteModal = page.locator('[aria-labelledby="outreach-title"]');
    await noteModal.waitFor({ timeout: 10000 });
    const channelSelect = noteModal.getByLabel('Channel');
    check('LinkedIn profile defaults to a connection note', (await channelSelect.inputValue()) === 'LinkedIn Note', await channelSelect.inputValue());
    check('channel list offers the connection note with its cap', (await channelSelect.locator('option', { hasText: /connection note · 300 chars/ }).count()) === 1);
    await noteModal.getByText('Drafting…').waitFor({ state: 'detached', timeout: 90000 }).catch(() => {});
    const noteText = await noteModal.locator('textarea').inputValue();
    const counted = Number(await noteModal.locator('[data-char-count]').getAttribute('data-char-count'));
    check('drafted note is within 300 characters', noteText.length > 0 && noteText.length <= 300 && counted === noteText.length, `${noteText.length} chars`);
    check('note has no subject field', (await noteModal.getByText('Subject', { exact: true }).count()) === 0);
    const sourceChip = await noteModal.getByText(/AI draft|Template/).first().textContent();
    check('draft declares its source honestly', /AI draft|Template/.test(sourceChip ?? ''), sourceChip ?? undefined);
    await shot(page, '10b-connection-note');
    const logged = page.waitForResponse((r) => r.url().includes('/outreach') && r.request().method() === 'POST');
    await noteModal.getByRole('button', { name: 'Log as sent' }).click();
    const logResp = await logged;
    check('connection note logs with 201', logResp.status() === 201, `status ${logResp.status()}`);
    await noteModal.waitFor({ state: 'detached', timeout: 5000 });
    const afterNote = await prisma.candidate.findFirst({ where: { jobId: createdSessionId!, name: 'Priya Nair' }, include: { outreachLogs: true } });
    check('candidate moved to Contacted with the channel stamped', afterNote?.status === 'Contacted' && afterNote?.outreachChannel === 'LinkedInNote', `${afterNote?.status} / ${afterNote?.outreachChannel}`);
    check('stage change is timestamped', Boolean(afterNote?.stageChangedAt));
    const fuDays = afterNote?.nextFollowUp ? Math.round((afterNote.nextFollowUp.getTime() - Date.now()) / 86400000) : -1;
    check('a follow-up was suggested ~5 days out for a connection note', fuDays >= 4 && fuDays <= 5, `${fuDays} days`);
    check('outreach log row stored with the note', afterNote?.outreachLogs.length === 1 && afterNote.outreachLogs[0].channel === 'LinkedInNote' && afterNote.outreachLogs[0].messageBody.length <= 300);
    check('private notes were not polluted with the message', afterNote?.notes === 'Strong design-systems portfolio', afterNote?.notes ?? undefined);
    await page.locator('section[data-stage="Contacted"] article', { hasText: 'Priya Nair' }).waitFor({ timeout: 10000 });
    check('card moved to the Contacted column with tracking chips', (await page.locator('section[data-stage="Contacted"] article', { hasText: 'Priya Nair' }).locator('[data-tracking-chips]').count()) === 1);
    await shot(page, '10c-board-after-note');

    // --- the activity timeline shows it; a follow-up never regresses the stage ---
    await page.locator('section[data-stage="Contacted"] article', { hasText: 'Priya Nair' }).getByRole('button', { name: 'Priya Nair' }).click();
    const cDrawer = page.locator('[aria-labelledby="drawer-title"]');
    await cDrawer.waitFor();
    await cDrawer.locator('[data-activity] li').first().waitFor({ timeout: 10000 });
    check('drawer activity lists the connection note', (await cDrawer.locator('[data-activity]').getByText('Connection note').count()) === 1);
    check('drawer stage select is in funnel order', (await cDrawer.getByLabel('Stage').locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).join('>'))) === 'New>Reviewed>Saved>Shortlisted>Contacted>Replied>Archived');
    await cDrawer.locator('header button[aria-label="Close"]').click();
    const repliedResp = await page.request.patch(`${BASE}/api/candidates/${afterNote!.id}`, { data: { status: 'Replied' } });
    check('stage can be advanced to Replied via the API', repliedResp.ok());
    const followUpResp = await page.request.post(`${BASE}/api/candidates/${afterNote!.id}/outreach`, { data: { channel: 'LinkedIn DM', message: 'Thanks for connecting — would Thursday work for a quick call?' } });
    const followedUp = await prisma.candidate.findUnique({ where: { id: afterNote!.id } });
    check('logging a follow-up does not regress Replied back to Contacted', followUpResp.status() === 201 && followedUp?.status === 'Replied', `${followUpResp.status()} · ${followedUp?.status}`);
    const tooLong = await page.request.post(`${BASE}/api/candidates/${afterNote!.id}/outreach`, { data: { channel: 'LinkedIn Note', message: 'x'.repeat(301) } });
    check('a 301-character connection note is refused server-side', tooLong.status() === 400, `status ${tooLong.status()}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Outreach pipeline').waitFor();
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

    // --- another user cannot read or stop this user's search run (IDOR) --------------------
    const ownRun = await prisma.searchRun.findFirst({ where: { startedById: user.id }, orderBy: { startedAt: 'desc' } });
    const idorGet = await fp.request.get(`${BASE}/api/search-runs/${ownRun!.id}`);
    check("another user's run reads as 404, not readable", idorGet.status() === 404, `status ${idorGet.status()}`);
    const idorDelete = await fp.request.delete(`${BASE}/api/search-runs/${ownRun!.id}`);
    check("another user cannot abort this user's run", idorDelete.status() === 404, `status ${idorDelete.status()}`);
    const stillOwn = await prisma.searchRun.findUnique({ where: { id: ownRun!.id }, select: { abortRequested: true } });
    check('the abort flag was not set by the other user', stillOwn?.abortRequested === false);
    const idorList = await (await fp.request.get(`${BASE}/api/search-runs`)).json();
    check("another user's run list does not leak this user's runs", Array.isArray(idorList.runs) && idorList.runs.length === 0, `${idorList.runs?.length} runs`);
    const ownGet = await page.request.get(`${BASE}/api/search-runs/${ownRun!.id}`);
    check('the owner can still read their own run', ownGet.status() === 200, `status ${ownGet.status()}`);

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
    // Priya was moved Shortlisted → Contacted (note logged) → Replied earlier in the run.
    const apiCands = await context.request.get(`${BASE}/api/candidates?jobId=${createdSessionId}&status=Replied`);
    const cbody = await apiCands.json();
    check('/api/candidates filters by session + status', apiCands.ok() && cbody.candidates.length === 1 && cbody.candidates[0].name === 'Priya Nair', `${cbody.candidates?.length} Replied`);

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
