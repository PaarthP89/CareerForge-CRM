-- Step 1: Remove rows with NULL in dedup columns (seeded mock rows with no real value)
DELETE FROM jobs WHERE company IS NULL OR title IS NULL OR url IS NULL;

-- Step 2: Remove duplicate rows, keeping the oldest by created_at per (company, title, url) group
DELETE FROM jobs
WHERE id NOT IN (
  SELECT DISTINCT ON (company, title, url) id
  FROM jobs
  ORDER BY company, title, url, created_at ASC
);

-- Step 3: Make dedup columns NOT NULL (NULLs break unique constraint semantics in Postgres)
ALTER TABLE jobs
  ALTER COLUMN company SET NOT NULL,
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN url SET NOT NULL;

-- Step 4: Add the unique constraint (guard handles re-runs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'jobs_company_title_url_key'
      AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_company_title_url_key UNIQUE (company, title, url);
  END IF;
END $$;
