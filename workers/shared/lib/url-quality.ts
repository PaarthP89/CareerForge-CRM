import { generateText } from './llm.js';
import { parseJsonResponse, LlmJsonParseError } from './json.js';

export type UrlQuality = 'direct' | 'generic' | 'unknown';

// Layer 1: known ATS platforms. A match here is a high-confidence "direct posting"
// signal without needing to fetch anything.
const ATS_HOST_SUFFIXES = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
  'icims.com',
  'jobs.jobvite.com',
  'apply.workable.com',
  'breezy.hr',
  'bamboohr.com',
  'oraclecloud.com',
  'paylocity.com',
  'paycomonline.com',
  'successfactors.com',
  'taleo.net',
  'ultipro.com',
  'jazzhr.com',
  'recruitee.com',
  'personio.com',
  'teamtailor.com',
  'metacareers.com',
  'amazon.jobs',
];

// Layer 2: cheap keyword heuristics on fetched page text (no LLM).
const DIRECT_SIGNALS = [
  /apply\s+(now|today|for this (job|position|role))/i,
  /submit\s+(your\s+)?application/i,
  /upload\s+(your\s+)?(resume|cv)/i,
  /cover\s+letter/i,
];

const GENERIC_SIGNALS = [
  /browse\s+all\s+(jobs|openings|positions)/i,
  /search\s+(open\s+)?(jobs|positions|openings)/i,
  /view\s+all\s+(jobs|openings|positions)/i,
  /join\s+our\s+talent\s+(community|network)/i,
  /life\s+at\s+/i,
  /our\s+culture/i,
];

function classifyByHost(url: string): UrlQuality {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
  if (ATS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 'direct';
  }
  return 'unknown';
}

function classifyByContent(text: string): UrlQuality {
  const directHits = DIRECT_SIGNALS.filter((re) => re.test(text)).length;
  const genericHits = GENERIC_SIGNALS.filter((re) => re.test(text)).length;

  if (directHits > 0 && directHits >= genericHits) return 'direct';
  if (genericHits > 0 && genericHits > directHits) return 'generic';
  return 'unknown';
}

interface LlmUrlQualityResponse {
  quality: 'direct' | 'generic';
}

async function classifyByLlm(
  text: string,
  title: string,
  company: string
): Promise<UrlQuality> {
  const prompt = `A job listing for "${title}" at "${company}" links to a page. Below is the page's extracted text (truncated).

Decide: is this page a SPECIFIC application/posting page for this exact role ("direct"), or a GENERIC company careers/jobs landing page, search page, or homepage that is not specific to this role ("generic")?

PAGE TEXT:
"""
${text.slice(0, 4000)}
"""

Respond with ONLY strict JSON, no other text, no markdown fences:
{"quality": "direct"} or {"quality": "generic"}`;

  try {
    const raw = await generateText(prompt);
    const parsed = parseJsonResponse<LlmUrlQualityResponse>(raw);
    if (parsed.quality === 'direct' || parsed.quality === 'generic') {
      return parsed.quality;
    }
    return 'unknown';
  } catch (err) {
    if (!(err instanceof LlmJsonParseError)) {
      console.error('[url-quality] LLM classification call failed:', err);
    }
    return 'unknown';
  }
}

/**
 * Layered classification: free host check first, then cheap keyword heuristics
 * on already-fetched text, then an LLM call only if both prior layers are
 * inconclusive and the caller allows it (cost control).
 */
export async function classifyUrlQuality(
  url: string,
  fetchedText: string | null,
  title: string,
  company: string,
  allowLlm: boolean
): Promise<UrlQuality> {
  const hostResult = classifyByHost(url);
  if (hostResult === 'direct') return 'direct';

  if (!fetchedText) return 'unknown';

  const contentResult = classifyByContent(fetchedText);
  if (contentResult !== 'unknown') return contentResult;

  if (!allowLlm) return 'unknown';

  return classifyByLlm(fetchedText, title, company);
}
