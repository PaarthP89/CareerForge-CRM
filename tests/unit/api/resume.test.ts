// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/resume/route';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { makeFakeServerClient, makeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseServerClient);

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/resume', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/resume', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns empty string when no resume row exists yet', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await GET();
    const payload = await res.json();
    expect(payload.content).toBe('');
  });

  it('returns the saved resume content', async () => {
    const builder = makeQueryBuilder({ data: { content: 'my resume text' }, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await GET();
    const payload = await res.json();
    expect(payload.content).toBe('my resume text');
  });
});

describe('PUT /api/resume', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await PUT(putRequest({ content: 'hi' }));
    expect(res.status).toBe(401);
  });

  it('rejects a missing content field', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PUT(putRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects a non-string content field', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PUT(putRequest({ content: 42 }));
    expect(res.status).toBe(400);
  });

  it('rejects content over the max length', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PUT(putRequest({ content: 'a'.repeat(100_001) }));
    expect(res.status).toBe(400);
  });

  it('upserts on user_id and returns success', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    const from = vi.fn(() => builder);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await PUT(putRequest({ content: 'updated resume' }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', content: 'updated resume' }),
      { onConflict: 'user_id' }
    );
  });

  it('returns 500 when the upsert fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'db down' } });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await PUT(putRequest({ content: 'updated resume' }));
    expect(res.status).toBe(500);
  });
});
