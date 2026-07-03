export class LlmJsonParseError extends Error {
  constructor(public readonly raw: string, cause: unknown) {
    super('Failed to parse LLM response as JSON');
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
    throw new LlmJsonParseError(raw, cause);
  }
}
