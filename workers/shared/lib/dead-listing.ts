import { generateText } from './llm.js';
import { parseJsonResponse, LlmJsonParseError } from './json.js';
import { isViableJobDescription } from './html.js';

export type LivenessResult = 'dead' | 'alive' | 'unknown';

// High-confidence "this listing is gone" phrasing — a hit here is dead, no LLM needed.
const DEAD_KEYWORDS = [
  /no longer accepting applications/i,
  /position has been filled/i,
  /this job is no longer available/i,
  /this posting has (expired|closed)/i,
  /requisition has been closed/i,
  /vacancy (is |has been )?closed/i,
  /job (posting )?has been removed/i,
  /page not found/i,
  /job not found/i,
  /this job (is no longer|has expired)/i,
];

// Softer phrasing that's suggestive but not conclusive — worth an LLM check
// rather than a blind classification either way.
const SOFT_AMBIGUOUS_SIGNALS = [
  /not currently accepting/i,
  /check back (later|soon)/i,
  /similar jobs/i,
  /this role may (no longer|not) be available/i,
  /archived/i,
];

function looksDeadByKeyword(text: string): boolean {
  return DEAD_KEYWORDS.some((re) => re.test(text));
}

function looksAmbiguous(text: string): boolean {
  return SOFT_AMBIGUOUS_SIGNALS.some((re) => re.test(text));
}

interface LlmLivenessResponse {
  status: 'dead' | 'alive';
}

async function checkLivenessByLlm(
  text: string,
  title: string,
  company: string
): Promise<LivenessResult> {
  const prompt = `A job listing for "${title}" at "${company}" links to a page. Below is the page's extracted text (truncated).

Decide: is this listing still open for applications ("alive"), or has it closed/expired/been filled/been removed ("dead")?

PAGE TEXT:
"""
${text.slice(0, 4000)}
"""

Respond with ONLY strict JSON, no other text, no markdown fences:
{"status": "alive"} or {"status": "dead"}`;

  try {
    const raw = await generateText(prompt);
    const parsed = parseJsonResponse<LlmLivenessResponse>(raw);
    if (parsed.status === 'dead' || parsed.status === 'alive') {
      return parsed.status;
    }
    return 'unknown';
  } catch (err) {
    if (!(err instanceof LlmJsonParseError)) {
      console.error('[dead-listing] LLM liveness call failed:', err);
    }
    return 'unknown';
  }
}

/**
 * Never returns 'dead' on a fetch failure or JS-walled/blocked page — only a
 * confident keyword or LLM signal can mark a listing dead. Ambiguity always
 * resolves toward 'unknown'/'alive', never toward removal.
 */
export async function checkListingLiveness(
  fetchedText: string | null,
  title: string,
  company: string,
  allowLlm: boolean
): Promise<LivenessResult> {
  if (!fetchedText || !isViableJobDescription(fetchedText)) {
    return 'unknown';
  }

  if (looksDeadByKeyword(fetchedText)) {
    return 'dead';
  }

  if (!looksAmbiguous(fetchedText)) {
    return 'alive';
  }

  if (!allowLlm) return 'unknown';

  return checkLivenessByLlm(fetchedText, title, company);
}
