import type { Browser } from 'playwright';
import type { RawSearchResult, SerpProvider } from './serp';

let browserInstance: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;

const BROWSER_IDLE_MS = 5 * 60 * 1000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function scheduleIdleClose() {
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(() => {
    void closeBrowser();
  }, BROWSER_IDLE_MS);
  idleCloseTimer.unref?.();
}

/**
 * Closes the shared browser instance, if one is open. Safe to call repeatedly.
 * Registered against process exit below; also callable directly (e.g. from a
 * future graceful-shutdown hook) so the process never leaks a Chromium child.
 */
export async function closeBrowser(): Promise<void> {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  if (browserInstance) {
    const toClose = browserInstance;
    browserInstance = null;
    try {
      await toClose.close();
    } catch {
      // Already closed or crashed — nothing left to clean up.
    }
  }
}

// `playwright` ships a real Chromium download and is only needed by the free-tier
// SERP fallback, so it's imported lazily (never at module-eval time) and listed as
// an optional dependency. A host with no browser binaries installed degrades to a
// thrown error from this one call site — caught by the caller — rather than
// crashing the whole route (or the production build) at import time.
async function getBrowserInstance(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    scheduleIdleClose();
    return browserInstance;
  }

  if (!browserLaunchPromise) {
    browserLaunchPromise = (async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      browserInstance = browser;
      return browser;
    })().finally(() => {
      browserLaunchPromise = null;
    });
  }

  const browser = await browserLaunchPromise;
  scheduleIdleClose();
  return browser;
}

process.once('beforeExit', () => {
  void closeBrowser();
});

/**
 * Free-tier SERP fallback: runs the X-Ray query in headless Google and, if
 * Google returns nothing (usually a captcha wall), in headless DuckDuckGo.
 * Returns whichever engine produced results and every organic hit it listed.
 */
export async function executePlaywrightXRaySearch(
  queryString: string
): Promise<{ results: RawSearchResult[]; provider: SerpProvider }> {
  const results: RawSearchResult[] = [];
  let provider: SerpProvider = 'none';
  let context: Awaited<ReturnType<Browser['newContext']>> | null = null;

  try {
    const browser = await getBrowserInstance();
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryString)}&num=100`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const rawItems = await page.evaluate(() => {
      const items: { title: string; url: string; snippet: string }[] = [];
      const searchBlocks = document.querySelectorAll('div.g, div.MjjYud');

      searchBlocks.forEach((block) => {
        const linkEl = block.querySelector('a') as HTMLAnchorElement | null;
        const titleEl = block.querySelector('h3') as HTMLElement | null;
        const snippetEl = block.querySelector('div.VwiC3b, div.YrbpBc') as HTMLElement | null;

        if (linkEl && titleEl && linkEl.href) {
          items.push({
            title: titleEl.innerText || '',
            url: linkEl.href,
            snippet: snippetEl ? snippetEl.innerText : '',
          });
        }
      });

      return items;
    });

    rawItems.forEach((item, idx) => {
      if (item.url && item.title) {
        results.push({ ...item, position: idx + 1 });
      }
    });
    if (results.length > 0) provider = 'google-headless';

    if (results.length === 0) {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(queryString)}`;
      await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });

      const ddgItems = await page.evaluate(() => {
        const items: { title: string; url: string; snippet: string }[] = [];
        const rows = document.querySelectorAll('div.result');

        rows.forEach((row) => {
          const aTitle = row.querySelector('a.result__a') as HTMLAnchorElement | null;
          const aUrl = row.querySelector('a.result__url') as HTMLAnchorElement | null;
          const divSnippet = row.querySelector('a.result__snippet') as HTMLElement | null;

          if (aTitle && aUrl && aUrl.href) {
            items.push({
              title: aTitle.innerText || '',
              url: aUrl.href,
              snippet: divSnippet ? divSnippet.innerText : '',
            });
          }
        });

        return items;
      });

      ddgItems.forEach((item, idx) => results.push({ ...item, position: idx + 1 }));
      if (results.length > 0) provider = 'duckduckgo-headless';
    }
  } catch (err) {
    console.error('Playwright headless SERP error:', err);
  } finally {
    // Always close the context, even if `goto`/`evaluate` threw above — this used
    // to leak a browser context (and its process memory) on every failed search.
    if (context) {
      await context.close().catch(() => {});
    }
  }

  return { results, provider };
}
