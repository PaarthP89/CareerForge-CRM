// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/resume/match/[jobId]/route';
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

function params(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

const ownedJob = { id: 'job-1', title: 'Software Engineer Intern', company: 'Acme Corp', url: 'https://acme.com/careers/123' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsLlmAvailable.mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false }) as Response)
  );
});

describe('POST /api/resume/match/[jobId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await POST(new Request('http://localhost'), params('job-1'));
    expect(res.status).toBe(401);
  });

  it('returns 500 when no LLM provider is configured', async () => {
    mockedIsLlmAvailable.mockReturnValue(false);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await POST(new Request('http://localhost'), params('job-1'));
    expect(res.status).toBe(500);
  });

  it('returns 404 when the job is not found for this user', async () => {
    const from = tableRouter({ jobs: makeQueryBuilder({ data: null, error: null }) });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    const res = await POST(new Request('http://localhost'), params('job-1'));
    expect(res.status).toBe(404);
  });

  it('returns 400 when no resume text has been saved', async () => {
    const from = tableRouter({
      jobs: makeQueryBuilder({ data: ownedJob, error: null }),
      resumes: makeQueryBuilder({ data: { content: '' }, error: null }),
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    const res = await POST(new Request('http://localhost'), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('falls back to a title/company-only score when the posting fetch fails', async () => {
    const jobMatches = makeQueryBuilder({ data: null, error: null });
    const from = tableRouter({
      jobs: makeQueryBuilder({ data: ownedJob, error: null }),
      resumes: makeQueryBuilder({ data: { content: 'SWE resume' }, error: null }),
      job_matches: jobMatches,
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    mockedGenerateText.mockResolvedValue(
      JSON.stringify({ score: 60, reasoning: 'Title-only estimate', missing_keywords: [] })
    );

    const res = await POST(new Request('http://localhost'), params('job-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.jdFetched).toBe(false);
    expect(payload.score).toBe(60);
    expect(mockedGenerateText.mock.calls[0][0]).toContain('based only on the job title and company');
    expect(jobMatches.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ jd_fetched: false, score: 60 }),
      { onConflict: 'user_id,job_id' }
    );
  });

  it('does a full comparison when the posting is fetched successfully', async () => {
    const jdHtml = `<html><body>${'Responsibilities include building distributed systems. '.repeat(6)}</body></html>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => jdHtml }) as Response)
    );

    const jobMatches = makeQueryBuilder({ data: null, error: null });
    const from = tableRouter({
      jobs: makeQueryBuilder({ data: ownedJob, error: null }),
      resumes: makeQueryBuilder({ data: { content: 'SWE resume' }, error: null }),
      job_matches: jobMatches,
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    mockedGenerateText.mockResolvedValue(
      JSON.stringify({ score: 92, reasoning: 'Great match', missing_keywords: ['Kubernetes'] })
    );

    const res = await POST(new Request('http://localhost'), params('job-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.jdFetched).toBe(true);
    expect(payload.score).toBe(92);
    expect(payload.missingKeywords).toEqual(['Kubernetes']);
    expect(mockedGenerateText.mock.calls[0][0]).toContain('JOB POSTING:');
  });

  it('returns 502 when the LLM response cannot be parsed into a valid result', async () => {
    const from = tableRouter({
      jobs: makeQueryBuilder({ data: ownedJob, error: null }),
      resumes: makeQueryBuilder({ data: { content: 'SWE resume' }, error: null }),
    });
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));
    mockedGenerateText.mockResolvedValue('not valid json');

    const res = await POST(new Request('http://localhost'), params('job-1'));
    expect(res.status).toBe(502);
  });
});
