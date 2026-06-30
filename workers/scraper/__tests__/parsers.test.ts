import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdownTable, extractUrl } from '../lib/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

// --- Test group 1: parseMarkdownTable ---

test('parseMarkdownTable returns an array', () => {
  const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
  const rows = parseMarkdownTable(md);
  assert.ok(Array.isArray(rows));
});

test('parseMarkdownTable returns 5 data rows from intern fixture', () => {
  const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
  const rows = parseMarkdownTable(md);
  assert.strictEqual(rows.length, 5);
});

test('parseMarkdownTable rows have non-empty company column', () => {
  const md = readFileSync(join(fixturesDir, 'speedyapply-intern-sample.md'), 'utf-8');
  const rows = parseMarkdownTable(md);
  const firstRow = rows[0];
  const companyKey = Object.keys(firstRow).find(k => k.includes('company'));
  assert.ok(companyKey, 'Expected a company-like column header');
  assert.ok(firstRow[companyKey].length > 0, 'Expected non-empty company cell');
});

// --- Test group 2: extractUrl ---

test('extractUrl extracts URL from markdown link syntax', () => {
  assert.strictEqual(
    extractUrl('[Apply](https://example.com/job/123)'),
    'https://example.com/job/123'
  );
});

test('extractUrl returns null for plain text with no link', () => {
  assert.strictEqual(extractUrl('No link here'), null);
});

test('extractUrl returns null for empty string', () => {
  assert.strictEqual(extractUrl(''), null);
});

// --- Test group 3: SimplifyJobs filter logic ---

interface SimplifyFixtureItem {
  company_name: string;
  title: string;
  url: string;
  active: boolean;
  is_visible: boolean;
  terms?: string[];
  date_posted?: number | null;
}

test('SimplifyJobs filter keeps only active+visible+Fall2026 rows', () => {
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

  assert.ok(filtered.length > 0, 'Expected at least one passing row');
  assert.ok(filtered.length < raw.length, 'Expected some rows to be filtered out');

  for (const item of filtered) {
    assert.ok(item.active, 'Filtered item must be active');
    assert.ok(item.is_visible, 'Filtered item must be visible');
    assert.ok(
      Array.isArray(item.terms) && item.terms.some(t => t.includes('Fall 2026')),
      'Filtered item must have Fall 2026 term'
    );
  }
});

test('SimplifyJobs filter rejects inactive rows', () => {
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

  const inactiveInFiltered = filtered.filter(item => !item.active);
  assert.strictEqual(inactiveInFiltered.length, 0, 'No inactive rows should pass the filter');
});
