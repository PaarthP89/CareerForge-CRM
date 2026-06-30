import { fetchText } from '../lib/fetch.js';
import type { RawListing } from '../types.js';

const LISTINGS_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';

interface SimplifyItem {
  company_name: string;
  title: string;
  url: string;
  active: boolean;
  is_visible: boolean;
  date_posted?: number | null;
}

export async function fetchSimplifyNewGrad(): Promise<RawListing[]> {
  const text = await fetchText(LISTINGS_URL);
  const data = JSON.parse(text) as SimplifyItem[];

  return data
    .filter(item => item.active === true && item.is_visible === true)
    .map(item => ({
      company: item.company_name,
      title: item.title,
      url: item.url,
      postedAt: item.date_posted ? new Date(item.date_posted * 1000) : null,
      stream: 'new_grad' as const,
    }));
}
