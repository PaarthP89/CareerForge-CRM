import { fetchText } from '../lib/fetch.js';
import { extractUrl, parseMarkdownTable } from '../lib/markdown.js';
import type { RawListing } from '../types.js';

const README_URL =
  'https://raw.githubusercontent.com/vanshb03/New-Grad-2027/main/README.md';

function extractText(cell: string): string | null {
  const match = cell.match(/\[([^\]]+)\]/);
  if (match) return match[1].trim() || null;
  const trimmed = cell.trim();
  return trimmed || null;
}

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
      k => k.includes('apply') || k.includes('link') || k.includes('url')
    );

    const company = companyKey ? extractText(row[companyKey]) : null;
    const title = titleKey ? extractText(row[titleKey]) : null;

    let url: string | null = null;
    if (linkKey) url = extractUrl(row[linkKey]);
    if (!url) {
      for (const val of Object.values(row)) {
        url = extractUrl(val);
        if (url) break;
      }
    }

    if (!company || !title || !url) continue;

    const dateKey = keys.find(k => k.includes('date'));
    let postedAt: Date | null = null;
    if (dateKey && row[dateKey]) {
      const parsed = new Date(row[dateKey]);
      if (!isNaN(parsed.getTime())) postedAt = parsed;
    }

    listings.push({ company, title, url, postedAt, stream: 'new_grad' });
  }

  return listings;
}
