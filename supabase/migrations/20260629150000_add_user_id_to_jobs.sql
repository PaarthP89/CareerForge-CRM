-- Add user_id to jobs and tighten RLS to per-user row scoping.
-- Replaces the interim "any authenticated user" policy from the previous migration.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL REFERENCES auth.users(id);

-- Drop the permissive policy added in 20260629143000
DROP POLICY IF EXISTS "authenticated users can manage jobs" ON jobs;

-- Per-user policy: each row is owned by the user who created it
CREATE POLICY "users can manage their own jobs"
  ON jobs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
