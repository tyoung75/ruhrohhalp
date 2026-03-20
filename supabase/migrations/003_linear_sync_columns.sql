-- Phase 3: Linear bidirectional sync columns
-- Adds tracking fields for linking TylerOS tasks to Linear issues.

alter table public.tasks
  add column if not exists linear_issue_id text unique,
  add column if not exists linear_url      text,
  add column if not exists linear_synced_at timestamptz;

-- Index for fast lookup when syncing inbound changes from Linear webhook
create index if not exists idx_tasks_linear_issue_id
  on public.tasks (linear_issue_id)
  where linear_issue_id is not null;
