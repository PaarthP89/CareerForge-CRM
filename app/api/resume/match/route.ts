import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { generateText, parseJsonResponse, GeminiJsonParseError } from '@/lib/gemini';

const BATCH_SIZE = 75;
const MAX_CONCURRENT_BATCHES = 3;

interface PreFilterResponse {
  irrelevant_titles: string[];
}

interface ScoredTitle {
  title: string;
  score: number;
  reasoning: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    const index = nextIndex++;
    if (index >= items.length) return;
    await worker(items[index]);
    await runNext();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runNext());
  await Promise.all(workers);
}

function buildPreFilterPrompt(resumeContent: string, titles: string[]): string {
  return `You are helping filter job titles for relevance to a candidate's resume.

RESUME:
"""
${resumeContent}
"""

Below is a list of distinct job titles from job postings. Identify titles that are CLEARLY irrelevant to this resume's professional domain (e.g., if the resume is a software engineering resume, exclude titles like "Financial Analyst", "Registered Nurse", "Sales Representative"). Be conservative — only exclude titles that are obviously outside the resume's field. When in doubt, keep the title.

TITLES:
${titles.map((t) => `- ${t}`).join('\n')}

Respond with ONLY strict JSON in this exact shape, no other text, no markdown fences:
{"irrelevant_titles": ["title1", "title2"]}`;
}

function buildScoringPrompt(resumeContent: string, titles: string[]): string {
  return `You are scoring job title relevance against a candidate's resume, on a 0-100 scale (100 = excellent match for the candidate's background and likely target roles, 0 = completely unrelated).

RESUME:
"""
${resumeContent}
"""

Score each of the following job titles for relevance to this resume. Respond with ONLY strict JSON, an array in this exact shape, no other text, no markdown fences:
[{"title": "<title>", "score": <integer 0-100>, "reasoning": "<one short sentence>"}]

TITLES:
${titles.map((t) => `- ${t}`).join('\n')}`;
}

export async function POST() {
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

  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ totalJobs: 0, prefiltered: 0, scored: 0, failedBatches: 0 });
  }

  const titleToJobIds = new Map<string, { displayTitle: string; jobIds: string[] }>();
  for (const job of jobs) {
    const key = normalizeTitle(job.title);
    const entry = titleToJobIds.get(key);
    if (entry) {
      entry.jobIds.push(job.id);
    } else {
      titleToJobIds.set(key, { displayTitle: job.title, jobIds: [job.id] });
    }
  }

  const distinctTitles = Array.from(titleToJobIds.values()).map((v) => v.displayTitle);

  let survivorKeys = new Set(titleToJobIds.keys());
  try {
    const preFilterRaw = await generateText(buildPreFilterPrompt(resumeContent, distinctTitles));
    const preFilterParsed = parseJsonResponse<PreFilterResponse>(preFilterRaw);
    if (Array.isArray(preFilterParsed.irrelevant_titles)) {
      const irrelevantKeys = new Set(
        preFilterParsed.irrelevant_titles
          .filter((t): t is string => typeof t === 'string')
          .map(normalizeTitle)
      );
      survivorKeys = new Set(
        Array.from(titleToJobIds.keys()).filter((key) => !irrelevantKeys.has(key))
      );
    }
  } catch (err) {
    console.error('Pre-filter stage failed, proceeding with all titles', err);
  }

  const survivorTitles = Array.from(survivorKeys).map((key) => titleToJobIds.get(key)!.displayTitle);
  const batches = chunk(survivorTitles, BATCH_SIZE);

  let scoredCount = 0;
  let failedBatches = 0;

  await runWithConcurrency(batches, MAX_CONCURRENT_BATCHES, async (batch) => {
    try {
      const raw = await generateText(buildScoringPrompt(resumeContent, batch));
      const parsed = parseJsonResponse<ScoredTitle[]>(raw);

      if (!Array.isArray(parsed)) {
        throw new GeminiJsonParseError(raw, new Error('Expected a JSON array'));
      }

      const rows: { user_id: string; job_id: string; score: number; reasoning: string | null; matched_at: string }[] = [];
      const matchedAt = new Date().toISOString();

      for (const entry of parsed) {
        if (
          !entry ||
          typeof entry.title !== 'string' ||
          typeof entry.score !== 'number' ||
          !Number.isInteger(entry.score) ||
          entry.score < 0 ||
          entry.score > 100
        ) {
          continue;
        }

        const key = normalizeTitle(entry.title);
        const mapping = titleToJobIds.get(key);
        if (!mapping) continue;

        for (const jobId of mapping.jobIds) {
          rows.push({
            user_id: user.id,
            job_id: jobId,
            score: entry.score,
            reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : null,
            matched_at: matchedAt,
          });
        }
      }

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from('job_matches')
          .upsert(rows, { onConflict: 'user_id,job_id' });

        if (upsertError) {
          throw upsertError;
        }

        scoredCount += rows.length;
      }
    } catch (err) {
      failedBatches += 1;
      console.error('Batch scoring failed for titles:', batch, err);
    }
  });

  return NextResponse.json({
    totalJobs: jobs.length,
    prefiltered: survivorTitles.length,
    scored: scoredCount,
    failedBatches,
  });
}

export async function GET() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('job_matches')
    .select('id, job_id, score, reasoning, matched_at, jobs(title, company)')
    .eq('user_id', user.id)
    .order('score', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ matches: data ?? [] });
}
