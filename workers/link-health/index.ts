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

async function main(): Promise<void> {
  validateEnv();

  const supabase = getServiceRoleSupabaseClient();
  const allowLlm = isLlmAvailable();
  const limit = batchSize();

  const { data: jobs, error: fetchError } = await supabase
    .from('jobs')
    .select('id,title,company,url')
    .is('deleted_at', null)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (fetchError) {
    throw new Error(`Failed to fetch jobs batch: ${fetchError.message}`);
  }

  const batch = (jobs ?? []) as JobRow[];
  console.log(`[link-health] Checking ${batch.length} job(s) (batch size ${limit})`);

  let checked = 0;
  let deadFlagged = 0;
  let fetchFailures = 0;
  let updateErrors = 0;

  await runWithConcurrency(batch, CHECK_CONCURRENCY, async (job) => {
    const now = new Date().toISOString();
    const fetchedText = await fetchTextWithTimeout(job.url, FETCH_TIMEOUT_MS);
    if (!fetchedText) fetchFailures++;

    const liveness = await checkListingLiveness(fetchedText, job.title, job.company, allowLlm);

    if (liveness === 'dead') {
      const { error } = await supabase
        .from('jobs')
        .update({ deleted_at: now, last_checked_at: now })
        .eq('id', job.id);
      if (error) {
        console.error(`[link-health] Failed to soft-delete job ${job.id}:`, error.message);
        updateErrors++;
      } else {
        deadFlagged++;
      }
      checked++;
      return;
    }

    const urlQuality = await classifyUrlQuality(
      job.url,
      fetchedText,
      job.title,
      job.company,
      allowLlm
    );

    const { error } = await supabase
      .from('jobs')
      .update({ url_quality: urlQuality, last_checked_at: now })
      .eq('id', job.id);
    if (error) {
      console.error(`[link-health] Failed to update job ${job.id}:`, error.message);
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
