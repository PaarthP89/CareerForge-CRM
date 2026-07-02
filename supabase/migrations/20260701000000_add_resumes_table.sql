create table if not exists resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) unique,
  content text not null default '',
  updated_at timestamptz not null default now()
);

alter table resumes enable row level security;

create policy "resumes_select_own" on resumes for select using (user_id = auth.uid());
create policy "resumes_insert_own" on resumes for insert with check (user_id = auth.uid());
create policy "resumes_update_own" on resumes for update using (user_id = auth.uid());
