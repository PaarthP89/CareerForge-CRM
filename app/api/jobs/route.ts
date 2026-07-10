import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { JobStream } from '@/types';

const STREAMS: JobStream[] = ['internship', 'new_grad'];

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const { company, title, url, stream, posted_at } = payload;

  if (
    typeof company !== 'string' ||
    !company.trim() ||
    typeof title !== 'string' ||
    !title.trim() ||
    typeof url !== 'string' ||
    !url.trim() ||
    typeof stream !== 'string' ||
    !STREAMS.includes(stream as JobStream)
  ) {
    return NextResponse.json(
      {
        error:
          'Invalid payload: company, title, url are required strings and stream must be "internship" or "new_grad"',
      },
      { status: 400 }
    );
  }

  if (posted_at !== undefined && posted_at !== null && typeof posted_at !== 'string') {
    return NextResponse.json(
      { error: 'Invalid payload: posted_at must be a string or null' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      user_id: user.id,
      company: company.trim(),
      title: title.trim(),
      url: url.trim(),
      stream: stream as JobStream,
      posted_at: posted_at ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'A job with this company/title/URL already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job: data }, { status: 201 });
}
