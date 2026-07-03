import { generateText as geminiGenerateText } from './gemini.js';

export function isLlmAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function generateText(prompt: string): Promise<string> {
  return geminiGenerateText(prompt);
}
