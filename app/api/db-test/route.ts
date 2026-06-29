import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import type { Job } from '@/types';

export async function GET() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('jobs')
    .select('id')
    .limit(1)
    .returns<Pick<Job, 'id'>[]>();

  if (error) {
    return NextResponse.json(
      { connected: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ connected: true, rowCount: data.length });
}
