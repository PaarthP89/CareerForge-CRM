import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';

const MAX_RESUME_CHARS = 100_000;

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('resumes')
    .select('content')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ content: data?.content ?? '' });
}

export async function PUT(request: NextRequest) {
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

  if (typeof body !== 'object' || body === null || !('content' in body)) {
    return NextResponse.json({ error: 'Invalid payload: expected content' }, { status: 400 });
  }

  const { content } = body as Record<string, unknown>;

  if (typeof content !== 'string') {
    return NextResponse.json(
      { error: 'Invalid payload: content must be a string' },
      { status: 400 }
    );
  }

  if (content.length > MAX_RESUME_CHARS) {
    return NextResponse.json(
      { error: `content exceeds maximum length of ${MAX_RESUME_CHARS} characters` },
      { status: 400 }
    );
  }

  const updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('resumes')
    .upsert({ user_id: user.id, content, updated_at }, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated_at });
}
