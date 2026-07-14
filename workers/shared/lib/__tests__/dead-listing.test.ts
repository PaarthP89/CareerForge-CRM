// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkListingLiveness, significantWords } from '../dead-listing.js';
import type { FetchedPage } from '../html.js';

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('../llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm.js')>();
  return { ...actual, generateText };
});

function pad(signal: string): string {
  return `${signal} ${'filler content '.repeat(20)}`;
}

function page(overrides: Partial<FetchedPage>): FetchedPage {
  return {
    text: null,
    status: null,
    malformed: false,
    pageTitle: null,
    dnsFailed: false,
    jobPostings: [],
    ...overrides,
  };
}

describe('checkListingLiveness', () => {
  beforeEach(() => {
    generateText.mockReset();
  });

  it('returns dead for a malformed URL regardless of anything else', async () => {
    const result = await checkListingLiveness(page({ malformed: true }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it('returns dead when DNS resolution failed', async () => {
    const result = await checkListingLiveness(page({ dnsFailed: true }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it.each([404, 410])('returns dead for HTTP %i', async (status) => {
    const result = await checkListingLiveness(page({ status }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it('returns unknown when fetched text is missing', async () => {
    const result = await checkListingLiveness(page({ text: null }), 'Engineer', 'Acme', false);
    expect(result).toBe('unknown');
  });

  it('returns unknown when fetched text is too short to be viable', async () => {
    const result = await checkListingLiveness(page({ text: 'short' }), 'Engineer', 'Acme', false);
    expect(result).toBe('unknown');
  });

  it('returns dead on explicit "no longer accepting applications" wording', async () => {
    const text = pad('This position has been filled and is no longer accepting applications.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it('returns dead for a parked-domain page', async () => {
    const text = pad('This domain has recently been parked. Buy this domain today, courtesy of GoDaddy.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it('returns dead for a resold-domain spam page', async () => {
    const text = pad('Welcome to our online casino with free spins on every slot machine.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('dead');
  });

  it('returns unknown (never dead) for a bot-block/WAF page', async () => {
    const text = pad('Sorry, you have been blocked. Please verify you are a human to continue.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('unknown');
  });

  it('returns dead for a generic-redirect: unrelated page title plus generic careers copy', async () => {
    const text = pad('Browse all jobs and search open positions across the company.');
    const result = await checkListingLiveness(
      page({ text, pageTitle: 'Careers Home — Unrelated Co' }),
      'Backend Engineer',
      'Acme',
      false
    );
    expect(result).toBe('dead');
  });

  it('does not flag a generic redirect when the page title overlaps the job/company', async () => {
    const text = pad('Browse all jobs and search open positions across the company.');
    const result = await checkListingLiveness(
      page({ text, pageTitle: 'Backend Engineer at Acme' }),
      'Backend Engineer',
      'Acme',
      false
    );
    expect(result).toBe('alive');
  });

  it('returns unknown for soft-ambiguous phrasing when the LLM is disallowed', async () => {
    const text = pad('This role may no longer be available — check back later for similar jobs.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('unknown');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('defers soft-ambiguous phrasing to the LLM when allowed', async () => {
    const text = pad('This role may no longer be available — check back later for similar jobs.');
    generateText.mockResolvedValue('{"status": "dead"}');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', true);
    expect(result).toBe('dead');
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('returns alive for ordinary, unambiguous viable posting text', async () => {
    const text = pad('We are hiring a Backend Engineer to join our platform team building distributed systems.');
    const result = await checkListingLiveness(page({ text }), 'Engineer', 'Acme', false);
    expect(result).toBe('alive');
  });
});

describe('significantWords', () => {
  it('lowercases, strips punctuation, and drops short/stop words', () => {
    const words = significantWords('The Backend Engineer role at Acme, Inc.');
    expect(words.has('backend')).toBe(true);
    expect(words.has('engineer')).toBe(true);
    expect(words.has('acme')).toBe(true);
    expect(words.has('the')).toBe(false);
    expect(words.has('at')).toBe(false);
  });
});
