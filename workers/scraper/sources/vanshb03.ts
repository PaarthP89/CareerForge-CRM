import { fetchText } from '../lib/fetch.js';
import { extractText, extractUrl, parseDateCell, parseMarkdownTable } from '../lib/markdown.js';
import type { RawListing } from '../types.js';

const README_URL =
  'https://raw.githubusercontent.com/vanshb03/New-Grad-2027/main/README.md';

export async function fetchVanshb03(): Promise<RawListing[]> {
  const text = await fetchText(README_URL);
  const rows = parseMarkdownTable(text);

  if (rows.length === 0) {
    console.warn('[scraper:vanshb03] 0 rows parsed from README.md');
    return [];
  }

  const listings: RawListing[] = [];

  for (const row of rows) {
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
    const dateKey = keys.find(k => k.includes('date'));

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

    if (!company || !title || !url) continue;

    const postedAt = dateKey && row[dateKey] ? parseDateCell(row[dateKey]) : null;

    listings.push({ company, title, url, postedAt, stream: 'new_grad' });
  }

  return listings;
}
