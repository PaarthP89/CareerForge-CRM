import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { generateText, parseJsonResponse, GeminiJsonParseError } from '@/lib/gemini';
import { extractReadableText, isViableJobDescription } from '@/lib/html';

const FETCH_TIMEOUT_MS = 10_000;

interface CompareResult {
  score: number;
  reasoning: string;
  missing_keywords: string[];
}

async function fetchJobDescriptionText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CareerForgeCRM/1.0; +https://careerforge.local)',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const html = await res.text();
    const text = extractReadableText(html);

    return isViableJobDescription(text) ? text : null;
  } catch (err) {
    console.error('Failed to fetch job description from', url, err);
    return null;
  }
}

function buildLiveComparePrompt(resumeContent: string, jdText: string): string {
  return `You are scoring how well a candidate's resume matches a specific job posting, on a 0-100 scale (100 = excellent match, 0 = completely unrelated).

RESUME:
"""
${resumeContent}
"""

JOB POSTING:
"""
${jdText}
"""

Score the match and list important keywords/skills from the job posting that are missing from the resume. Respond with ONLY strict JSON in this exact shape, no other text, no markdown fences:
{"score": <integer 0-100>, "reasoning": "<one or two sentence explanation>", "missing_keywords": ["keyword1", "keyword2"]}`;
}

function buildTitleOnlyFallbackPrompt(resumeContent: string, title: string, company: string): string {
  return `You are scoring how well a candidate's resume matches a job, based only on the job title and company (the full job description could not be retrieved), on a 0-100 scale (100 = excellent match, 0 = completely unrelated).

RESUME:
"""
${resumeContent}
"""

JOB TITLE: ${title}
COMPANY: ${company}

Respond with ONLY strict JSON in this exact shape, no other text, no markdown fences:
{"score": <integer 0-100>, "reasoning": "<one or two sentence explanation, noting this is based on title only>", "missing_keywords": []}`;
}

function isValidCompareResult(value: unknown): value is CompareResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.score === 'number' &&
    Number.isInteger(v.score) &&
    v.score >= 0 &&
    v.score <= 100 &&
    typeof v.reasoning === 'string' &&
    Array.isArray(v.missing_keywords) &&
    v.missing_keywords.every((k) => typeof k === 'string')
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, title, company, url')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const { data: resumeRow, error: resumeError } = await supabase
    .from('resumes')
    .select('content')
    .eq('user_id', user.id)
    .maybeSingle();

  if (resumeError) {
    return NextResponse.json({ error: resumeError.message }, { status: 500 });
  }

  const resumeContent = resumeRow?.content ?? '';
  if (resumeContent.trim().length === 0) {
    return NextResponse.json({ error: 'No resume text saved yet' }, { status: 400 });
  }

  const jdText = await fetchJobDescriptionText(job.url);
  const jdFetched = jdText !== null;

  const prompt = jdFetched
    ? buildLiveComparePrompt(resumeContent, jdText!)
    : buildTitleOnlyFallbackPrompt(resumeContent, job.title, job.company);

  let result: CompareResult;
  try {
    const raw = await generateText(prompt);
    const parsed = parseJsonResponse<unknown>(raw);
    if (!isValidCompareResult(parsed)) {
      throw new GeminiJsonParseError(raw, new Error('Response did not match expected shape'));
    }
    result = parsed;
  } catch (err) {
    console.error('Live compare scoring failed for job', jobId, err);
    return NextResponse.json({ error: 'Failed to score this job against your resume' }, { status: 502 });
  }

  const { error: upsertError } = await supabase.from('job_matches').upsert(
    {
      user_id: user.id,
      job_id: job.id,
      score: result.score,
      reasoning: result.reasoning,
      missing_keywords: result.missing_keywords,
      jd_fetched: jdFetched,
      matched_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,job_id' }
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    score: result.score,
    reasoning: result.reasoning,
    missingKeywords: result.missing_keywords,
    jdFetched,
  });
}
