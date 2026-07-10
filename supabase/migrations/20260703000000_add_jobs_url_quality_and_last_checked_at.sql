ALTER TABLE jobs ADD COLUMN IF NOT EXISTS url_quality text CHECK (url_quality IN ('direct', 'generic', 'unknown'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
