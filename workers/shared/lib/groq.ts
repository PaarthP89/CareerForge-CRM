import { LlmRateLimitError } from './gemini.js';

const MODEL_NAME = 'llama-3.1-8b-instant';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

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
    throw Object.assign(new Error('Groq rate limited'), { rateLimited: true });
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

// Round-robins across all configured keys so one key's per-minute/per-day cap
// doesn't stall the whole run -- only gives up once every key has failed for
// this call.
export async function generateText(prompt: string): Promise<string> {
  const all = getKeys();
  if (all.length === 0) {
    throw new Error('GROQ_API_KEYS is not set');
  }

  let lastErr: unknown = null;
  for (let i = 0; i < all.length; i++) {
    const key = all[nextKeyIndex % all.length];
    nextKeyIndex++;
    try {
      return await callWithKey(key, prompt);
    } catch (err) {
      lastErr = err;
      const rateLimited = err instanceof Error && (err as { rateLimited?: boolean }).rateLimited;
      console.error(
        `[groq] key ${i + 1}/${all.length} ${rateLimited ? 'rate limited (429)' : 'failed'}, ${
          i < all.length - 1 ? 'rotating to next key' : 'no keys left'
        }`
      );
    }
  }

  throw new LlmRateLimitError(20_000, true, lastErr, 'Groq');
}
