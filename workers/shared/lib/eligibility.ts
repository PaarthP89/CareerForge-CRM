import { generateText, LlmRateLimitError } from './llm.js';
import { parseJsonResponse, LlmJsonParseError } from './json.js';

export type EligibilityResult = 'eligible' | 'ineligible' | 'unknown';

export interface EligibilityClassification {
  result: EligibilityResult;
  reason: string | null;
}

// Title-level seniority/leveling signals — a match here means the role targets
// someone with existing full-time experience, regardless of what the JD body says.
const SENIOR_TITLE_SIGNALS = [
  /\b(senior|sr\.?|staff|principal|lead|manager|director|vp|vice president|head of|architect)\b/i,
  /\b(ii|iii|iv|v)\s*$/i,
  /\blevel\s*[2-9]\b/i,
];

const GRAD_TITLE_SIGNALS = [/\bph\.?d\b/i, /\bdoctorate\b/i, /\bpostdoc(toral)?\b/i];

// Requires a specific number of years of prior experience, stated plainly
// enough that no LLM judgment call is needed (e.g. "3+ years of experience",
// "minimum of 2 years experience"). Deliberately does not try to parse
// ranges like "0-2 years" — those are common in genuinely new-grad-friendly
// postings and are left to the LLM fallback to judge in context.
const EXPERIENCE_YEARS_REGEX =
  /\b(\d+)\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|related\s+|work\s+)?experience\b/gi;
const MIN_DISQUALIFYING_YEARS = 2;
// A confident candidate-requirement almost never asks for more than this —
// bigger numbers are ~always company-bio boilerplate ("with over 30 years of
// experience in..."), not a real requirement, so leave those for the LLM to
// read in context instead of hard-disqualifying on the keyword alone.
const MAX_DISQUALIFYING_YEARS = 15;
// Common company-history phrasing that precedes a "X years of experience"
// mention without it being a candidate requirement at all.
const COMPANY_BIO_PRECEDING_REGEX = /\b(with\s+over|has\s+over|boasts(\s+over)?|brings|since)\s*$/i;
const LOOKBEHIND_WINDOW = 20;

// Only fires when the JD explicitly requires an advanced degree and doesn't
// mention "bachelor's" as an acceptable alternative nearby — postings that
// list "Bachelor's, Master's, or PhD" are still open to this candidate.
const GRAD_DEGREE_REQUIRED_REGEX =
  /\b(master'?s|ph\.?d\.?|doctoral)\s+degree\s+(is\s+|are\s+)?required\b/i;
const BACHELOR_MENTION_REGEX = /\bbachelor'?s\b/i;

function titleDisqualifies(title: string): string | null {
  if (GRAD_TITLE_SIGNALS.some((re) => re.test(title))) {
    return 'Title indicates a graduate-level (PhD/postdoc) role';
  }
  if (SENIOR_TITLE_SIGNALS.some((re) => re.test(title))) {
    return 'Title indicates a senior/experienced-level role, not new grad';
  }
  return null;
}

function contentDisqualifies(text: string): string | null {
  const yearsMatches = [...text.matchAll(EXPERIENCE_YEARS_REGEX)];
  for (const match of yearsMatches) {
    const years = parseInt(match[1] as string, 10);
    if (!Number.isFinite(years)) continue;
    if (years < MIN_DISQUALIFYING_YEARS || years > MAX_DISQUALIFYING_YEARS) continue;

    const precedingText = text.slice(
      Math.max(0, (match.index ?? 0) - LOOKBEHIND_WINDOW),
      match.index ?? 0
    );
    if (COMPANY_BIO_PRECEDING_REGEX.test(precedingText)) continue;

    return `Requires ${years}+ years of experience`;
  }

  if (GRAD_DEGREE_REQUIRED_REGEX.test(text) && !BACHELOR_MENTION_REGEX.test(text)) {
    return 'Requires a Master’s/PhD degree, no Bachelor’s alternative mentioned';
  }

  return null;
}

interface LlmEligibilityResponse {
  eligible: boolean;
  reason?: string;
}

async function classifyByLlm(
  text: string,
  title: string,
  company: string
): Promise<EligibilityClassification> {
  const prompt = `A job listing titled "${title}" at "${company}" links to a page. Below is the page's extracted text (truncated).

The candidate is a college student graduating with a Bachelor's degree in December 2026, with internship experience but NO full-time professional work experience. They only want genuine "New Grad" / entry-level-for-graduating-students roles.

Decide whether this specific posting is realistically open to that candidate, or whether it actually targets a different population -- e.g. it requires a Master's/PhD degree, requires several years of prior professional experience, is a senior/staff/lead-level role, or otherwise assumes the candidate already holds a completed degree and a work history well beyond a new grad's.

PAGE TEXT:
"""
${text.slice(0, 4000)}
"""

Respond with ONLY strict JSON, no other text, no markdown fences:
{"eligible": true, "reason": "short reason"} or {"eligible": false, "reason": "short reason"}`;

  try {
    const raw = await generateText(prompt);
    const parsed = parseJsonResponse<LlmEligibilityResponse>(raw);
    if (typeof parsed.eligible === 'boolean') {
      return {
        result: parsed.eligible ? 'eligible' : 'ineligible',
        reason: parsed.reason ?? null,
      };
    }
    return { result: 'unknown', reason: null };
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      console.error(`[eligibility] ${err.message} — classifying as 'unknown' for this listing`);
    } else if (!(err instanceof LlmJsonParseError)) {
      console.error('[eligibility] LLM classification call failed:', err);
    }
    return { result: 'unknown', reason: null };
  }
}

/**
 * Never marks 'ineligible' on mere ambiguity -- only a confident title/keyword
 * signal or an explicit LLM verdict can disqualify a listing. A posting with
 * no fetched text, or one where every layer below is inconclusive, resolves
 * to 'unknown' and is left alone (never auto-trashed), same philosophy as
 * checkListingLiveness.
 *
 * Layers, cheapest/most-certain first:
 *   1. title heuristics    -- free, no fetch needed at all
 *   2. JD keyword heuristics -- free, cheap regex over already-fetched text
 *   3. LLM call            -- only if every free layer above was inconclusive
 *                              and the caller allows it (cost control)
 */
export async function classifyEligibility(
  fetchedText: string | null,
  title: string,
  company: string,
  allowLlm: boolean
): Promise<EligibilityClassification> {
  const titleReason = titleDisqualifies(title);
  if (titleReason) {
    return { result: 'ineligible', reason: titleReason };
  }

  if (!fetchedText) {
    return { result: 'unknown', reason: null };
  }

  const contentReason = contentDisqualifies(fetchedText);
  if (contentReason) {
    return { result: 'ineligible', reason: contentReason };
  }

  if (!allowLlm) {
    return { result: 'unknown', reason: null };
  }

  return classifyByLlm(fetchedText, title, company);
}
