-- Phase 4: Command Console feature suite
-- Replaces Linear as the primary task management system
-- Introduces briefings, commands, feedback, agent runs, and activity logging

-------------------------------------------------------------------------------
-- Extend tasks table for command console features
-------------------------------------------------------------------------------

-- Add identifier column (e.g., TYOS-330)
alter table public.tasks
  add column if not exists identifier text unique;

-- Add due date
alter table public.tasks
  add column if not exists due_date date;

-- Add GitHub PR URL
alter table public.tasks
  add column if not exists github_pr_url text;

-- Add source tracking
alter table public.tasks
  add column if not exists source text check (source in ('manual','gmail','github','agent','linear_import'));

-- Add state column (more granular than status)
alter table public.tasks
  add column if not exists state text check (state in ('backlog','unstarted','started','in_review','done','cancelled'));

-- Add priority_num for numeric priority (1=urgent, 2=high, 3=normal, 4=low)
alter table public.tasks
  add column if not exists priority_num integer check (priority_num between 1 and 4);

-- Create sequence for TYOS identifiers, starting at 330
create sequence if not exists tyos_seq start with 330 increment by 1;

-- Function to auto-generate identifier
create or replace function public.generate_task_identifier()
returns trigger
language plpgsql
as $$
begin
  if new.identifier is null then
    new.identifier := 'TYOS-' || nextval('tyos_seq');
  end if;
  return new;
end;
$$;

-- Trigger to auto-generate identifier on insert
drop trigger if exists trg_tasks_generate_identifier on public.tasks;
create trigger trg_tasks_generate_identifier
  before insert on public.tasks
  for each row
  execute function public.generate_task_identifier();

-- Index for fast lookup by identifier
create index if not exists idx_tasks_identifier on public.tasks(identifier);

-- Index for state queries
create index if not exists idx_tasks_user_state on public.tasks(user_id, state);

-------------------------------------------------------------------------------
-- briefings table: Daily/evening briefings with markdown and structured JSON
-------------------------------------------------------------------------------

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  period text not null check (period in ('morning','evening')),
  content_md text not null,
  content_json jsonb,
  gmail_draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_briefings_user_date_period
  on public.briefings(user_id, date desc, period);

-- RLS for briefings
alter table public.briefings enable row level security;
create policy "briefings_select_own" on public.briefings for select using (auth.uid() = user_id);
create policy "briefings_insert_own" on public.briefings for insert with check (auth.uid() = user_id);
create policy "briefings_update_own" on public.briefings for update using (auth.uid() = user_id);
create policy "briefings_delete_own" on public.briefings for delete using (auth.uid() = user_id);

create trigger trg_briefings_updated_at before update on public.briefings for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- commands table: User-issued command bar inputs
-------------------------------------------------------------------------------

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input_text text not null,
  intent text not null check (intent in ('add_task','feedback','note','dispatch','question','update_task','cancel_task')),
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commands_user_created on public.commands(user_id, created_at desc);
create index if not exists idx_commands_user_status on public.commands(user_id, status);

-- RLS for commands
alter table public.commands enable row level security;
create policy "commands_select_own" on public.commands for select using (auth.uid() = user_id);
create policy "commands_insert_own" on public.commands for insert with check (auth.uid() = user_id);
create policy "commands_update_own" on public.commands for update using (auth.uid() = user_id);

create trigger trg_commands_updated_at before update on public.commands for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- feedback table: User feedback on briefings and actions
-------------------------------------------------------------------------------

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  briefing_id uuid references public.briefings(id) on delete set null,
  section text not null,
  action text not null check (action in ('more','less','remove','fix','thumbs_up','thumbs_down')),
  note text not null default '',
  applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feedback_user_briefing on public.feedback(user_id, briefing_id);
create index if not exists idx_feedback_user_created on public.feedback(user_id, created_at desc);

-- RLS for feedback
alter table public.feedback enable row level security;
create policy "feedback_select_own" on public.feedback for select using (auth.uid() = user_id);
create policy "feedback_insert_own" on public.feedback for insert with check (auth.uid() = user_id);
create policy "feedback_update_own" on public.feedback for update using (auth.uid() = user_id);

create trigger trg_feedback_updated_at before update on public.feedback for each row execute function public.set_updated_at();

-------------------------------------------------------------------------------
-- agent_runs table: Track agent execution
-------------------------------------------------------------------------------

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_type text not null check (agent_type in ('content','outreach','deploy','briefing','command')),
  trigger_source text,
  task_id uuid references public.tasks(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_user_created on public.agent_runs(user_id, created_at desc);
create index if not exists idx_agent_runs_user_status on public.agent_runs(user_id, status);
create index if not exists idx_agent_runs_task on public.agent_runs(task_id);

-- RLS for agent_runs
alter table public.agent_runs enable row level security;
create policy "agent_runs_select_own" on public.agent_runs for select using (auth.uid() = user_id);
create policy "agent_runs_insert_own" on public.agent_runs for insert with check (auth.uid() = user_id);
create policy "agent_runs_update_own" on public.agent_runs for update using (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- activity_log table: Audit trail of all important events
-------------------------------------------------------------------------------

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('task_created','task_updated','task_completed','task_cancelled','briefing_generated','command_processed','agent_dispatched','feedback_submitted')),
  entity_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_log_user_created on public.activity_log(user_id, created_at desc);
create index if not exists idx_activity_log_type on public.activity_log(type);

-- RLS for activity_log
alter table public.activity_log enable row level security;
create policy "activity_log_select_own" on public.activity_log for select using (auth.uid() = user_id);
create policy "activity_log_insert_own" on public.activity_log for insert with check (auth.uid() = user_id);

-------------------------------------------------------------------------------
-- Extend projects table with github_repo
-------------------------------------------------------------------------------

alter table public.projects
  add column if not exists github_repo text;

-- Index for github repo lookups
create index if not exists idx_projects_github_repo on public.projects(user_id, github_repo);

-------------------------------------------------------------------------------
-- Helper function: log activity
-------------------------------------------------------------------------------

create or replace function public.log_activity(
  p_user_id uuid,
  p_type text,
  p_entity_id uuid default null,
  p_payload jsonb default '{}'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_log_id uuid;
begin
  insert into public.activity_log (user_id, type, entity_id, payload)
  values (p_user_id, p_type, p_entity_id, p_payload)
  returning id into v_log_id;

  return v_log_id;
end;
$$;
