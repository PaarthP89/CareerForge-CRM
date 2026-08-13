import { getServiceRoleSupabaseClient } from '../shared/lib/supabase.js';
import { notifyDiscord } from '../shared/lib/notify.js';
import { fetchTextWithTimeout, closeBrowser } from '../shared/lib/html.js';
import { checkListingLiveness } from '../shared/lib/dead-listing.js';
import { classifyUrlQuality } from '../shared/lib/url-quality.js';
import { runWithConcurrency } from '../shared/lib/concurrency.js';
import { isLlmAvailable } from '../shared/lib/llm.js';

const CHECK_CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_BATCH_SIZE = 300;

/**
 * postgrest-js only auto-retries GET/HEAD/OPTIONS (see its RETRYABLE_METHODS) —
 * a .update() is a PATCH, so any transient network blip during a run (heavy
 * concurrent Chromium + fetch traffic) surfaces as an immediate, unretried
 * failure with no built-in backoff at all. Same class of issue as the
 * scraper's fetchExistingChunk fix (2026-07-28): retry a few times ourselves
 * before counting it as a real failure.
 */
const UPDATE_MAX_ATTEMPTS = 3;
const UPDATE_RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateJobWithRetry(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
  jobId: string,
  patch: Record<string, unknown>
): Promise<{ message: string } | null> {
  let lastError: { message: string } | null = null;
  for (let attempt = 1; attempt <= UPDATE_MAX_ATTEMPTS; attempt++) {
    const { error } = await supabase.from('jobs').update(patch).eq('id', jobId);
    if (!error) return null;
    lastError = error;
    if (attempt < UPDATE_MAX_ATTEMPTS) {
      await sleep(UPDATE_RETRY_DELAY_MS);
    }
  }
  return lastError;
}

function validateEnv(): void {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[link-health] Missing required environment variables: ${missing.join(', ')}`
    );
  }
  if (!isLlmAvailable()) {
    console.warn(
      '[link-health] No LLM provider available (set GEMINI_API_KEY) — LLM-assisted classification will be skipped for ambiguous cases this run'
    );
  }
}

function batchSize(): number {
  const raw = process.env['LINK_HEALTH_BATCH_SIZE'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

interface JobRow {
  id: string;
  title: string;
  company: string;
  url: string;
}

// PostgREST caps a single .select() at 1000 rows regardless of .limit() —
// a requested batch size above that would otherwise silently truncate to
// 1000 with no error, so page with .range() until either the requested
// limit or the actual row count is reached.
async function fetchBatch(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
  limit: number
): Promise<JobRow[]> {
  const PAGE_SIZE = 1000;
  const all: JobRow[] = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit) - 1;
    const { data, error } = await supabase
      .from('jobs')
      .select('id,title,company,url')
      .is('deleted_at', null)
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`Failed to fetch jobs batch: ${error.message}`);
    }
    all.push(...((data ?? []) as JobRow[]));
    if (!data || data.length < to - from + 1) break;
  }
  return all;
}

async function main(): Promise<void> {
  validateEnv();

  const supabase = getServiceRoleSupabaseClient();
  const allowLlm = isLlmAvailable();
  const limit = batchSize();

  const batch = await fetchBatch(supabase, limit);
  console.log(`[link-health] Checking ${batch.length} job(s) (batch size ${limit})`);

  let checked = 0;
  let deadFlagged = 0;
  let fetchFailures = 0;
  let updateErrors = 0;

  await runWithConcurrency(batch, CHECK_CONCURRENCY, async (job) => {
    const now = new Date().toISOString();
    const fetched = await fetchTextWithTimeout(job.url, FETCH_TIMEOUT_MS);
    if (!fetched.text) fetchFailures++;

    const liveness = await checkListingLiveness(fetched, job.title, job.company, allowLlm);

    if (liveness === 'dead') {
      const error = await updateJobWithRetry(supabase, job.id, {
        deleted_at: now,
        last_checked_at: now,
      });
      if (error) {
        console.error(
          `[link-health] Failed to soft-delete job ${job.id} after ${UPDATE_MAX_ATTEMPTS} attempts:`,
          error.message
        );
        updateErrors++;
      } else {
        deadFlagged++;
      }
      checked++;
      return;
    }

    const urlQuality = await classifyUrlQuality(
      job.url,
      fetched.text,
      fetched.jobPostings,
      job.title,
      job.company,
      allowLlm
    );

    const error = await updateJobWithRetry(supabase, job.id, {
      url_quality: urlQuality,
      last_checked_at: now,
    });
    if (error) {
      console.error(
        `[link-health] Failed to update job ${job.id} after ${UPDATE_MAX_ATTEMPTS} attempts:`,
        error.message
      );
      updateErrors++;
    }
    checked++;
  });

  console.log(
    `[link-health] Done — checked: ${checked}, deadFlagged: ${deadFlagged}, fetchFailures: ${fetchFailures}, updateErrors: ${updateErrors}`
  );

  if (updateErrors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(async err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[link-health] Fatal error:', message);
    await notifyDiscord(`Fatal link-health error: ${message}`, 'LinkHealth');
    process.exitCode = 1;
  })
  .finally(closeBrowser);
