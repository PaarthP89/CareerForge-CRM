ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eligibility text CHECK (eligibility IN ('eligible', 'ineligible', 'unknown'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eligibility_reason text;
