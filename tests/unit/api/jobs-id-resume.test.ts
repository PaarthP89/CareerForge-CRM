// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from '@/app/api/jobs/[id]/resume/route';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import {
  makeFakeServerClient,
  makeQueryBuilder,
  makeStorageBucket,
} from '../helpers/fake-supabase';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServerClient: vi.fn(),
}));

const mockedGetClient = vi.mocked(getSupabaseServerClient);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function uploadRequest(file: File | null) {
  const formData = new FormData();
  if (file) formData.append('file', file);
  return new NextRequest('http://localhost/api/jobs/job-1/resume', {
    method: 'POST',
    body: formData,
  });
}

function getRequest() {
  return new NextRequest('http://localhost/api/jobs/job-1/resume');
}

const ownedJob = { id: 'job-1', resume_file_path: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/jobs/[id]/resume', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await POST(uploadRequest(null), params('job-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the job is not owned by the requesting user', async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });
    const res = await POST(uploadRequest(file), params('job-1'));
    expect(res.status).toBe(404);
  });

  it('rejects a missing file', async () => {
    const builder = makeQueryBuilder({ data: ownedJob, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await POST(uploadRequest(null), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('rejects a non-PDF file', async () => {
    const builder = makeQueryBuilder({ data: ownedJob, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const file = new File(['plain text'], 'resume.txt', { type: 'text/plain' });
    const res = await POST(uploadRequest(file), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('rejects a file over the size limit', async () => {
    const builder = makeQueryBuilder({ data: ownedJob, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([oversized], 'resume.pdf', { type: 'application/pdf' });
    const res = await POST(uploadRequest(file), params('job-1'));
    expect(res.status).toBe(400);
  });

  it('uploads to a path scoped by user and job id, then stores the path', async () => {
    const queryBuilder = makeQueryBuilder({ data: ownedJob, error: null });
    const bucket = makeStorageBucket();
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({
        user: { id: 'user-1' },
        from: () => queryBuilder,
        storageFrom: () => bucket,
      })
    );

    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });
    const res = await POST(uploadRequest(file), params('job-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.path).toBe('user-1/job-1/resume.pdf');
    expect(bucket.upload).toHaveBeenCalledWith(
      'user-1/job-1/resume.pdf',
      expect.any(File),
      expect.objectContaining({ contentType: 'application/pdf', upsert: true })
    );
    expect(queryBuilder.update).toHaveBeenCalledWith({ resume_file_path: 'user-1/job-1/resume.pdf' });
  });

  it('removes the uploaded file if saving the DB reference fails', async () => {
    const queryBuilder = makeQueryBuilder<typeof ownedJob | null>({ data: ownedJob, error: null });
    let updateCalled = false;
    queryBuilder.update = vi.fn(() => {
      updateCalled = true;
      return makeQueryBuilder<typeof ownedJob | null>({ data: null, error: { message: 'db down' } });
    });
    const bucket = makeStorageBucket();
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({
        user: { id: 'user-1' },
        from: () => queryBuilder,
        storageFrom: () => bucket,
      })
    );

    const file = new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' });
    const res = await POST(uploadRequest(file), params('job-1'));

    expect(updateCalled).toBe(true);
    expect(res.status).toBe(500);
    expect(bucket.remove).toHaveBeenCalledWith(['user-1/job-1/resume.pdf']);
  });
});

describe('GET /api/jobs/[id]/resume', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedGetClient.mockResolvedValue(makeFakeServerClient({ user: null }));
    const res = await GET(getRequest(), params('job-1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the job has no resume uploaded', async () => {
    const builder = makeQueryBuilder({ data: ownedJob, error: null });
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder })
    );
    const res = await GET(getRequest(), params('job-1'));
    expect(res.status).toBe(404);
  });

  it('returns a signed download URL for an existing resume', async () => {
    const builder = makeQueryBuilder({
      data: { id: 'job-1', resume_file_path: 'user-1/job-1/resume.pdf' },
      error: null,
    });
    const bucket = makeStorageBucket();
    mockedGetClient.mockResolvedValue(
      makeFakeServerClient({ user: { id: 'user-1' }, from: () => builder, storageFrom: () => bucket })
    );

    const res = await GET(getRequest(), params('job-1'));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.url).toBe('https://signed.example.com/x');
    expect(bucket.createSignedUrl).toHaveBeenCalledWith('user-1/job-1/resume.pdf', 900);
  });
});
