// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { launchMock } = vi.hoisted(() => ({ launchMock: vi.fn() }));
vi.mock('playwright', () => ({
  chromium: { launch: launchMock },
}));

import {
  extractReadableText,
  extractTitleTag,
  isViableJobDescription,
  isFetchableUrl,
  fetchTextWithTimeout,
  closeBrowser,
} from '../html.js';

function jsonLdScript(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

function htmlPage(body: string, opts: { title?: string; jsonLd?: unknown } = {}): string {
  const titleTag = opts.title ? `<title>${opts.title}</title>` : '';
  const ld = opts.jsonLd ? jsonLdScript(opts.jsonLd) : '';
  return `<html><head>${titleTag}${ld}</head><body>${body}</body></html>`;
}

const VIABLE_TEXT = `<p>${'We are hiring a Backend Engineer to join our platform team. '.repeat(6)}</p>`;

interface FakePageOptions {
  gotoResponse?: { status: () => number } | null;
  gotoError?: unknown;
  html?: string;
  networkIdleError?: unknown;
}

function fakePage(opts: FakePageOptions = {}) {
  return {
    goto: vi.fn(async () => {
      if (opts.gotoError) throw opts.gotoError;
      return opts.gotoResponse ?? null;
    }),
    waitForLoadState: vi.fn(async () => {
      if (opts.networkIdleError) throw opts.networkIdleError;
    }),
    content: vi.fn(async () => opts.html ?? ''),
  };
}

function fakeBrowserFor(page: ReturnType<typeof fakePage>) {
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  return {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
}

describe('extractReadableText', () => {
  it('strips scripts, styles, and comments, decodes entities, and collapses whitespace', () => {
    const html = `
      <html>
        <head><style>.a { color: red; }</style></head>
        <body>
          <script>var x = 1;</script>
          <!-- a comment -->
          <p>Hello &amp; welcome   to   Acme&nbsp;Corp.</p>
        </body>
      </html>`;
    expect(extractReadableText(html)).toBe('Hello & welcome to Acme Corp.');
  });

  it('truncates to the max extracted length', () => {
    const long = 'a'.repeat(25_000);
    expect(extractReadableText(`<p>${long}</p>`).length).toBe(20_000);
  });
});

describe('extractTitleTag', () => {
  it('extracts and decodes the title tag', () => {
    expect(
      extractTitleTag('<html><head><title>Backend Engineer &amp; SRE</title></head></html>')
    ).toBe('Backend Engineer & SRE');
  });

  it('returns null when there is no title tag', () => {
    expect(extractTitleTag('<html><head></head></html>')).toBeNull();
  });

  it('returns null for a whitespace-only title tag', () => {
    expect(extractTitleTag('<title>   </title>')).toBeNull();
  });
});

describe('isViableJobDescription', () => {
  it('requires at least the minimum viable length', () => {
    expect(isViableJobDescription('short')).toBe(false);
    expect(isViableJobDescription('x'.repeat(200))).toBe(true);
  });

  it('rejects a long-enough bot-block page as not viable', () => {
    const akamaiBlock =
      'Access Denied Access Denied You don\'t have permission to access this on this server. ' +
      'Reference #18.cdab3717.1784076420.24f973c2 https://errors.edgesuite.net/18.cdab3717.1784076420.24f973c2'.repeat(3);
    expect(akamaiBlock.length).toBeGreaterThanOrEqual(200);
    expect(isViableJobDescription(akamaiBlock)).toBe(false);
  });

  it('rejects a long-enough client-rendered shell that never executed JS', () => {
    const jsShell =
      'Careers at Acme Store Mac iPad Please enable Javascript in your browser for best experience. '.repeat(3);
    expect(jsShell.length).toBeGreaterThanOrEqual(200);
    expect(isViableJobDescription(jsShell)).toBe(false);
  });

  it('rejects a Cloudflare interstitial', () => {
    const cloudflare = 'Attention Required! | Cloudflare '.repeat(10);
    expect(cloudflare.length).toBeGreaterThanOrEqual(200);
    expect(isViableJobDescription(cloudflare)).toBe(false);
  });

  it('still accepts long real content with no bot-block signals', () => {
    const real =
      'Software Engineer Intern. Responsibilities include building distributed systems and writing tests. '.repeat(3);
    expect(isViableJobDescription(real)).toBe(true);
  });
});

describe('isFetchableUrl', () => {
  it('accepts well-formed http(s) URLs', () => {
    expect(isFetchableUrl('https://example.com/jobs/1')).toBe(true);
    expect(isFetchableUrl('http://example.com')).toBe(true);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isFetchableUrl('ftp://example.com')).toBe(false);
    expect(isFetchableUrl('mailto:a@example.com')).toBe(false);
  });

  it('rejects a single-slash malformed URL the WHATWG parser would otherwise "fix"', () => {
    expect(isFetchableUrl('https:/.workable.com/jobs/1')).toBe(false);
  });

  it('rejects unparseable strings', () => {
    expect(isFetchableUrl('not a url')).toBe(false);
  });
});

describe('fetchTextWithTimeout', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    launchMock.mockReset();
  });

  afterEach(async () => {
    await closeBrowser();
    vi.unstubAllGlobals();
  });

  it('returns malformed for an unfetchable URL without attempting any fetch', async () => {
    const result = await fetchTextWithTimeout('not a url', 5000);
    expect(result).toMatchObject({ malformed: true, text: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('returns extracted text from a viable plain fetch without falling back to the browser', async () => {
    const html = htmlPage(VIABLE_TEXT, { title: 'Backend Engineer at Acme' });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html });

    const result = await fetchTextWithTimeout('https://acme.example.com/jobs/1', 5000);

    expect(result.malformed).toBe(false);
    expect(result.status).toBe(200);
    expect(result.pageTitle).toBe('Backend Engineer at Acme');
    expect(result.text).toContain('We are hiring a Backend Engineer');
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('extracts schema.org JobPosting signals from the plain-fetched HTML', async () => {
    const html = htmlPage(VIABLE_TEXT, {
      jsonLd: { '@type': 'JobPosting', title: 'Backend Engineer', hiringOrganization: { name: 'Acme' } },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html });

    const result = await fetchTextWithTimeout('https://acme.example.com/jobs/1', 5000);

    expect(result.jobPostings).toEqual([{ title: 'Backend Engineer', organizationName: 'Acme' }]);
  });

  it('falls back to the browser when the plain-fetched text is too short to be viable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<div id="root"></div>' });
    const renderedHtml = htmlPage(VIABLE_TEXT, { title: 'Backend Engineer — Acme' });
    const page = fakePage({ gotoResponse: { status: () => 200 }, html: renderedHtml });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(result.text).toContain('We are hiring a Backend Engineer');
    expect(result.pageTitle).toBe('Backend Engineer — Acme');
    expect(result.status).toBe(200);
  });

  it('falls back to the browser when the plain fetch throws outright', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('network down'), { name: 'FetchError' }));
    const renderedHtml = htmlPage(VIABLE_TEXT);
    const page = fakePage({ gotoResponse: { status: () => 200 }, html: renderedHtml });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(result.text).not.toBeNull();
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null text when both the plain fetch and the browser fallback produce non-viable content', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<div id="root"></div>' });
    const page = fakePage({ gotoResponse: { status: () => 200 }, html: '<div id="root"></div>' });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(result.text).toBeNull();
    expect(result.status).toBe(200);
  });

  it('propagates a 404 status through to the caller even after the browser fallback runs', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' });
    const page = fakePage({ gotoResponse: { status: () => 404 }, html: '<p>Not found</p>' });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(result.status).toBe(404);
    expect(result.text).toBeNull();
  });

  it('falls back to the plain-fetch status when the browser navigation itself fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, text: async () => '' });
    const page = fakePage({ gotoError: new Error('net::ERR_CONNECTION_REFUSED') });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(result.status).toBe(410);
    expect(result.text).toBeNull();
  });

  it('sets dnsFailed only when both the plain fetch and browser navigation see a DNS failure', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { cause: { code: 'ENOTFOUND' } })
    );
    const page = fakePage({ gotoError: new Error('net::ERR_NAME_NOT_RESOLVED at https://gone.example.com/') });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://gone.example.com/jobs/1', 5000);

    expect(result.dnsFailed).toBe(true);
    expect(result.text).toBeNull();
  });

  it('does not set dnsFailed when only one of the two attempts sees a DNS failure', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { cause: { code: 'ENOTFOUND' } })
    );
    const page = fakePage({ gotoError: new Error('Timeout 5000ms exceeded') });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://flaky.example.com/jobs/1', 5000);

    expect(result.dnsFailed).toBe(false);
  });

  it('uses whatever rendered content is available when waiting for networkidle times out', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<div id="root"></div>' });
    const renderedHtml = htmlPage(VIABLE_TEXT);
    const page = fakePage({
      gotoResponse: { status: () => 200 },
      html: renderedHtml,
      networkIdleError: new Error('Timeout 5000ms exceeded waiting for networkidle'),
    });
    launchMock.mockResolvedValue(fakeBrowserFor(page));

    const result = await fetchTextWithTimeout('https://acme.example.com/careers/1', 5000);

    expect(result.text).toContain('We are hiring a Backend Engineer');
  });
});
