-- Scheduled Workouts — manual workout planning with reschedule support
-- Allows scheduling workouts on specific dates and manually moving them.
-- No automatic cascading: moving one workout never shifts others.

create table if not exists public.scheduled_workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  goal_id uuid references public.goals(id) on delete set null,
  title text not null,
  workout_type text not null default 'strength'
    check (workout_type in ('strength','run','cross_training','recovery','other')),
  scheduled_date date not null,
  sort_order int default 0,
  notes text default '',
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger set_scheduled_workouts_updated_at
  before update on public.scheduled_workouts
  for each row execute function set_updated_at();

alter table public.scheduled_workouts enable row level security;

drop policy if exists "Users select own scheduled_workouts" on public.scheduled_workouts;
create policy "Users select own scheduled_workouts" on public.scheduled_workouts
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own scheduled_workouts" on public.scheduled_workouts;
create policy "Users insert own scheduled_workouts" on public.scheduled_workouts
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own scheduled_workouts" on public.scheduled_workouts;
create policy "Users update own scheduled_workouts" on public.scheduled_workouts
  for update using (auth.uid() = user_id);

drop policy if exists "Users delete own scheduled_workouts" on public.scheduled_workouts;
create policy "Users delete own scheduled_workouts" on public.scheduled_workouts
  for delete using (auth.uid() = user_id);

create index if not exists idx_scheduled_workouts_user_date
  on public.scheduled_workouts(user_id, scheduled_date);
