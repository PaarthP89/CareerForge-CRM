import { fetchText } from '../lib/fetch.js';
import { extractText, extractUrl, parseDateCell, parseMarkdownTable } from '../lib/markdown.js';
import type { RawListing } from '../types.js';

// USA internship listings were consolidated into README.md (FAANG+/Quant/Other
// sections) — the old standalone INTERN_USA.md file no longer exists upstream.
const INTERN_URL =
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/README.md';
const NEW_GRAD_URL =
  'https://raw.githubusercontent.com/speedyapply/2026-SWE-College-Jobs/main/NEW_GRAD_USA.md';

function rowToListing(
  row: Record<string, string>,
  stream: 'internship' | 'new_grad'
): RawListing | null {
  const keys = Object.keys(row);

  const companyKey = keys.find(k => k.includes('company'));
  const titleKey = keys.find(
    k => k.includes('role') || k.includes('title') || k.includes('position')
  );
  const linkKey = keys.find(
    k =>
      k.includes('apply') ||
      k.includes('link') ||
      k.includes('url') ||
      k.includes('posting')
  );
  // This source's date column is headed "Age" (relative days-ago, e.g. "8d"),
  // not "Date" — falls back to any 'date'-named column for other layouts.
  const dateKey = keys.find(k => k.includes('age')) ?? keys.find(k => k.includes('date'));

  const company = companyKey ? extractText(row[companyKey]) : null;
  const title = titleKey ? extractText(row[titleKey]) : null;

  let url: string | null = null;
  if (linkKey) url = extractUrl(row[linkKey]);
  if (!url) {
    // Never fall back onto the Company/Title/Date columns — those often carry
    // their own <a> link (e.g. the company's homepage), which would otherwise
    // get mistaken for the actual apply link.
    const skipKeys = new Set(
      [companyKey, titleKey, dateKey].filter((k): k is string => Boolean(k))
    );
    for (const [key, val] of Object.entries(row)) {
      if (skipKeys.has(key)) continue;
      url = extractUrl(val);
      if (url) break;
    }
  }

  if (!company || !title || !url) return null;

  const postedAt = dateKey && row[dateKey] ? parseDateCell(row[dateKey]) : null;

  return { company, title, url, postedAt, stream };
}

function hasFallFilterableColumn(headers: string[]): boolean {
  return headers.some(
    k =>
      k.includes('role') ||
      k.includes('title') ||
      k.includes('position') ||
      k.includes('term') ||
      k.includes('season')
  );
}

function matchesFall(row: Record<string, string>, keys: string[]): boolean {
  const relevant = keys.filter(
    k =>
      k.includes('role') ||
      k.includes('title') ||
      k.includes('position') ||
      k.includes('term') ||
      k.includes('season')
  );
  return relevant.some(k => {
    const val = (row[k] ?? '').toLowerCase();
    return val.includes('fall 2026') || val.includes('fall');
  });
}

export async function fetchSpeedyApply(): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  const internText = await fetchText(INTERN_URL);
  const internRows = parseMarkdownTable(internText);

  if (internRows.length === 0) {
    console.warn('[scraper:speedyapply] 0 rows parsed from README.md (internships)');
  } else {
    const headers = Object.keys(internRows[0]);
    const canFilter = hasFallFilterableColumn(headers);
    if (!canFilter) {
      console.warn(
        '[scraper:speedyapply] Term filtering not possible for README.md — including all rows'
      );
    }
    for (const row of internRows) {
      if (canFilter && !matchesFall(row, headers)) continue;
      const listing = rowToListing(row, 'internship');
      if (listing) listings.push(listing);
    }
  }

  const newGradText = await fetchText(NEW_GRAD_URL);
  const newGradRows = parseMarkdownTable(newGradText);

  if (newGradRows.length === 0) {
    console.warn('[scraper:speedyapply] 0 rows parsed from NEW_GRAD_USA.md');
  } else {
    for (const row of newGradRows) {
      const listing = rowToListing(row, 'new_grad');
      if (listing) listings.push(listing);
    }
  }

  return listings;
}
