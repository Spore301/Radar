import type { RawSearchResult, SerpProvider } from './serp';

// ---------------------------------------------------------------------------
// EXPERIMENTAL (branch feat/free-search-poc) — X-Ray search with no SERP API.
//
// What was measured before this was written (see SEARCH_FREE_POC.md):
//   * plain HTTP requests to DuckDuckGo, Brave, Mojeek, Startpage and Yahoo
//     are challenged or refused; Bing over plain HTTP answers 200 but silently
//     ignores the query and returns unrelated pages;
//   * headless Google hits its "unusual traffic" wall on the first query;
//   * Bing in a real (headless) browser session, warmed by loading the home
//     page first so it holds cookies, returns on-target results — 10/10
//     LinkedIn profiles for a Golang backend query in Bengaluru.
//
// So this provider drives ONE long-lived browser context against Bing, in
// series (a mutex — parallel tabs are what get a session flagged), with human
// pacing between pages, Bing-dialect query translation, link unwrapping and
// bot-wall detection. DuckDuckGo in the same browser is the fallback.
//
// Scraping a search engine's result pages is against its terms of service and
// it can block the IP at any time. This is a proof of concept for evaluating
// result quality without paying for SERP calls — not a production path.
// ---------------------------------------------------------------------------

interface BrowserPage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; timeout?: number }): Promise<{ status(): number } | null>;
  evaluate<R, A>(pageFunction: (arg: A) => R, arg: A): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
  isClosed(): boolean;
}
interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}
interface Browser {
  isConnected(): boolean;
  newContext(options?: { userAgent?: string; locale?: string; viewport?: { width: number; height: number } }): Promise<BrowserContext>;
  close(): Promise<void>;
}
interface PlaywrightModule {
  chromium: { launch(options?: { headless?: boolean; channel?: string; args?: string[] }): Promise<Browser> };
}

export class SearchBlockedError extends Error {
  constructor(engine: string, detail: string) {
    super(`${engine} showed a bot check (${detail}). Wait a while, or use SerpAPI.`);
    this.name = 'SearchBlockedError';
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const IDLE_CLOSE_MS = 5 * 60 * 1000;
/** A fresh context (new cookies) every so often keeps one session from accumulating suspicion. */
const QUERIES_PER_CONTEXT = 25;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: BrowserPage | null = null;
let queriesOnContext = 0;
let warmedMarket = '';
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

// --- serialisation ----------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
/** Runs browser searches one at a time, process-wide. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// --- browser lifecycle --------------------------------------------------------

async function launch(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  // Optional dependency, loaded lazily — `as string` widens the specifier so the type-checker never needs the package on disk.
  const { chromium } = (await import('playwright' as string)) as PlaywrightModule;
  // PLAYWRIGHT_CHANNEL=msedge / chrome uses an installed browser instead of a downloaded Chromium.
  const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
  browser = await chromium.launch({ headless: true, channel, args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'] });
  return browser;
}

async function resetContext(): Promise<void> {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  page = null;
  context = null;
  queriesOnContext = 0;
  warmedMarket = '';
}

async function getPage(market: string): Promise<BrowserPage> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowserSearch(), IDLE_CLOSE_MS);
  idleTimer.unref?.();

  if (queriesOnContext >= QUERIES_PER_CONTEXT) await resetContext();
  if (!context || !page || page.isClosed()) {
    await resetContext();
    const b = await launch();
    context = await b.newContext({ userAgent: USER_AGENT, locale: 'en-US', viewport: { width: 1366, height: 900 } });
    page = await context.newPage();
  }
  if (warmedMarket !== market) {
    // The warm-up visit is what makes Bing treat the session as a browser:
    // without its cookies, the results page ignores the query.
    await page.goto(`https://www.bing.com/?cc=${market}`, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => null);
    await sleep(jitter(900, 1800));
    warmedMarket = market;
  }
  return page;
}

export async function closeBrowserSearch(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  await resetContext();
  const b = browser;
  browser = null;
  await b?.close().catch(() => {});
}

process.once('beforeExit', () => void closeBrowserSearch());

// --- query dialect ------------------------------------------------------------

/**
 * Google X-Ray → Bing. Bing honours site:, quotes, OR, a leading minus,
 * filetype:, inurl: and intitle: on a single term, but has no AROUND(n) and
 * does not distribute intitle: over a group. So:
 *   intitle:("A" OR "B")   → (intitle:"A" OR intitle:"B")
 *   -intitle:job           → kept (Bing supports a negated intitle:)
 *   X AROUND(5) Y          → X Y
 */
export function toBingQuery(query: string): string {
  let q = query;
  q = q.replace(/(-?)intitle:\(([^()]*)\)/gi, (_m, neg: string, inner: string) => {
    const terms = inner.split(/\s+OR\s+/).map((t) => t.trim()).filter(Boolean);
    if (neg) return terms.map((t) => `-intitle:${t}`).join(' ');
    return terms.length === 1 ? `intitle:${terms[0]}` : `(${terms.map((t) => `intitle:${t}`).join(' OR ')})`;
  });
  q = q.replace(/\s*AROUND\(\d+\)\s*/gi, ' ');
  return q.replace(/\s{2,}/g, ' ').trim();
}

/** Bing wraps result links as bing.com/ck/a?…&u=a1<base64url>. */
export function unwrapBingUrl(href: string): string {
  const m = href.replace(/&amp;/g, '&').match(/[?&]u=a1([^&]+)/);
  if (!m) return href;
  try {
    const url = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^https?:\/\//.test(url) ? url : href;
  } catch {
    return href;
  }
}

// --- engines ------------------------------------------------------------------

const BOT_WALL = /verify you are (a )?human|unusual traffic|are you a robot|solve the challenge|one last step|captcha/i;

interface PageOfResults {
  results: Array<{ title: string; url: string; snippet: string }>;
  hasNext: boolean;
}

async function bingPage(p: BrowserPage, query: string, market: string, first: number): Promise<PageOfResults> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&cc=${market}${first > 1 ? `&first=${first}` : ''}`;
  const res = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await sleep(jitter(700, 1400));
  const data = await p.evaluate(() => {
    const text = document.body?.innerText?.slice(0, 3000) ?? '';
    const results = Array.from(document.querySelectorAll('li.b_algo')).map((b) => {
      const a = b.querySelector('h2 a') as HTMLAnchorElement | null;
      const s = (b.querySelector('.b_caption p') ?? b.querySelector('p')) as HTMLElement | null;
      // LinkedIn results carry "Location: …" in Bing's fact rows, outside the caption paragraph.
      const facts = Array.from(b.querySelectorAll('.b_factrow'))
        .map((f) => (f as HTMLElement).innerText.trim())
        .filter(Boolean);
      return { url: a?.href ?? '', title: a?.innerText ?? '', snippet: [s?.innerText ?? '', ...facts].filter(Boolean).join(' · ') };
    });
    const captcha = Boolean(document.querySelector('#b_captcha, iframe[src*="challenge"], .captcha'));
    const hasNext = Boolean(document.querySelector('a.sb_pagN, a[title="Next page"]'));
    return { text, results, captcha, hasNext };
  }, null);
  if ((res && res.status() === 429) || data.captcha || (data.results.length === 0 && BOT_WALL.test(data.text))) {
    throw new SearchBlockedError('Bing', res?.status() === 429 ? 'HTTP 429' : 'challenge page');
  }
  return {
    results: data.results.filter((r) => r.url).map((r) => ({ ...r, url: unwrapBingUrl(r.url), title: r.title.trim(), snippet: r.snippet.trim() })),
    hasNext: data.hasNext,
  };
}

async function duckDuckGoPage(p: BrowserPage, query: string): Promise<PageOfResults> {
  await p.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
  await sleep(jitter(2500, 3500)); // results render client-side
  const data = await p.evaluate(() => {
    const results = Array.from(document.querySelectorAll('article[data-testid="result"]')).map((b) => {
      const a = b.querySelector('a[data-testid="result-title-a"]') as HTMLAnchorElement | null;
      const s = b.querySelector('[data-result="snippet"]') as HTMLElement | null;
      return { url: a?.href ?? '', title: a?.innerText ?? '', snippet: s?.innerText ?? '' };
    });
    return { results, text: document.body?.innerText?.slice(0, 2000) ?? '' };
  }, null);
  if (data.results.length === 0 && BOT_WALL.test(data.text)) throw new SearchBlockedError('DuckDuckGo', 'challenge page');
  return { results: data.results.filter((r) => r.url), hasNext: false };
}

export interface BrowserSearchOutcome {
  provider: SerpProvider;
  results: RawSearchResult[];
  pagesFetched: number;
  notice?: string;
}

/**
 * Runs one X-Ray query through the browser: Bing first, paged up to
 * `maxPages` (10 results each), DuckDuckGo if Bing is walled. Serialised
 * process-wide. Throws SearchBlockedError only when both engines are walled.
 */
export function browserXRaySearch(query: string, opts: { maxPages: number; gl?: string; stopAt?: number }): Promise<BrowserSearchOutcome> {
  return exclusive(async () => {
    // Bing's market codes are ISO 3166 — the UK is GB, where SerpAPI and LinkedIn say "uk".
    const market = (opts.gl === 'uk' ? 'gb' : opts.gl || 'us').toUpperCase();
    const seen = new Set<string>();
    const all: RawSearchResult[] = [];
    const absorb = (rows: PageOfResults['results']) => {
      let added = 0;
      for (const r of rows) {
        const key = r.url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...r, position: all.length + 1 });
        added++;
      }
      return added;
    };

    const bingQuery = toBingQuery(query);
    let pages = 0;
    try {
      const p = await getPage(market);
      queriesOnContext++;
      while (pages < Math.max(1, opts.maxPages)) {
        if (pages > 0 && opts.stopAt && Date.now() > opts.stopAt) break;
        const page = await bingPage(p, bingQuery, market, pages * 10 + 1);
        pages++;
        if (absorb(page.results) === 0 || !page.hasNext) break;
        await sleep(jitter(1500, 3000));
      }
      return { provider: 'bing-headless', results: all, pagesFetched: pages, notice: bingQuery !== query ? `Bing dialect: ${bingQuery}` : undefined };
    } catch (err) {
      if (!(err instanceof SearchBlockedError) && all.length) {
        return { provider: 'bing-headless', results: all, pagesFetched: pages, notice: `Stopped paging: ${(err as Error).message}` };
      }
      // Bing walled (or the browser fell over): a fresh context, then DuckDuckGo.
      await resetContext();
      const p = await getPage(market);
      const ddg = await duckDuckGoPage(p, bingQuery);
      absorb(ddg.results);
      return {
        provider: 'duckduckgo-headless',
        results: all,
        pagesFetched: pages + 1,
        notice: `Bing unavailable (${(err as Error).message}); DuckDuckGo answered`,
      };
    }
  });
}
