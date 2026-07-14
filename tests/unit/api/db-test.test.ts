// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/db-test/route';
import { getSupabaseClient } from '@/lib/supabase';
import { makeFakeClient, makeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseClient);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/db-test', () => {
  it('reports connected: true with a row count on success', async () => {
    const builder = makeQueryBuilder({ data: [{ id: 'job-1' }], error: null });
    mockedGetClient.mockReturnValue(makeFakeClient({ from: () => builder }));

    const res = await GET();
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ connected: true, rowCount: 1 });
  });

  it('reports connected: false with the error message on failure', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'connection refused' } });
    mockedGetClient.mockReturnValue(makeFakeClient({ from: () => builder }));

    const res = await GET();
    const payload = await res.json();

    expect(res.status).toBe(500);
    expect(payload).toEqual({ connected: false, error: 'connection refused' });
  });
});
