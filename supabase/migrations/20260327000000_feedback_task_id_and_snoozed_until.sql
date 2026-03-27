-- Add task_id to feedback table so feedback can be linked to specific tasks
alter table public.feedback add column if not exists task_id uuid references public.tasks(id) on delete set null;
create index if not exists idx_feedback_task_id on public.feedback(task_id);

-- Add snoozed_until to tasks table for snooze functionality
alter table public.tasks add column if not exists snoozed_until timestamptz;
create index if not exists idx_tasks_snoozed_until on public.tasks(snoozed_until) where snoozed_until is not null;
