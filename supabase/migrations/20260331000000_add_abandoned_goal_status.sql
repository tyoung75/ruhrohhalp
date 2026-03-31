-- Add 'abandoned' to the goals status check constraint
-- so that goal cancellation (soft delete) works correctly.

alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add constraint goals_status_check
  check (status in ('active', 'paused', 'completed', 'archived', 'abandoned'));
