import { fetchSimplifyInternships } from './sources/simplify-internships.js';
import { fetchSimplifyNewGrad } from './sources/simplify-newgrad.js';
import { fetchSpeedyApply } from './sources/speedyapply.js';
import { fetchVanshb03 } from './sources/vanshb03.js';
import { getServiceRoleSupabaseClient } from '../shared/lib/supabase.js';
import { notifyDiscord } from '../shared/lib/notify.js';
import { fetchTextWithTimeout, closeBrowser } from '../shared/lib/html.js';
import { checkListingLiveness } from '../shared/lib/dead-listing.js';
import { classifyUrlQuality, type UrlQuality } from '../shared/lib/url-quality.js';
import { runWithConcurrency } from '../shared/lib/concurrency.js';
import { isLlmAvailable } from '../shared/lib/llm.js';
import type { RawListing } from './types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A real per-posting apply URL is never just a bare origin with no path — this
// pattern only ever shows up when a source's link-extraction grabbed the wrong
// cell (e.g. a company homepage anchor instead of the actual apply link).
// Reject it here, at the single choke point every source funnels through, so a
// future source-level extraction bug degrades to dropped rows instead of
// silently inserting bad URLs.
const BARE_ORIGIN_URL_REGEX = /^https?:\/\/[^/]+\/?$/i;

function validateEnv(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SCRAPER_USER_ID',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[scraper] Missing required environment variables: ${missing.join(', ')}`
    );
  }
  if (!UUID_REGEX.test(process.env['SCRAPER_USER_ID'] as string)) {
    throw new Error(
      '[scraper] SCRAPER_USER_ID does not appear to be a valid UUID.'
    );
  }
}

type JobInsertRow = {
  user_id: string;
  title: string;
  company: string;
  url: string;
  stream: 'internship' | 'new_grad';
  posted_at: string | null;
  applied: boolean;
  resume_file_path: string | null;
  url_quality: UrlQuality | null;
  last_checked_at: string | null;
};

interface SourceCounts {
  attempted: number;
  skipped: number;
  rejectedBadUrl: number;
  errors: number;
}

interface SourceResult extends SourceCounts {
  source: string;
  deadSkipped: number;
}

type SourceFetcher = () => Promise<RawListing[]>;

const CANDIDATE_CHECK_CONCURRENCY = 5;
const CANDIDATE_FETCH_TIMEOUT_MS = 10_000;
const EXISTING_URL_CHECK_CHUNK_SIZE = 200;

function jobKey(company: string, title: string, url: string): string {
  return `${company}\0${title}\0${url}`;
}

/**
 * Most listings a nightly run "attempts" are re-scrapes of rows already in
 * `jobs` — only genuinely new candidates are worth a liveness/quality fetch.
 * Existing rows get rechecked by the separate weekly link-health sweep instead.
 */
async function partitionNewCandidates(
  supabase: ReturnType<typeof getServiceRoleSupabaseClient>,
  candidates: { company: string; title: string; url: string }[]
): Promise<Set<string>> {
  const existingKeys = new Set<string>();
  const urls = candidates.map(c => c.url);

  for (let i = 0; i < urls.length; i += EXISTING_URL_CHECK_CHUNK_SIZE) {
    const chunk = urls.slice(i, i + EXISTING_URL_CHECK_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('jobs')
      .select('company,title,url')
      .in('url', chunk);

    if (error) {
      console.error('[scraper] Existing-row lookup failed, treating all as new:', error.message);
      continue;
    }

    for (const row of data ?? []) {
      existingKeys.add(jobKey(row.company, row.title, row.url));
    }
  }

  return existingKeys;
}

async function runSource(
  name: string,
  fetcher: SourceFetcher
): Promise<SourceResult> {
  console.log(`[scraper] Running source: ${name}`);
  try {
    const listings = await fetcher();
    console.log(`[scraper:${name}] Fetched ${listings.length} listings`);

    const userId = process.env['SCRAPER_USER_ID'] as string;
    const supabase = getServiceRoleSupabaseClient();
    const allowLlm = isLlmAvailable();
    const candidates: { listing: RawListing }[] = [];
    let skipped = 0;
    let rejectedBadUrl = 0;

    for (const listing of listings) {
      if (!listing.company || !listing.title || !listing.url) {
        skipped++;
        continue;
      }
      if (BARE_ORIGIN_URL_REGEX.test(listing.url)) {
        rejectedBadUrl++;
        console.warn(
          `[scraper:${name}] Rejected bare-origin URL for "${listing.company} — ${listing.title}": ${listing.url}`
        );
        continue;
      }
      candidates.push({ listing });
    }

    const existingKeys = await partitionNewCandidates(
      supabase,
      candidates.map(c => ({
        company: c.listing.company,
        title: c.listing.title,
        url: c.listing.url,
      }))
    );

    const rows: JobInsertRow[] = [];
    let deadSkipped = 0;

    await runWithConcurrency(candidates, CANDIDATE_CHECK_CONCURRENCY, async ({ listing }) => {
      const baseRow = {
        user_id: userId,
        title: listing.title,
        company: listing.company,
        url: listing.url,
        stream: listing.stream,
        posted_at: listing.postedAt?.toISOString() ?? null,
        applied: false,
        resume_file_path: null,
      };

      const key = jobKey(listing.company, listing.title, listing.url);
      if (existingKeys.has(key)) {
        // Already tracked — the weekly link-health sweep owns rechecking it,
        // and ignoreDuplicates means this payload is discarded on conflict anyway.
        rows.push({ ...baseRow, url_quality: null, last_checked_at: null });
        return;
      }

      const fetchedText = await fetchTextWithTimeout(listing.url, CANDIDATE_FETCH_TIMEOUT_MS);

      const liveness = await checkListingLiveness(
        fetchedText,
        listing.title,
        listing.company,
        allowLlm
      );
      if (liveness === 'dead') {
        deadSkipped++;
        return;
      }

      const urlQuality = await classifyUrlQuality(
        listing.url,
        fetchedText,
        listing.title,
        listing.company,
        allowLlm
      );

      rows.push({
        ...baseRow,
        url_quality: urlQuality,
        last_checked_at: new Date().toISOString(),
      });
    });

    let errors = 0;
    if (rows.length > 0) {
      // ignoreDuplicates: true is non-negotiable — without it, upsert performs UPDATE on conflict,
      // which would overwrite applied:true and destroy resume_file_path on user-edited rows.
      // onConflict must be comma-separated with no spaces to match the constraint column names exactly.
      const { error } = await supabase.from('jobs').upsert(rows, {
        onConflict: 'company,title,url',
        ignoreDuplicates: true,
      });

      if (error) {
        console.error(`[scraper:${name}] Upsert error: ${error.message}`);
        errors = 1;
      }
    }

    console.log(
      `[scraper:${name}] Done — attempted: ${rows.length}, skipped (missing fields): ${skipped}, rejected (bad url): ${rejectedBadUrl}, dead skipped: ${deadSkipped}, errors: ${errors}`
    );
    if (rejectedBadUrl > 0) {
      await notifyDiscord(
        `Source "${name}" rejected ${rejectedBadUrl} listing(s) with bare-origin URLs — likely a link-extraction bug in this source's parser.`,
        'Scraper'
      );
    }
    return { source: name, attempted: rows.length, skipped, rejectedBadUrl, deadSkipped, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scraper:${name}] Source-level error:`, message);
    await notifyDiscord(`Source "${name}" failed: ${message}`, 'Scraper');
    return { source: name, attempted: 0, skipped: 0, rejectedBadUrl: 0, deadSkipped: 0, errors: 1 };
  }
}

async function main(): Promise<void> {
  validateEnv();

  const results: SourceResult[] = [];
  results.push(await runSource('simplify-internships', fetchSimplifyInternships));
  results.push(await runSource('simplify-newgrad', fetchSimplifyNewGrad));
  results.push(await runSource('speedyapply', fetchSpeedyApply));
  results.push(await runSource('vanshb03', fetchVanshb03));

  console.log('\n[scraper] Summary:');
  let totalAttempted = 0;
  let totalSkipped = 0;
  let totalRejectedBadUrl = 0;
  let totalDeadSkipped = 0;
  let totalErrors = 0;
  for (const r of results) {
    console.log(
      `  ${r.source}: attempted=${r.attempted} skipped=${r.skipped} rejectedBadUrl=${r.rejectedBadUrl} deadSkipped=${r.deadSkipped} errors=${r.errors}`
    );
    totalAttempted += r.attempted;
    totalSkipped += r.skipped;
    totalRejectedBadUrl += r.rejectedBadUrl;
    totalDeadSkipped += r.deadSkipped;
    totalErrors += r.errors;
  }
  console.log(
    `  TOTAL: attempted=${totalAttempted} skipped=${totalSkipped} rejectedBadUrl=${totalRejectedBadUrl} deadSkipped=${totalDeadSkipped} errors=${totalErrors}`
  );

  if (totalErrors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch(async err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scraper] Fatal error:', message);
    await notifyDiscord(`Fatal scraper error: ${message}`, 'Scraper');
    process.exitCode = 1;
  })
  .finally(closeBrowser);
