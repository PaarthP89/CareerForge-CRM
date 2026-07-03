import { chromium, type Browser } from 'playwright';

const MAX_EXTRACTED_CHARS = 20_000;
const MIN_VIABLE_CHARS = 200;
const USER_AGENT = 'Mozilla/5.0 (compatible; CareerForgeLinkHealth/1.0)';

// Headless browser fallback is far heavier than a plain fetch, so its
// concurrency is capped independently of whatever concurrency the caller
// (scraper/link-health) uses for the outer per-job loop.
const BROWSER_FETCH_CONCURRENCY = 2;

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

export function extractReadableText(html: string): string {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withoutTags = withoutNonContent.replace(/<[^>]+>/g, ' ');
  const decoded = decodeEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/g, ' ').trim();

  return collapsed.slice(0, MAX_EXTRACTED_CHARS);
}

export function isViableJobDescription(text: string): boolean {
  return text.length >= MIN_VIABLE_CHARS;
}

async function fetchPlain(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/** Call once at the end of a worker run so the browser process doesn't linger. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const promise = browserPromise;
  browserPromise = null;
  const browser = await promise;
  await browser.close();
}

let activeBrowserFetches = 0;
const browserFetchQueue: (() => void)[] = [];

function acquireBrowserSlot(): Promise<void> {
  if (activeBrowserFetches < BROWSER_FETCH_CONCURRENCY) {
    activeBrowserFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => browserFetchQueue.push(resolve));
}

function releaseBrowserSlot(): void {
  const next = browserFetchQueue.shift();
  if (next) {
    next();
  } else {
    activeBrowserFetches--;
  }
}

async function fetchWithBrowser(url: string, timeoutMs: number): Promise<string | null> {
  await acquireBrowserSlot();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    try {
      const page = await context.newPage();
      await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      try {
        // Best-effort: many SPAs render their real content shortly after
        // domcontentloaded. Some pages never go fully idle (analytics,
        // websockets, chat widgets) — swallow that timeout and use whatever
        // rendered so far rather than failing the whole fetch.
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
      } catch {
        // ignore — fall through to page.content() below
      }
      return await page.content();
    } finally {
      await context.close();
    }
  } catch {
    return null;
  } finally {
    releaseBrowserSlot();
  }
}

/**
 * Plain fetch first (cheap, no JS execution). Only falls back to a headless
 * browser render when the plain fetch fails outright or the extracted text
 * isn't viable — i.e. likely a JS-rendered shell or a bot-detection wall that
 * returns something other than the real page to a non-browser client.
 * Returns extracted readable text (not raw HTML) either way, or null if
 * neither attempt produces a viable page.
 */
export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number
): Promise<string | null> {
  const plainHtml = await fetchPlain(url, timeoutMs);
  if (plainHtml) {
    const extracted = extractReadableText(plainHtml);
    if (isViableJobDescription(extracted)) return extracted;
  }

  const renderedHtml = await fetchWithBrowser(url, timeoutMs);
  if (!renderedHtml) return null;

  const extracted = extractReadableText(renderedHtml);
  return isViableJobDescription(extracted) ? extracted : null;
}
