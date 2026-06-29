-- Enable RLS on jobs table
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- jobs: full access to authenticated users
-- No user_id column yet (deferred to multi-user phase per 2.1), so policy
-- grants access to any authenticated session. Service-role key bypasses RLS
-- and is used by the scraper worker without changes needed here.
DROP POLICY IF EXISTS "authenticated users can manage jobs" ON jobs;
CREATE POLICY "authenticated users can manage jobs"
  ON jobs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create private resumes bucket (ON CONFLICT DO NOTHING for idempotency)
INSERT INTO storage.buckets (id, name, public)
VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects (already enabled by Supabase but explicit for clarity)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- storage.objects: authenticated users can upload to resumes bucket
DROP POLICY IF EXISTS "authenticated users can upload resumes" ON storage.objects;
CREATE POLICY "authenticated users can upload resumes"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'resumes');

-- storage.objects: authenticated users can download from resumes bucket
DROP POLICY IF EXISTS "authenticated users can read resumes" ON storage.objects;
CREATE POLICY "authenticated users can read resumes"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'resumes');

-- storage.objects: authenticated users can update objects in resumes bucket
DROP POLICY IF EXISTS "authenticated users can update resumes" ON storage.objects;
CREATE POLICY "authenticated users can update resumes"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'resumes')
  WITH CHECK (bucket_id = 'resumes');

-- storage.objects: authenticated users can delete from resumes bucket
DROP POLICY IF EXISTS "authenticated users can delete resumes" ON storage.objects;
CREATE POLICY "authenticated users can delete resumes"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'resumes');
