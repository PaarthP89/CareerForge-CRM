import { significantWords } from './dead-listing.js';

export interface JobPostingSignal {
  title: string | null;
  organizationName: string | null;
}

function collectJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD is common in the wild (trailing commas, HTML
      // comments left inside the block by some CMSes) — just skip it.
    }
  }
  return blocks;
}

function flattenJsonLdNodes(blocks: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      nodes.push(obj);
      if (Array.isArray(obj['@graph'])) visit(obj['@graph']);
    }
  };
  blocks.forEach(visit);
  return nodes;
}

function isJobPostingNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === 'JobPosting';
  if (Array.isArray(type)) return type.includes('JobPosting');
  return false;
}

function extractOrgName(node: Record<string, unknown>): string | null {
  const org = node['hiringOrganization'];
  if (typeof org === 'string') return org;
  if (org && typeof org === 'object') {
    const name = (org as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return null;
}

/**
 * Most ATS platforms (Greenhouse, Lever, Workday, etc.) embed
 * schema.org/JobPosting structured data on real posting pages for SEO —
 * a page's <script type="application/ld+json"> almost never appears on a
 * generic careers-homepage/search page, so finding one (and matching it
 * to the listing we're checking) is a strong, free, no-LLM "direct"
 * signal. Must run against raw HTML — extractReadableText strips <script>
 * tags entirely, so this can never work on already-extracted body text.
 */
export function extractJobPostings(html: string): JobPostingSignal[] {
  const nodes = flattenJsonLdNodes(collectJsonLdBlocks(html));
  return nodes.filter(isJobPostingNode).map((node) => ({
    title: typeof node['title'] === 'string' ? (node['title'] as string) : null,
    organizationName: extractOrgName(node),
  }));
}

/**
 * True only if at least one extracted JobPosting shares a distinguishing
 * word with the listing's title/company — guards against landing on an
 * aggregator/listings page that embeds JobPosting JSON-LD for many
 * unrelated roles at once.
 */
export function matchesJobPosting(
  postings: JobPostingSignal[],
  title: string,
  company: string
): boolean {
  const expected = new Set([...significantWords(title), ...significantWords(company)]);
  if (expected.size === 0) return false;

  return postings.some((posting) => {
    const words = new Set([
      ...(posting.title ? significantWords(posting.title) : []),
      ...(posting.organizationName ? significantWords(posting.organizationName) : []),
    ]);
    return [...expected].some((w) => words.has(w));
  });
}
