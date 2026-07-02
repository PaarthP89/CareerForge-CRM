create table if not exists job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  job_id uuid not null references jobs(id) on delete cascade,
  score integer not null check (score >= 0 and score <= 100),
  reasoning text,
  matched_at timestamptz not null default now(),
  unique (user_id, job_id)
);

alter table job_matches enable row level security;

create policy "job_matches_select_own" on job_matches for select using (user_id = auth.uid());
create policy "job_matches_insert_own" on job_matches for insert with check (user_id = auth.uid());
create policy "job_matches_update_own" on job_matches for update using (user_id = auth.uid());
