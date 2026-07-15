import { LlmRateLimitError } from './gemini';

const MODEL_NAME = 'llama-3.1-8b-instant';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_KEY_PASSES = 3;
const MAX_BACKOFF_MS = 15_000;
const DEFAULT_BACKOFF_MS = 3_000;

let keys: string[] | null = null;
let nextKeyIndex = 0;

function getKeys(): string[] {
  if (keys) return keys;
  const raw = process.env.GROQ_API_KEYS ?? '';
  keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  return keys;
}

export function isGroqAvailable(): boolean {
  return getKeys().length > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Groq's 429 body includes a precise "Please try again in 1.09s" hint (each
// org's TPM window is 60s, so this is usually far more useful than a flat
// backoff) -- the retry-after header only gives whole seconds, so prefer the
// body when present.
function extractRetryDelayMs(retryAfterHeader: string | null, body: string): number {
  const bodyMatch = body.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (bodyMatch) return Math.ceil(parseFloat(bodyMatch[1]) * 1000);

  if (retryAfterHeader) {
    const secs = parseFloat(retryAfterHeader);
    if (!Number.isNaN(secs)) return Math.ceil(secs * 1000);
  }

  return DEFAULT_BACKOFF_MS;
}

// llama-3.1-8b-instant is unreliable at producing syntactically valid JSON on
// its own (observed live: batches truncating mid-array with no closing
// bracket) -- Groq's server-side json_object mode uses constrained decoding
// to guarantee valid JSON syntax. It requires (a) the word "json" somewhere
// in the prompt and (b) a top-level JSON *object*, not a bare array.
async function callWithKey(key: string, prompt: string): Promise<string> {
  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (res.status === 429) {
    const body = await res.text();
    const retryDelayMs = Math.min(
      extractRetryDelayMs(res.headers.get('retry-after'), body),
      MAX_BACKOFF_MS
    );
    throw Object.assign(new Error(`Groq rate limited: ${body.slice(0, 200)}`), {
      rateLimited: true,
      retryDelayMs,
    });
  }
  if (!res.ok) {
    throw new Error(`Groq API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('Groq response missing choices[0].message.content');
  }
  return text;
}

// Round-robins across all configured keys, backing off by the server's
// suggested delay on a 429 before the next attempt -- each key's TPM budget
// is independent, but the *aggregate* throughput across all keys is still
// bounded, so immediately hammering the next key on failure just burns
// through the whole pool in seconds instead of pacing against what it can
// actually sustain. Runs up to MAX_KEY_PASSES full loops over the key list,
// since a single pass may not be enough time for the earliest keys to
// recover.
export async function generateText(prompt: string): Promise<string> {
  const all = getKeys();
  if (all.length === 0) {
    throw new Error('GROQ_API_KEYS is not set');
  }

  let lastErr: unknown = null;
  for (let pass = 0; pass < MAX_KEY_PASSES; pass++) {
    for (let i = 0; i < all.length; i++) {
      const key = all[nextKeyIndex % all.length];
      nextKeyIndex++;
      try {
        return await callWithKey(key, prompt);
      } catch (err) {
        lastErr = err;
        const rateLimited = err instanceof Error && (err as { rateLimited?: boolean }).rateLimited;
        if (rateLimited) {
          const delayMs = (err as { retryDelayMs?: number }).retryDelayMs ?? DEFAULT_BACKOFF_MS;
          console.error(`[groq] rate limited, waiting ${delayMs}ms before next attempt`);
          await sleep(delayMs);
        } else {
          console.error('[groq] key failed (non-rate-limit):', err instanceof Error ? err.message : err);
        }
      }
    }
  }

  throw new LlmRateLimitError(20_000, true, lastErr, 'Groq');
}
