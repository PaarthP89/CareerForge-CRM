// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyUrlQuality } from '../url-quality.js';

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('../llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm.js')>();
  return { ...actual, generateText };
});

// Stubbed out so these tests exercise url-quality's own layering/fallthrough
// logic, not the accuracy of the locally-trained naive-bayes model on
// arbitrary strings (that model's own behavior is untested and out of scope
// here — it can change independently without making these tests flaky).
const { classifyDirectVsGeneric } = vi.hoisted(() => ({ classifyDirectVsGeneric: vi.fn(() => null) }));
vi.mock('../text-classifier.js', () => ({ classifyDirectVsGeneric }));

function pad(signal: string): string {
  return `${signal} ${'filler content '.repeat(20)}`;
}

describe('classifyUrlQuality', () => {
  beforeEach(() => {
    generateText.mockReset();
    classifyDirectVsGeneric.mockReset().mockReturnValue(null);
  });

  it('resolves known ATS hosts as direct without needing fetched text', async () => {
    const result = await classifyUrlQuality(
      'https://boards.greenhouse.io/acme/jobs/123',
      null,
      [],
      'Software Engineer',
      'Acme',
      false
    );
    expect(result).toBe('direct');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('resolves direct when JSON-LD JobPosting matches the listing', async () => {
    const result = await classifyUrlQuality(
      'https://acme.example.com/careers/posting',
      null,
      [{ title: 'Software Engineer', organizationName: 'Acme' }],
      'Software Engineer',
      'Acme',
      false
    );
    expect(result).toBe('direct');
  });

  it('classifies direct from apply/submit keyword signals in fetched text', async () => {
    const text = pad('Apply now for this role. Upload your resume and cover letter to submit your application.');
    const result = await classifyUrlQuality(
      'https://acme.example.com/careers/posting',
      text,
      [],
      'Software Engineer',
      'Acme',
      false
    );
    expect(result).toBe('direct');
  });

  it('classifies generic from careers-landing-page keyword signals in fetched text', async () => {
    const text = pad('Browse all jobs and search open positions. Join our talent community to discover your next opportunity.');
    const result = await classifyUrlQuality(
      'https://acme.example.com/careers',
      text,
      [],
      'Software Engineer',
      'Acme',
      false
    );
    expect(result).toBe('generic');
  });

  it('returns unknown when no free layer resolves and LLM is disallowed', async () => {
    const text = pad('Some neutral company page text with no distinguishing signals at all.');
    const result = await classifyUrlQuality(
      'https://acme.example.com/some-page',
      text,
      [],
      'Software Engineer',
      'Acme',
      false
    );
    expect(result).toBe('unknown');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('falls back to the LLM only when every free layer is inconclusive and it is allowed', async () => {
    const text = pad('Some neutral company page text with no distinguishing signals at all.');
    generateText.mockResolvedValue('{"quality": "direct"}');
    const result = await classifyUrlQuality(
      'https://acme.example.com/some-page',
      text,
      [],
      'Software Engineer',
      'Acme',
      true
    );
    expect(result).toBe('direct');
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('returns unknown for a malformed URL and no fetched text', async () => {
    const result = await classifyUrlQuality('not a url', null, [], 'Software Engineer', 'Acme', false);
    expect(result).toBe('unknown');
  });
});
