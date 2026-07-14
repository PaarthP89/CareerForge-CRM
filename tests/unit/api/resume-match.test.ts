// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/resume/match/route';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { generateText, isLlmAvailable } from '@/lib/gemini';
import { makeFakeServerClient, makeQueryBuilder, type FakeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    generateText: vi.fn(),
    isLlmAvailable: vi.fn(() => true),
  };
});

const mockedGetClient = vi.mocked(getSupabaseServerClient);
const mockedGenerateText = vi.mocked(generateText);
const mockedIsLlmAvailable = vi.mocked(isLlmAvailable);

function tableRouter(tables: Record<string, FakeQueryBuilder>) {
  return (table: string) => {
    const builder = tables[table];
    if (!builder) throw new Error(`unexpected table: ${table}`);
    return builder;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsLlmAvailable.mockReturnValue(true);
});

describe('POST /api/resume/match', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns 500 when no LLM provider is configured', async () => {
    mockedIsLlmAvailable.mockReturnValue(false);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it('returns 400 when no resume text has been saved', async () => {
    const from = tableRouter({
      resumes: makeQueryBuilder({ data: { content: '' }, error: null }),
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it('returns a zeroed summary when there are no active jobs', async () => {
    const from = tableRouter({
      resumes: makeQueryBuilder({ data: { content: 'my resume' }, error: null }),
      jobs: makeQueryBuilder({ data: [], error: null }),
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await POST();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ totalJobs: 0, prefiltered: 0, scored: 0, failedBatches: 0 });
  });

  it('pre-filters, scores, and upserts job_matches for surviving titles', async () => {
    const jobMatchesBuilder = makeQueryBuilder({ data: null, error: null });
    const from = tableRouter({
      resumes: makeQueryBuilder({ data: { content: 'SWE resume' }, error: null }),
      jobs: makeQueryBuilder({
        data: [
          { id: 'job-1', title: 'Software Engineer Intern' },
          { id: 'job-2', title: 'Financial Analyst' },
        ],
        error: null,
      }),
      job_matches: jobMatchesBuilder,
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    mockedGenerateText.mockImplementation(async (prompt: string) => {
      if (prompt.includes('irrelevant_titles')) {
        return JSON.stringify({ irrelevant_titles: ['Financial Analyst'] });
      }
      return JSON.stringify({
        results: [{ title: 'Software Engineer Intern', score: 85, reasoning: 'Strong match' }],
      });
    });

    const res = await POST();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.totalJobs).toBe(2);
    expect(payload.prefiltered).toBe(1);
    expect(payload.scored).toBe(1);
    expect(payload.failedBatches).toBe(0);
    expect(jobMatchesBuilder.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 'user-1',
          job_id: 'job-1',
          score: 85,
          reasoning: 'Strong match',
        }),
      ],
      { onConflict: 'user_id,job_id' }
    );
  });

  it('counts a batch as failed when the LLM response is unparseable, without throwing', async () => {
    const from = tableRouter({
      resumes: makeQueryBuilder({ data: { content: 'SWE resume' }, error: null }),
      jobs: makeQueryBuilder({ data: [{ id: 'job-1', title: 'Software Engineer' }], error: null }),
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    mockedGenerateText.mockResolvedValue('not valid json');

    const res = await POST();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.scored).toBe(0);
    expect(payload.failedBatches).toBe(1);
  });
});

describe('GET /api/resume/match', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the ranked matches for the requesting user', async () => {
    const matches = [{ id: 'm1', job_id: 'job-1', score: 90, reasoning: null, matched_at: 'now', jobs: { title: 'SWE', company: 'Acme' } }];
    const from = tableRouter({ job_matches: makeQueryBuilder({ data: matches, error: null }) });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await GET();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.matches).toEqual(matches);
  });
});
