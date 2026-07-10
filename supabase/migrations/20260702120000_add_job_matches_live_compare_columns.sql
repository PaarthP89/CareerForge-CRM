alter table job_matches add column if not exists missing_keywords text[];
alter table job_matches add column if not exists jd_fetched boolean not null default false;
