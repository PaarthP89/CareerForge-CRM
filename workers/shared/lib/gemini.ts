import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

const MODEL_NAME = 'gemini-2.5-flash-lite';
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 20_000;

let client: GoogleGenerativeAI | null = null;

// Thrown only after retries (or, for other providers, all available keys) are
// exhausted on a 429, so callers can tell "the LLM said no (quota/rate limit)"
// apart from a generic/network failure instead of both collapsing into the
// same silent 'unknown' classification.
export class LlmRateLimitError extends Error {
  constructor(
    public readonly retryDelayMs: number,
    public readonly dailyQuotaExhausted: boolean,
    cause: unknown,
    provider = 'Gemini'
  ) {
    super(
      dailyQuotaExhausted
        ? `${provider} API quota exhausted (HTTP 429) — will not recover until quota resets, retrying is pointless today`
        : `${provider} API rate limit hit (HTTP 429) after ${MAX_RATE_LIMIT_RETRIES} retries`
    );
    this.cause = cause;
  }
}

function getClient(): GoogleGenerativeAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  client = new GoogleGenerativeAI(apiKey);
  return client;
}

// The server includes a RetryInfo detail with a "31s"-style retryDelay when
// it's a RESOURCE_EXHAUSTED 429 — prefer that over guessing a backoff.
function extractRetryDelayMs(err: GoogleGenerativeAIFetchError): number | null {
  const retryInfo = err.errorDetails?.find(
    (d) => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo')
  );
  const raw = retryInfo?.['retryDelay'];
  if (typeof raw === 'string') {
    const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000);
  }
  return null;
}

// The server's suggested RetryInfo delay (usually tens of seconds) is
// meaningless for a PerDay quota violation — no amount of waiting within this
// process recovers it, so retrying just burns time for a guaranteed repeat
// failure. Only PerMinute/other short-window violations are worth retrying.
function isDailyQuotaViolation(err: GoogleGenerativeAIFetchError): boolean {
  const violations = err.errorDetails?.find(
    (d) => typeof d['@type'] === 'string' && d['@type'].includes('QuotaFailure')
  )?.['violations'];
  if (!Array.isArray(violations)) return false;
  return violations.some(
    (v) => typeof v?.quotaId === 'string' && v.quotaId.includes('PerDay')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateText(prompt: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL_NAME });

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      if (err instanceof GoogleGenerativeAIFetchError && err.status === 429) {
        const retryDelayMs = extractRetryDelayMs(err) ?? DEFAULT_RATE_LIMIT_RETRY_DELAY_MS;

        if (isDailyQuotaViolation(err)) {
          console.error(
            `[gemini] RATE LIMITED (HTTP 429) — daily quota exhausted for this model, skipping retries (won't recover until quota resets)`
          );
          throw new LlmRateLimitError(retryDelayMs, true, err);
        }

        if (attempt < MAX_RATE_LIMIT_RETRIES) {
          console.error(
            `[gemini] RATE LIMITED (HTTP 429) — attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES + 1}, backing off ${retryDelayMs}ms before retrying`
          );
          await sleep(retryDelayMs);
          continue;
        }
        console.error(
          `[gemini] RATE LIMITED (HTTP 429) — out of retries, giving up on this call`
        );
        throw new LlmRateLimitError(retryDelayMs, false, err);
      }
      throw err;
    }
  }
}
