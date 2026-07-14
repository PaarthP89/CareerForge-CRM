// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownTable, extractUrl, extractText, parseDateCell } from '../lib/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('parseMarkdownTable', () => {
  it('returns an array', () => {
    const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
    const rows = parseMarkdownTable(md);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('returns 5 data rows from intern fixture', () => {
    const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
    const rows = parseMarkdownTable(md);
    expect(rows.length).toBe(5);
  });

  it('rows have non-empty company column', () => {
    const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
    const rows = parseMarkdownTable(md);
    const firstRow = rows[0];
    const companyKey = Object.keys(firstRow).find(k => k.includes('company'));
    expect(companyKey).toBeTruthy();
    expect(firstRow[companyKey!].length).toBeGreaterThan(0);
  });

  it('+ extractUrl/extractText handle a real-world HTML-anchor table', () => {
    const md = readFileSync(join(fixturesDir, 'html-anchor-table-sample.md'), 'utf-8');
    const rows = parseMarkdownTable(md);
    expect(rows.length).toBe(2);

    const companyKey = Object.keys(rows[0]).find(k => k.includes('company'));
    const postingKey = Object.keys(rows[0]).find(k => k.includes('posting'));
    expect(companyKey && postingKey).toBeTruthy();

    expect(extractText(rows[0][companyKey!])).toBe('TikTok');
    expect(extractUrl(rows[0][postingKey!])).toBe('https://lifeattiktok.com/search/123');
  });
});

describe('extractUrl', () => {
  it('extracts URL from markdown link syntax', () => {
    expect(extractUrl('[Apply](https://example.com/job/123)')).toBe(
      'https://example.com/job/123'
    );
  });

  it('returns null for plain text with no link', () => {
    expect(extractUrl('No link here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractUrl('')).toBeNull();
  });

  it('extracts href from an HTML anchor cell', () => {
    expect(extractUrl('<a href="https://jobs.acme.com/123"><img src="x.png"/></a>')).toBe(
      'https://jobs.acme.com/123'
    );
  });
});

describe('extractText', () => {
  it('strips nested HTML tags from an anchor cell', () => {
    expect(extractText('<a href="https://acme.com"><strong>Acme Corp</strong></a>')).toBe(
      'Acme Corp'
    );
  });

  it('strips plain-markdown bold wrapping (vanshb03-style cells)', () => {
    expect(extractText('**Uber Technologies, Inc.**')).toBe('Uber Technologies, Inc.');
  });

  it('strips italic and strikethrough markdown wrapping', () => {
    expect(extractText('_Acme Corp_')).toBe('Acme Corp');
    expect(extractText('~~Acme Corp~~')).toBe('Acme Corp');
  });

  it('does not touch internal asterisks that are not a wrapper', () => {
    expect(extractText('R&D * Special Projects')).toBe('R&D * Special Projects');
  });
});

describe('parseDateCell', () => {
  it('parses a relative "Nd" age cell as N days before now', () => {
    const result = parseDateCell('8d');
    expect(result).not.toBeNull();
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() - 8);
    expect(result!.toDateString()).toBe(expected.toDateString());
  });

  it('parses "0d" as today', () => {
    const result = parseDateCell('0d');
    expect(result!.toDateString()).toBe(new Date().toDateString());
  });

  it('parses a yearless "Mon D" date and appends the current year', () => {
    const now = new Date();
    // Pick a month/day comfortably in the past relative to "now" within this year.
    const result = parseDateCell('Jan 02');
    expect(result).not.toBeNull();
    expect(result!.getUTCMonth()).toBe(0);
    expect(result!.getUTCDate()).toBe(2);
    expect(result!.getUTCFullYear()).toBeLessThanOrEqual(now.getUTCFullYear());
  });

  it('rolls a future-looking yearless date back one year (Dec/Jan boundary)', () => {
    const now = new Date();
    const future = new Date(now);
    future.setUTCDate(future.getUTCDate() + 5);
    const label = future.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const day = future.getUTCDate();
    const result = parseDateCell(`${label} ${day}`);
    expect(result).not.toBeNull();
    // Should never resolve to more than a day in the future.
    expect(result!.getTime()).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
  });

  it('returns null for garbage text (does not fall into Date\'s lenient parsing)', () => {
    expect(parseDateCell('garbage')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseDateCell('')).toBeNull();
    expect(parseDateCell('   ')).toBeNull();
  });

  it('returns null for "N/A" and "-"', () => {
    expect(parseDateCell('N/A')).toBeNull();
    expect(parseDateCell('-')).toBeNull();
  });

  it('parses a genuine ISO date string', () => {
    const result = parseDateCell('2026-01-15');
    expect(result).not.toBeNull();
    expect(result!.getUTCFullYear()).toBe(2026);
  });
});

// --- SimplifyJobs filter logic ---

interface SimplifyFixtureItem {
  company_name: string;
  title: string;
  url: string;
  active: boolean;
  is_visible: boolean;
  terms?: string[];
  date_posted?: number | null;
}

describe('SimplifyJobs filter logic', () => {
  it('keeps only active+visible+Fall2026 rows', () => {
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, 'simplify-sample.json'), 'utf-8')
    ) as SimplifyFixtureItem[];

    const filtered = raw.filter(
      item =>
        item.active === true &&
        item.is_visible === true &&
        Array.isArray(item.terms) &&
        item.terms.some(t => t.includes('Fall 2026'))
    );

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(raw.length);

    for (const item of filtered) {
      expect(item.active).toBe(true);
      expect(item.is_visible).toBe(true);
      expect(item.terms!.some(t => t.includes('Fall 2026'))).toBe(true);
    }
  });

  it('rejects inactive rows', () => {
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, 'simplify-sample.json'), 'utf-8')
    ) as SimplifyFixtureItem[];

    const filtered = raw.filter(
      item =>
        item.active === true &&
        item.is_visible === true &&
        Array.isArray(item.terms) &&
        item.terms.some(t => t.includes('Fall 2026'))
    );

    expect(filtered.every(item => item.active)).toBe(true);
  });
});
