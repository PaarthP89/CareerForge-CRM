CREATE TABLE IF NOT EXISTS jobs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL,
  company          text        NOT NULL,
  url              text        NOT NULL,
  stream           text        NOT NULL CHECK (stream IN ('internship', 'new_grad')),
  posted_at        timestamptz,
  discovered_at    timestamptz NOT NULL DEFAULT now(),
  applied          boolean     NOT NULL DEFAULT false,
  resume_file_path text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_company_title_url_key UNIQUE (company, title, url)
);
