import { chromium, type Browser } from 'playwright';
import { extractJobPostings, type JobPostingSignal } from './json-ld.js';

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

/**
 * The <title> tag survives independently of extractReadableText, which
 * folds it into the general text soup — but it's a strong, cheap signal on
 * its own: a page whose title has nothing to do with the job/company it's
 * supposed to be (e.g. a generic "Find Your Dream Job" homepage) is a sign
 * we've been redirected somewhere that isn't the actual posting.
 */
export function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const decoded = decodeEntities(match[1].replace(/\s+/g, ' ').trim());
  return decoded.length > 0 ? decoded : null;
}

// A plain fetch against a bot-walled or client-rendered-only page often still
// returns 200 OK with 200+ chars of text -- just not real content: an Akamai/
// Cloudflare block page, or a React/Vue shell whose actual body never
// executes without JS. Length alone can't tell these apart from a genuine
// (if short) posting, so without this check the length-only gate was
// swallowing that garbage as "viable" and skipping the browser fallback
// entirely -- confirmed live against a sample of jobs.apple.com ("Please
// enable Javascript...") and a Tesla listing blocked by Akamai ("Access
// Denied") that were both being misclassified 'generic' as a result, purely
// because the plain-fetch shell text was long enough to look real.
const BOT_BLOCK_OR_SHELL_SIGNALS = [
  /access denied/i,
  /request unsuccessful/i,
  /attention required.{0,30}cloudflare/i,
  /please enable javascript/i,
  /you need to enable javascript/i,
  /javascript is disabled/i,
  /are you a human/i,
  /this website is using a security service/i,
  /403 forbidden/i,
  /reference #\S*\.edgesuite\.net/i,
];

export function isViableJobDescription(text: string): boolean {
  if (text.length < MIN_VIABLE_CHARS) return false;
  return !BOT_BLOCK_OR_SHELL_SIGNALS.some((re) => re.test(text));
}

/**
 * No amount of retrying ever fixes a syntactically invalid URL. Note the
 * WHATWG URL parser is lenient enough to "fix" a malformed source like
 * "https:/.workable.com/..." (single slash) into a technically-parseable
 * URL with hostname ".workable.com" instead of throwing — that's not a real,
 * resolvable domain, so the hostname itself needs its own sanity check.
 */
export function isFetchableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    return host.length > 0 && !host.startsWith('.') && !host.startsWith('-') && host.includes('.');
  } catch {
    return false;
  }
}

/**
 * 'dns' is a much stronger signal than 'timeout'/'other' — a domain that no
 * longer resolves at all (vs. a slow/blocked/transient response) means the
 * whole site is gone, not just this one page. Only 'dns' is ever treated as
 * a confident dead-listing signal by the caller, and only when it's
 * confirmed on both the plain-fetch and browser-fallback attempts.
 */
type FetchFailureReason = 'dns' | 'timeout' | 'other' | null;

interface PlainFetchResult {
  html: string | null;
  status: number | null;
  failureReason: FetchFailureReason;
}

function classifyFetchError(err: unknown): FetchFailureReason {
  if (err instanceof Error && err.name === 'AbortError') return 'timeout';
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  if (cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') return 'dns';
  return 'other';
}

function classifyPlaywrightError(err: unknown): FetchFailureReason {
  const message = err instanceof Error ? err.message : String(err);
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(message)) return 'dns';
  if (/Timeout.*exceeded|ERR_TIMED_OUT/i.test(message)) return 'timeout';
  return 'other';
}

async function fetchPlain(url: string, timeoutMs: number): Promise<PlainFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return { html: null, status: res.status, failureReason: null };
    return { html: await res.text(), status: res.status, failureReason: null };
  } catch (err) {
    return { html: null, status: null, failureReason: classifyFetchError(err) };
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

async function fetchWithBrowser(url: string, timeoutMs: number): Promise<PlainFetchResult> {
  await acquireBrowserSlot();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: USER_AGENT });
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      try {
        // Best-effort: many SPAs render their real content shortly after
        // domcontentloaded. Some pages never go fully idle (analytics,
        // websockets, chat widgets) — swallow that timeout and use whatever
        // rendered so far rather than failing the whole fetch.
        await page.waitForLoadState('networkidle', { timeout: timeoutMs });
      } catch {
        // ignore — fall through to page.content() below
      }
      return { html: await page.content(), status: response?.status() ?? null, failureReason: null };
    } finally {
      await context.close();
    }
  } catch (err) {
    return { html: null, status: null, failureReason: classifyPlaywrightError(err) };
  } finally {
    releaseBrowserSlot();
  }
}

export interface FetchedPage {
  text: string | null;
  /**
   * HTTP status from whichever attempt (plain fetch or browser nav) actually
   * reached the server — a 404/410 here is a deterministic "this listing is
   * gone" signal that needs no keyword matching or LLM call at all.
   */
  status: number | null;
  /** The URL itself was never a well-formed http(s) URL — no fetch was attempted. */
  malformed: boolean;
  /** The <title> tag, kept separate from the body text extraction. */
  pageTitle: string | null;
  /**
   * True only when both the plain fetch AND the browser fallback independently
   * failed to resolve the domain at all (DNS lookup failure) — a much stronger,
   * zero-cost "this is gone" signal than a generic timeout/block, since the
   * whole domain no longer exists rather than just this one page being slow
   * or bot-walled.
   */
  dnsFailed: boolean;
  /** schema.org/JobPosting entries found in the page's JSON-LD, if any. */
  jobPostings: JobPostingSignal[];
}

/**
 * Plain fetch first (cheap, no JS execution). Only falls back to a headless
 * browser render when the plain fetch fails outright or the extracted text
 * isn't viable — i.e. likely a JS-rendered shell or a bot-detection wall that
 * returns something other than the real page to a non-browser client.
 * Returns extracted readable text (not raw HTML) either way, or null if
 * neither attempt produces a viable page — plus the HTTP status of whichever
 * attempt actually got a response, so callers can treat 404/410 as dead
 * without relying on the page's prose.
 */
export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number
): Promise<FetchedPage> {
  if (!isFetchableUrl(url)) {
    return {
      text: null,
      status: null,
      malformed: true,
      pageTitle: null,
      dnsFailed: false,
      jobPostings: [],
    };
  }

  const plain = await fetchPlain(url, timeoutMs);
  if (plain.html) {
    const extracted = extractReadableText(plain.html);
    if (isViableJobDescription(extracted)) {
      return {
        text: extracted,
        status: plain.status,
        malformed: false,
        pageTitle: extractTitleTag(plain.html),
        dnsFailed: false,
        jobPostings: extractJobPostings(plain.html),
      };
    }
  }

  const rendered = await fetchWithBrowser(url, timeoutMs);
  const status = rendered.status ?? plain.status;
  const dnsFailed = plain.failureReason === 'dns' && rendered.failureReason === 'dns';
  if (!rendered.html) {
    return { text: null, status, malformed: false, pageTitle: null, dnsFailed, jobPostings: [] };
  }

  const extracted = extractReadableText(rendered.html);
  return {
    text: isViableJobDescription(extracted) ? extracted : null,
    status,
    dnsFailed,
    malformed: false,
    pageTitle: extractTitleTag(rendered.html),
    jobPostings: extractJobPostings(rendered.html),
  };
}
