// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '@/app/api/jobs/[id]/route';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { makeFakeServerClient, makeQueryBuilder } from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseServerClient);

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/jobs/job-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/jobs/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await PATCH(patchRequest({ applied: true }), params('job-1'));
    expect(res.status).toBe(401);
  });

  it('rejects a non-boolean "applied" value', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PATCH(patchRequest({ applied: 'yes' }), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('rejects a payload with neither applied nor restore', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PATCH(patchRequest({ foo: 'bar' }), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON bodies', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const req = new NextRequest('http://localhost/api/jobs/job-1', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, params('job-1'));
    expect(res.status).toBe(400);
  });

  it('updates applied and scopes the query to the requesting user', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    const from = vi.fn(() => builder);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await PATCH(patchRequest({ applied: true }), params('job-1'));

    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledWith('jobs');
    expect(builder.update).toHaveBeenCalledWith({ applied: true });
    expect(builder.eq).toHaveBeenCalledWith('id', 'job-1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('restores a job by clearing deleted_at', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );

    const res = await PATCH(patchRequest({ restore: true }), params('job-1'));

    expect(res.status).toBe(200);
    expect(builder.update).toHaveBeenCalledWith({ deleted_at: null });
  });

  it('rejects restore: false', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' } }));
    const res = await PATCH(patchRequest({ restore: false }), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('returns 500 when the update fails', async () => {
    const builder = makeQueryBuilder({ data: null, error: { message: 'db down' } });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await PATCH(patchRequest({ applied: true }), params('job-1'));
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/jobs/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await DELETE(patchRequest({}), params('job-1'));
    expect(res.status).toBe(401);
  });

  it('soft-deletes by setting deleted_at and scopes to the requesting user', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    const from = vi.fn(() => builder);
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: { id: 'user-1' }, from }));

    const res = await DELETE(patchRequest({}), params('job-1'));

    expect(res.status).toBe(200);
    expect(builder.eq).toHaveBeenCalledWith('id', 'job-1');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    const updateArg = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      deleted_at: string;
    };
    expect(typeof updateArg.deleted_at).toBe('string');
  });
});
