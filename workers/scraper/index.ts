import { fetchSimplifyInternships } from './sources/simplify-internships.js';
import { fetchSimplifyNewGrad } from './sources/simplify-newgrad.js';
import { fetchSpeedyApply } from './sources/speedyapply.js';
import { fetchVanshb03 } from './sources/vanshb03.js';
import { getScraperSupabaseClient } from './lib/supabase.js';
import { notifyDiscord } from './lib/notify.js';
import type { RawListing } from './types.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
};

interface SourceCounts {
  attempted: number;
  skipped: number;
  errors: number;
}

interface SourceResult extends SourceCounts {
  source: string;
}

type SourceFetcher = () => Promise<RawListing[]>;

async function runSource(
  name: string,
  fetcher: SourceFetcher
): Promise<SourceResult> {
  console.log(`[scraper] Running source: ${name}`);
  try {
    const listings = await fetcher();
    console.log(`[scraper:${name}] Fetched ${listings.length} listings`);

    const userId = process.env['SCRAPER_USER_ID'] as string;
    const supabase = getScraperSupabaseClient();
    const rows: JobInsertRow[] = [];
    let skipped = 0;

    for (const listing of listings) {
      if (!listing.company || !listing.title || !listing.url) {
        skipped++;
        continue;
      }
      rows.push({
        user_id: userId,
        title: listing.title,
        company: listing.company,
        url: listing.url,
        stream: listing.stream,
        posted_at: listing.postedAt?.toISOString() ?? null,
        applied: false,
        resume_file_path: null,
      });
    }

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
      `[scraper:${name}] Done — attempted: ${rows.length}, skipped (missing fields): ${skipped}, errors: ${errors}`
    );
    return { source: name, attempted: rows.length, skipped, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scraper:${name}] Source-level error:`, message);
    await notifyDiscord(`Source "${name}" failed: ${message}`);
    return { source: name, attempted: 0, skipped: 0, errors: 1 };
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
  let totalErrors = 0;
  for (const r of results) {
    console.log(
      `  ${r.source}: attempted=${r.attempted} skipped=${r.skipped} errors=${r.errors}`
    );
    totalAttempted += r.attempted;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }
  console.log(
    `  TOTAL: attempted=${totalAttempted} skipped=${totalSkipped} errors=${totalErrors}`
  );

  if (totalErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch(async err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[scraper] Fatal error:', message);
  await notifyDiscord(`Fatal scraper error: ${message}`);
  process.exit(1);
});
