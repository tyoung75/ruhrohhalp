-- Phase 5: Life Pillars & Goals Architecture
-- Adds goal-tracking system that structures Tyler's life into pillars,
-- goals, and actionable methods — all queryable by the briefing system.

-------------------------------------------------------------------------------
-- Pillars table — the top-level life categories
-------------------------------------------------------------------------------

create table if not exists public.pillars (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  emoji text,                          -- visual shorthand in UI
  description text,
  sort_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger set_pillars_updated_at
  before update on public.pillars
  for each row execute function set_updated_at();

alter table public.pillars enable row level security;

drop policy if exists "Users select own pillars" on public.pillars;
create policy "Users select own pillars" on public.pillars
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own pillars" on public.pillars;
create policy "Users insert own pillars" on public.pillars
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own pillars" on public.pillars;
create policy "Users update own pillars" on public.pillars
  for update using (auth.uid() = user_id);

drop policy if exists "Users delete own pillars" on public.pillars;
create policy "Users delete own pillars" on public.pillars
  for delete using (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Goals table — specific objectives under each pillar
-------------------------------------------------------------------------------

create table if not exists public.goals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  pillar_id uuid references public.pillars(id) on delete cascade not null,
  title text not null,
  description text,
  target_date date,                           -- when Tyler wants to hit this
  status text default 'active'
    check (status in ('active','paused','completed','archived')),
  priority text default 'medium'
    check (priority in ('critical','high','medium','low')),
  progress_metric text,                       -- e.g. "marathon time", "MRR dollars", "body weight"
  progress_current text,                      -- e.g. "3:23:02", "$0", "195 lbs"
  progress_target text,                       -- e.g. "sub-3:10", "$10,000", "185 lbs"
  methods text[],                             -- science-backed methods (short labels)
  tags text[],
  sort_order int default 0,
  embedding vector(1536),                     -- for semantic search in brain queries
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger set_goals_updated_at
  before update on public.goals
  for each row execute function set_updated_at();

alter table public.goals enable row level security;

drop policy if exists "Users select own goals" on public.goals;
create policy "Users select own goals" on public.goals
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own goals" on public.goals;
create policy "Users insert own goals" on public.goals
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own goals" on public.goals;
create policy "Users update own goals" on public.goals
  for update using (auth.uid() = user_id);

drop policy if exists "Users delete own goals" on public.goals;
create policy "Users delete own goals" on public.goals
  for delete using (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Goal signals table — automated observations mapped to goals
-- These are breadcrumbs from email, calendar, social, purchases, etc.
-------------------------------------------------------------------------------

create table if not exists public.goal_signals (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  goal_id uuid references public.goals(id) on delete cascade,
  pillar_id uuid references public.pillars(id) on delete cascade,
  signal_type text not null
    check (signal_type in ('email','calendar','social_post','purchase','workout','task_completed','manual','webhook')),
  content text not null,                      -- what was observed
  sentiment text
    check (sentiment in ('positive','neutral','negative')),
  impact_score float default 0.5,             -- 0-1, how much this moves the goal
  source_ref text,                            -- external ID (email id, event id, etc.)
  raw_data jsonb,                             -- original payload for debugging
  created_at timestamptz default now()
);

alter table public.goal_signals enable row level security;

drop policy if exists "Users select own signals" on public.goal_signals;
create policy "Users select own signals" on public.goal_signals
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own signals" on public.goal_signals;
create policy "Users insert own signals" on public.goal_signals
  for insert with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Goal check-ins — periodic progress snapshots
-------------------------------------------------------------------------------

create table if not exists public.goal_checkins (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  goal_id uuid references public.goals(id) on delete cascade not null,
  value text not null,                        -- the metric value at this point
  note text,                                  -- optional context
  created_at timestamptz default now()
);

alter table public.goal_checkins enable row level security;

drop policy if exists "Users select own checkins" on public.goal_checkins;
create policy "Users select own checkins" on public.goal_checkins
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own checkins" on public.goal_checkins;
create policy "Users insert own checkins" on public.goal_checkins
  for insert with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Link tasks to goals (optional FK)
-------------------------------------------------------------------------------

alter table public.tasks
  add column if not exists goal_id uuid references public.goals(id) on delete set null;

-------------------------------------------------------------------------------
-- Indexes for performance
-------------------------------------------------------------------------------

create index if not exists idx_goals_user_pillar on public.goals(user_id, pillar_id);
create index if not exists idx_goals_status on public.goals(user_id, status);
create index if not exists idx_signals_goal on public.goal_signals(goal_id);
create index if not exists idx_signals_user_type on public.goal_signals(user_id, signal_type);
create index if not exists idx_signals_created on public.goal_signals(created_at desc);
create index if not exists idx_checkins_goal on public.goal_checkins(goal_id);

-------------------------------------------------------------------------------
-- Add goals to brain search function
-------------------------------------------------------------------------------

create or replace function search_goals_by_embedding(
  query_embedding vector(1536),
  match_user_id uuid,
  match_threshold float default 0.6,
  match_count int default 5
)
returns table (
  id uuid,
  title text,
  description text,
  pillar_id uuid,
  status text,
  progress_current text,
  progress_target text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    g.id,
    g.title,
    g.description,
    g.pillar_id,
    g.status,
    g.progress_current,
    g.progress_target,
    1 - (g.embedding <=> query_embedding) as similarity
  from public.goals g
  where g.user_id = match_user_id
    and g.status = 'active'
    and 1 - (g.embedding <=> query_embedding) > match_threshold
  order by g.embedding <=> query_embedding
  limit match_count;
end;
$$;
