import { generateText as geminiGenerateText, LlmRateLimitError } from './gemini.js';
import { generateText as groqGenerateText, isGroqAvailable } from './groq.js';

export { LlmRateLimitError };

export function isLlmAvailable(): boolean {
  return isGroqAvailable() || Boolean(process.env.GEMINI_API_KEY);
}

// Groq takes priority whenever configured -- it's a pool of keys rather than
// a single quota, so it's the better default once GROQ_API_KEYS is set.
export async function generateText(prompt: string): Promise<string> {
  if (isGroqAvailable()) {
    return groqGenerateText(prompt);
  }
  return geminiGenerateText(prompt);
}
