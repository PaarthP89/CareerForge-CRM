import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const RESUME_URL_TTL_SECONDS = 900;
const RESUME_BUCKET = 'resumes';

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

async function getOwnedJob(supabase: SupabaseServerClient, jobId: string, userId: string) {
  const { data } = await supabase
    .from('jobs')
    .select('id, resume_file_path')
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle();

  return data as { id: string; resume_file_path: string | null } | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await getOwnedJob(supabase, id, user.id);
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  if (file.type !== 'application/pdf') {
    return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
  }

  if (file.size > MAX_RESUME_BYTES) {
    return NextResponse.json(
      { error: `File must be ${MAX_RESUME_BYTES / (1024 * 1024)}MB or smaller` },
      { status: 400 }
    );
  }

  const path = `${user.id}/${id}/resume.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('jobs')
    .update({ resume_file_path: path })
    .eq('id', id);

  if (updateError) {
    await supabase.storage.from(RESUME_BUCKET).remove([path]);
    return NextResponse.json(
      { error: 'Upload succeeded but failed to save resume reference' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, path });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await getOwnedJob(supabase, id, user.id);
  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!job.resume_file_path) {
    return NextResponse.json({ error: 'No resume uploaded for this job' }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(job.resume_file_path, RESUME_URL_TTL_SECONDS);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate download link' },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: data.signedUrl });
}
