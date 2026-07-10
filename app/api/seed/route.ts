import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase-admin';
import type { JobStream } from '@/types';

interface MockJob {
  title: string;
  company: string;
  url: string;
  stream: JobStream;
  posted_at: string;
  applied: boolean;
}

const MOCK_JOBS: MockJob[] = [
  {
    title: 'Software Engineer Intern',
    company: 'Google',
    url: 'https://careers.google.com/jobs/results/123456',
    stream: 'internship',
    posted_at: '2026-06-01T00:00:00Z',
    applied: false,
  },
  {
    title: 'SWE Intern – Summer 2026',
    company: 'Meta',
    url: 'https://www.metacareers.com/jobs/789012',
    stream: 'internship',
    posted_at: '2026-06-05T00:00:00Z',
    applied: true,
  },
  {
    title: 'Software Engineering Intern',
    company: 'Apple',
    url: 'https://jobs.apple.com/en-us/details/200500001',
    stream: 'internship',
    posted_at: '2026-06-08T00:00:00Z',
    applied: false,
  },
  {
    title: 'Product Management Intern',
    company: 'Microsoft',
    url: 'https://careers.microsoft.com/us/en/job/1234567',
    stream: 'internship',
    posted_at: '2026-06-10T00:00:00Z',
    applied: false,
  },
  {
    title: 'Data Science Intern',
    company: 'Stripe',
    url: 'https://stripe.com/jobs/listing/data-science-intern',
    stream: 'internship',
    posted_at: '2026-06-12T00:00:00Z',
    applied: false,
  },
  {
    title: 'Software Engineer – New Grad',
    company: 'Anthropic',
    url: 'https://www.anthropic.com/careers#job-listings',
    stream: 'new_grad',
    posted_at: '2026-06-15T00:00:00Z',
    applied: false,
  },
  {
    title: 'Software Engineer (University Grad)',
    company: 'Cloudflare',
    url: 'https://www.cloudflare.com/careers/jobs/new-grad-swe',
    stream: 'new_grad',
    posted_at: '2026-06-17T00:00:00Z',
    applied: true,
  },
  {
    title: 'New Grad Software Engineer',
    company: 'Linear',
    url: 'https://linear.app/careers',
    stream: 'new_grad',
    posted_at: '2026-06-19T00:00:00Z',
    applied: false,
  },
  {
    title: 'Software Engineer – New Grad 2026',
    company: 'Vercel',
    url: 'https://vercel.com/careers',
    stream: 'new_grad',
    posted_at: '2026-06-20T00:00:00Z',
    applied: false,
  },
  {
    title: 'Backend Engineer – New Grad',
    company: 'Supabase',
    url: 'https://supabase.com/careers',
    stream: 'new_grad',
    posted_at: '2026-06-22T00:00:00Z',
    applied: false,
  },
];

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  const admin = getSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json(
      {
        error: 'SUPABASE_SERVICE_ROLE_KEY not configured',
        instructions: [
          '1. Locate your service role key in: Supabase Dashboard → Project Settings → API → service_role',
          '2. Add SUPABASE_SERVICE_ROLE_KEY=<key> to .env.local (never commit this file)',
          '3. Restart the dev server',
          '4. Find your user UUID: Supabase Dashboard → Authentication → Users',
          '5. POST /api/seed?user_id=<your-uuid>',
        ],
      },
      { status: 503 }
    );
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'user_id query parameter is required. POST /api/seed?user_id=<your-uuid>' },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from('jobs')
    .insert(MOCK_JOBS.map((j) => ({ ...j, user_id: userId })))
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, inserted: data?.length ?? 0 });
}
