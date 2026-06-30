import { fetchSimplifyInternships } from './sources/simplify-internships.js';
import { fetchSimplifyNewGrad } from './sources/simplify-newgrad.js';
import { fetchSpeedyApply } from './sources/speedyapply.js';
import { fetchVanshb03 } from './sources/vanshb03.js';
import { getScraperSupabaseClient } from './lib/supabase.js';
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

interface SourceCounts {
  inserted: number;
  skipped: number;
  errors: number;
}

interface SourceResult extends SourceCounts {
  source: string;
}

type SourceFetcher = () => Promise<RawListing[]>;

async function processListings(
  sourceName: string,
  listings: RawListing[]
): Promise<SourceCounts> {
  const supabase = getScraperSupabaseClient();
  const userId = process.env['SCRAPER_USER_ID'] as string;
  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const listing of listings) {
    if (!listing.company || !listing.title || !listing.url) {
      skipped++;
      continue;
    }

    try {
      // Soft dedup: Phase 3.2 replaces this with ON CONFLICT DO NOTHING once DB constraint exists
      const { data: existing } = await supabase
        .from('jobs')
        .select('id')
        .eq('company', listing.company)
        .eq('title', listing.title)
        .eq('url', listing.url)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from('jobs').insert({
        user_id: userId,
        title: listing.title,
        company: listing.company,
        url: listing.url,
        stream: listing.stream,
        posted_at: listing.postedAt?.toISOString() ?? null,
        applied: false,
      });

      if (error) {
        console.error(
          `[scraper:${sourceName}] Insert error for "${listing.company} — ${listing.title}": ${error.message}`
        );
        errors++;
      } else {
        inserted++;
      }
    } catch (err) {
      console.error(
        `[scraper:${sourceName}] Unexpected error for "${listing.company} — ${listing.title}":`,
        err
      );
      errors++;
    }
  }

  return { inserted, skipped, errors };
}

async function runSource(
  name: string,
  fetcher: SourceFetcher
): Promise<SourceResult> {
  console.log(`[scraper] Running source: ${name}`);
  try {
    const listings = await fetcher();
    console.log(`[scraper:${name}] Fetched ${listings.length} listings`);
    const counts = await processListings(name, listings);
    console.log(
      `[scraper:${name}] Done — inserted: ${counts.inserted}, skipped: ${counts.skipped}, errors: ${counts.errors}`
    );
    return { source: name, ...counts };
  } catch (err) {
    console.error(`[scraper:${name}] Source-level error:`, err);
    return { source: name, inserted: 0, skipped: 0, errors: 1 };
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
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  for (const r of results) {
    console.log(
      `  ${r.source}: inserted=${r.inserted} skipped=${r.skipped} errors=${r.errors}`
    );
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }
  console.log(
    `  TOTAL: inserted=${totalInserted} skipped=${totalSkipped} errors=${totalErrors}`
  );

  if (totalErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[scraper] Fatal error:', err);
  process.exit(1);
});
