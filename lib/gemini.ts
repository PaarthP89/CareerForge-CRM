import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateText as groqGenerateText, isGroqAvailable } from './groq';

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

export function isLlmAvailable(): boolean {
  return isGroqAvailable() || Boolean(process.env.GEMINI_API_KEY);
}

async function generateTextGemini(prompt: string): Promise<string> {
  const model = getClient().getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Groq takes priority whenever configured -- it's a pool of keys rather than
// a single per-project quota, so it survives the concurrent-batch scoring in
// the /api/resume/match routes better than Gemini's free tier does.
export async function generateText(prompt: string): Promise<string> {
  if (isGroqAvailable()) {
    return groqGenerateText(prompt);
  }
  return generateTextGemini(prompt);
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
