export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    let suffix = '';
    if (res.status === 403 || res.status === 429) {
      suffix =
        ' — possible GitHub rate limit — worker runs once daily, this should not occur in normal operation';
    }
    throw new Error(`[scraper] HTTP ${res.status} fetching ${url}${suffix}`);
  }
  return res.text();
}
