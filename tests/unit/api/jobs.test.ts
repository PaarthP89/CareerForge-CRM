// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/jobs/route';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { makeFakeServerClient, makeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseServerClient);

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/jobs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const validJob = {
  company: 'Acme Corp',
  title: 'Software Engineer Intern',
  url: 'https://acme.com/careers/123',
  stream: 'internship',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/jobs', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await POST(postRequest(validJob));
    expect(res.status).toBe(401);
  });

  it('rejects a missing required field', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await POST(postRequest({ ...validJob, company: '' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid stream value', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await POST(postRequest({ ...validJob, stream: 'contractor' }));
    expect(res.status).toBe(400);
  });

  it('rejects a non-string posted_at', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await POST(postRequest({ ...validJob, posted_at: 12345 }));
    expect(res.status).toBe(400);
  });

  it('creates a job and stamps the requesting user as owner', async () => {
    const created = { id: 'job-1', ...validJob, user_id: 'user-1' };
    const builder = makeQueryBuilder({ data: created, error: null });
    const from = vi.fn(() => builder);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await POST(postRequest(validJob));
    const payload = await res.json();

    expect(res.status).toBe(201);
    expect(payload.job).toEqual(created);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', company: 'Acme Corp' })
    );
  });

  it('trims whitespace from string fields before inserting', async () => {
    const builder = makeQueryBuilder({ data: {}, error: null });
    const from = vi.fn(() => builder);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    await POST(postRequest({ ...validJob, company: '  Acme Corp  ' }));

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme Corp' })
    );
  });

  it('returns 409 on a duplicate (company, title, url) conflict', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'duplicate key', code: '23505' } });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );

    const res = await POST(postRequest(validJob));
    expect(res.status).toBe(409);
  });

  it('returns 500 on other insert errors', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'db down' } });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );

    const res = await POST(postRequest(validJob));
    expect(res.status).toBe(500);
  });
});
