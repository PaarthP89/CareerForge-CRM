-- storage.objects already has RLS enabled by Supabase internally (never ALTER it here).
-- The existing blanket "resumes bucket" policies from 20260629143000 grant any
-- authenticated user access to every object in the bucket. Replace them with
-- policies scoped to the {user_id}/{job_id}/resume.pdf path convention, so a
-- user can only touch objects under their own user_id folder.

DROP POLICY IF EXISTS "authenticated users can upload resumes" ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can read resumes" ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can update resumes" ON storage.objects;
DROP POLICY IF EXISTS "authenticated users can delete resumes" ON storage.objects;

CREATE POLICY "users can read own resumes"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users can upload own resumes"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users can update own resumes"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'resumes'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
