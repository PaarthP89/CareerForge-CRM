import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_NAME = 'gemini-2.0-flash';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  client = new GoogleGenerativeAI(apiKey);
  return client;
}

export async function generateText(prompt: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export class GeminiJsonParseError extends Error {
  constructor(public readonly raw: string, cause: unknown) {
    super('Failed to parse Gemini response as JSON');
    this.cause = cause;
  }
}

export function parseJsonResponse<T>(raw: string): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(stripped) as T;
  } catch (cause) {
    throw new GeminiJsonParseError(raw, cause);
  }
}
