// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/seed/route';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import { makeFakeAdminClient, makeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

const mockedGetAdminClient = vi.mocked(getSupabaseAdminClient);

function seedRequest(userId?: string) {
  const url = userId
    ? `http://localhost/api/seed?user_id=${userId}`
    : 'http://localhost/api/seed';
  return new NextRequest(url, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/seed', () => {
  it('returns 503 when no service-role key is configured', async () => {
    mockedGetAdminClient.mockReturnValue(null);
    const res = await POST(seedRequest('user-1'));
    expect(res.status).toBe(503);
  });

  it('returns 400 when user_id is missing', async () => {
    mockedGetAdminClient.mockReturnValue(makeFakeAdminClient());
    const res = await POST(seedRequest());
    expect(res.status).toBe(400);
  });

  it('inserts the mock job set stamped with the given user_id', async () => {
    const builder = makeQueryBuilder({ data: new Array(10).fill({}), error: null });
    const from = vi.fn(() => builder);
    mockedGetAdminClient.mockReturnValue(makeFakeAdminClient({ from }));

    const res = await POST(seedRequest('user-42'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.inserted).toBe(10);
    expect(from).toHaveBeenCalledWith('jobs');
    const insertArg = (builder.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      user_id: string;
    }[];
    expect(insertArg.every((job) => job.user_id === 'user-42')).toBe(true);
  });

  it('returns 500 when the insert fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'db down' } });
    mockedGetAdminClient.mockReturnValue(makeFakeAdminClient({ from: () => builder }));
    const res = await POST(seedRequest('user-1'));
    expect(res.status).toBe(500);
  });
});
