-- Creator OS settings (per-user configuration)
create table if not exists creator_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  daily_publish_limit int not null default 2,
  stale_after_days int not null default 7,
  updated_at timestamptz default now()
);

alter table creator_settings enable row level security;
create policy "Users can manage own settings" on creator_settings
  for all using (auth.uid() = user_id);
